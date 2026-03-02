require('dotenv').config();

const http = require('node:http');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai').default;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdfParse = require('pdf-parse');

const port = Number(process.env.PORT || 8081);
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY?.trim();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const AWS_BUCKET = process.env.AWS_S3_BUCKET?.trim();
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const TASK_TYPES = ['CLASSIFY', 'DEEP_ANALYSIS', 'MASSIVE_SUMMARY'];

const CHARS_PER_PAGE = 4000;
const CLASSIFY_MAX_CHARS = CHARS_PER_PAGE * 3; // primeras 3 páginas

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------

const PROMPT_CLASSIFY = `Eres un clasificador legal. Lee SOLO el texto proporcionado (primeras páginas de un documento judicial mexicano) y devuelve ÚNICAMENTE un objeto JSON válido (sin markdown) con esta estructura:

{
  "classification": "CIVIL | MERCANTIL | LABORAL | FAMILIAR | ADMINISTRATIVO | PENAL | FISCAL | OTRO",
  "documentType": "demanda | contestación | sentencia | oficio | contrato | otro",
  "parties": {
    "actor": "nombre o identificación del actor/demandante o null",
    "demandado": "nombre o identificación del demandado o null"
  }
}

Responde solo con el JSON.`;

const PROMPT_DEEP_ANALYSIS = `Eres un Abogado Senior Mexicano experto en análisis de documentos judiciales y legales.
Tu tarea es analizar el texto completo y devolver ÚNICAMENTE un objeto JSON válido (sin markdown, sin explicaciones) con esta estructura exacta:

{
  "summary": "Resumen ejecutivo breve del documento en 2-4 frases",
  "classification": "Materia jurídica (ej: CIVIL, MERCANTIL, LABORAL, FAMILIAR, ADMINISTRATIVO, PENAL, FISCAL)",
  "parties": {
    "actor": "Nombre o identificación del actor/demandante si se identifica",
    "demandado": "Nombre o identificación del demandado si se identifica"
  },
  "amount": "Cuantía reclamada en pesos o descripción si no hay monto específico",
  "deadlines": [{"description": "Descripción del plazo", "date": "YYYY-MM-DD si se menciona"}],
  "riskLevel": "BAJO | MEDIO | ALTO según el análisis",
  "proceduralRisks": ["riesgo procesal 1", "riesgo procesal 2"],
  "executiveSummary": "Resumen ejecutivo de 3-5 oraciones para toma de decisiones"
}

Si no encuentras información para algún campo, usa null o array vacío. Responde solo con el JSON.`;

const PROMPT_MASSIVE_SUMMARY = `Eres un Abogado Senior Mexicano. Este expediente es muy extenso (50+ páginas).
Genera un análisis estructurado y devuelve ÚNICAMENTE un objeto JSON válido (sin markdown) con esta estructura:

{
  "summary": "Resumen general del expediente en 4-6 frases",
  "classification": "Materia jurídica principal",
  "parties": {"actor": "identificación si aplica", "demandado": "identificación si aplica"},
  "keySections": ["sección 1: breve descripción", "sección 2: breve descripción"],
  "criticalDates": [{"description": "evento", "date": "YYYY-MM-DD"}],
  "riskLevel": "BAJO | MEDIO | ALTO",
  "recommendations": ["recomendación 1", "recomendación 2"],
  "ocrContent": null
}

Para expedientes largos, prioriza: plazos críticos, partes, materia y recomendaciones. Responde solo con el JSON.`;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function validateInternalAuth(req) {
  if (!INTERNAL_API_KEY) return true;
  const token = req.headers['x-internal-token'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  return token && token.trim() === INTERNAL_API_KEY;
}

async function getPdfFromS3(s3Key) {
  const client = new S3Client({
    region: AWS_REGION,
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  const command = new GetObjectCommand({ Bucket: AWS_BUCKET, Key: s3Key });
  const response = await client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function extractTextFromPdf(buffer) {
  const data = await pdfParse(buffer);
  return { text: (data?.text ?? '').trim(), numPages: data?.numpages ?? 0 };
}

function parseJsonFromResponse(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}') + 1;
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end));
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Task handlers
// -----------------------------------------------------------------------------

async function runClassify(textFirst3Pages) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY no está configurado para taskType CLASSIFY.');
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      { role: 'system', content: PROMPT_CLASSIFY },
      { role: 'user', content: `Texto (primeras páginas):\n\n${textFirst3Pages}` },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonFromResponse(raw);
  if (!parsed) throw new Error('La IA no devolvió un JSON válido.');
  return {
    taskType: 'CLASSIFY',
    classification: parsed.classification ?? null,
    documentType: parsed.documentType ?? null,
    parties: parsed.parties ?? { actor: null, demandado: null },
    rawModel: { provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini' },
  };
}

async function runDeepAnalysis(fullText) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no está configurado para taskType DEEP_ANALYSIS.');
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: process.env.LEGAL_AI_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: PROMPT_DEEP_ANALYSIS,
    messages: [{ role: 'user', content: `Analiza el documento:\n\n${fullText.slice(0, 120000)}` }],
  });
  const content = message.content?.[0];
  const raw = content?.type === 'text' ? content.text : '';
  const parsed = parseJsonFromResponse(raw);
  if (!parsed) throw new Error('La IA no devolvió un JSON válido.');
  return {
    taskType: 'DEEP_ANALYSIS',
    summary: parsed.summary ?? null,
    classification: parsed.classification ?? null,
    parties: parsed.parties ?? { actor: null, demandado: null },
    amount: parsed.amount ?? null,
    deadlines: Array.isArray(parsed.deadlines) ? parsed.deadlines : [],
    riskLevel: parsed.riskLevel ?? null,
    proceduralRisks: Array.isArray(parsed.proceduralRisks) ? parsed.proceduralRisks : [],
    executiveSummary: parsed.executiveSummary ?? null,
    ocrContent: fullText,
    rawModel: { provider: 'anthropic', model: process.env.LEGAL_AI_MODEL || 'claude-sonnet-4-20250514' },
  };
}

async function runMassiveSummary(fullText, numPages) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está configurado para taskType MASSIVE_SUMMARY.');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
    generationConfig: { maxOutputTokens: 4096 },
  });
  const prompt = `${PROMPT_MASSIVE_SUMMARY}\n\nDocumento (${numPages} páginas aprox.):\n\n${fullText.slice(0, 1000000)}`;
  const result = await model.generateContent(prompt);
  const response = result.response;
  const raw = typeof response?.text === 'function' ? response.text() : (response?.text ?? '');
  const parsed = parseJsonFromResponse(raw);
  if (!parsed) throw new Error('La IA no devolvió un JSON válido.');
  return {
    taskType: 'MASSIVE_SUMMARY',
    summary: parsed.summary ?? null,
    classification: parsed.classification ?? null,
    parties: parsed.parties ?? { actor: null, demandado: null },
    keySections: Array.isArray(parsed.keySections) ? parsed.keySections : [],
    criticalDates: Array.isArray(parsed.criticalDates) ? parsed.criticalDates : [],
    riskLevel: parsed.riskLevel ?? null,
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    ocrContent: fullText.length > 100000 ? null : fullText, // no devolver todo si es enorme
    rawModel: { provider: 'google', model: process.env.GEMINI_MODEL || 'gemini-1.5-pro' },
  };
}

// -----------------------------------------------------------------------------
// Main analyze
// -----------------------------------------------------------------------------

async function analyzeDocument(body) {
  const { s3Key, organizationId, documentId, taskType } = body;

  if (!s3Key || !organizationId) {
    throw new Error('s3Key y organizationId son obligatorios.');
  }
  const task = taskType && TASK_TYPES.includes(String(taskType).toUpperCase())
    ? String(taskType).toUpperCase()
    : 'DEEP_ANALYSIS';

  if (!AWS_BUCKET) {
    throw new Error('AWS_S3_BUCKET no está configurado.');
  }

  let buffer;
  try {
    buffer = await getPdfFromS3(s3Key);
  } catch (err) {
    const msg = err?.name === 'NoSuchKey' ? 'Archivo no encontrado en S3.' : (err?.message || 'Error al descargar el PDF desde S3.');
    throw new Error(msg);
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('El archivo descargado está vacío.');
  }

  let extracted;
  try {
    extracted = await extractTextFromPdf(buffer);
  } catch (err) {
    throw new Error(`Error al extraer texto del PDF: ${err?.message || 'desconocido'}`);
  }

  const { text, numPages } = extracted;
  if (!text || text.length < 50) {
    throw new Error('No se pudo extraer texto suficiente del documento (mínimo 50 caracteres).');
  }

  let result;
  switch (task) {
    case 'CLASSIFY': {
      const textFirst3 = text.slice(0, CLASSIFY_MAX_CHARS);
      result = await runClassify(textFirst3);
      result.ocrContent = text;
      break;
    }
    case 'MASSIVE_SUMMARY': {
      if (numPages > 0 && numPages < 50) {
        console.warn(`[legal-ai-service] MASSIVE_SUMMARY usado para documento de ${numPages} páginas (recomendado 50+).`);
      }
      result = await runMassiveSummary(text, numPages);
      break;
    }
    case 'DEEP_ANALYSIS':
    default: {
      result = await runDeepAnalysis(text);
      break;
    }
  }

  const output = { ...result, documentId: documentId ?? null, organizationId };

  const apiBase = process.env.LEX_API_BASE_URL?.trim();
  const apiToken = process.env.LEX_API_INTERNAL_TOKEN?.trim();
  if (apiBase && apiToken && output.documentId) {
    const callbackUrl = `${apiBase.replace(/\/$/, '')}/internal/documents/${output.documentId}/ai-results`;
    const payload = {
      organizationId: output.organizationId,
      summary: output.summary ?? null,
      classification: output.classification ?? null,
      riskLevel: output.riskLevel ?? null,
      aiMetadata: {
        ...output,
        taskType: output.taskType,
        ocrContent: output.ocrContent,
      },
    };
    fetch(callbackUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': apiToken,
      },
      body: JSON.stringify(payload),
    }).then((r) => {
      if (!r.ok) {
        console.error(`[legal-ai-service] Callback API falló (${r.status}) para ${output.documentId}`);
      } else {
        console.log(`[legal-ai-service] Callback OK para documentId=${output.documentId}`);
      }
    }).catch((err) => {
      console.error(`[legal-ai-service] Error en callback a API:`, err.message);
    });
  }

  return output;
}

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'legal-ai-service',
      taskTypes: TASK_TYPES,
      configured: {
        openai: Boolean(OPENAI_API_KEY),
        anthropic: Boolean(ANTHROPIC_API_KEY),
        gemini: Boolean(GEMINI_API_KEY),
        s3: Boolean(AWS_BUCKET),
      },
    });
  }

  if (req.method === 'POST' && req.url === '/analyze-document') {
    if (!validateInternalAuth(req)) {
      return sendJson(res, 401, { ok: false, message: 'Invalid or missing internal API key.' });
    }
    try {
      const body = await parseJson(req);
      const result = await analyzeDocument(body);
      return sendJson(res, 200, {
        ok: true,
        documentId: result.documentId,
        organizationId: result.organizationId,
        taskType: result.taskType,
        result,
      });
    } catch (err) {
      const message = err?.message || 'Error interno al procesar el documento.';
      const status =
        err instanceof SyntaxError ||
        message.includes('obligatorios') ||
        message.includes('JSON') ||
        message.includes('invalid')
          ? 400
          : 500;
      return sendJson(res, status, { ok: false, message });
    }
  }

  return sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(port, () => {
  console.log(`[legal-ai-service] listening on :${port} | taskTypes: ${TASK_TYPES.join(', ')}`);
  if (!OPENAI_API_KEY) console.warn('[legal-ai-service] OPENAI_API_KEY no configurado (CLASSIFY no disponible).');
  if (!ANTHROPIC_API_KEY) console.warn('[legal-ai-service] ANTHROPIC_API_KEY no configurado (DEEP_ANALYSIS no disponible).');
  if (!GEMINI_API_KEY) console.warn('[legal-ai-service] GEMINI_API_KEY no configurado (MASSIVE_SUMMARY no disponible).');
  if (!AWS_BUCKET) console.warn('[legal-ai-service] AWS_S3_BUCKET no configurado.');
});
