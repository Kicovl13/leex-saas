# Cómo probar la IA (Legal AI) en LEX-CLOUD

## Qué hace la IA en este proyecto

La **Legal AI** analiza **documentos PDF** subidos a un expediente (matter) y extrae de forma automática:

- **Resumen** (`summary`): 2–4 frases del contenido.
- **Partes** (`parties`): personas/entidades que aparecen en el documento.
- **Plazos** (`deadlines`): descripción y fecha si se menciona (para poder “Agendar plazo”).
- **Puntos clave** (`keyPoints`): ideas importantes.

Todo se guarda en la base de datos (`ai_summary`, `ai_metadata`). La app **solo lee de la BD**; no vuelve a llamar a la IA al visualizar el documento (optimización de coste).

---

## Dónde se usa en la app

1. **Subida de documentos**  
   Dentro de un expediente: **Expediente → pestaña Documentos** (`/matters/[id]`).

2. **Flujo que dispara la IA**
   - El usuario pide una URL de subida (nombre, tipo, tamaño).
   - Sube el PDF a S3 con esa URL.
   - Llama a **confirmar subida** (`POST /documents/:id/confirm`).
   - Si el archivo es PDF, la API marca el documento como `processing` y publica el evento `DOCUMENT_UPLOADED` al orquestador (`EVENT_BUS_DOCUMENT_UPLOADED_URL`).
   - El workflow externo (n8n/worker) procesa el documento y regresa el resultado a `POST /internal/documents/ai-result`.
   - La API persiste `ai_summary` y `ai_metadata` en BD.

3. **Dónde se ve el resultado**
   - En la **misma pestaña Documentos** del expediente: al abrir un documento se muestra el **resumen** y, si hay plazos detectados, la opción **“Agendar plazo”** (que usa días hábiles vía `compute-due-date`).

---

## Qué necesitas para probarla

### 1. Modo recomendado: worker externo (n8n + servicio IA)

En **`apps/api/.env`** configura:

```env
EVENT_BUS_DOCUMENT_UPLOADED_URL=https://n8n.example.com/webhook/document-uploaded
INTERNAL_WEBHOOK_TOKEN=token-interno-seguro
# Opcionales:
EVENT_BUS_INTERNAL_TOKEN=token-para-llamada-api-a-n8n
EVENT_BUS_HMAC_SECRET=secret-hmac-salida
INTERNAL_WEBHOOK_HMAC_SECRET=secret-hmac-entrada
```

El worker debe devolver resultados a la API:

```http
POST /internal/documents/ai-result
X-Internal-Token: <INTERNAL_WEBHOOK_TOKEN>
```

```json
{
  "documentId": "doc_xxx",
  "organizationId": "org_xxx",
  "summary": "Resumen generado",
  "classification": "LABORAL",
  "riskScore": 0.42,
  "financialPrediction": {
    "estimatedDuration": "8 meses",
    "probabilityOfRecovery": 0.73,
    "estimatedProfitMargin": 0.31,
    "riskLevel": "MEDIUM"
  }
}
```

### 2. API Key de Anthropic (Claude) — para IA real en worker externo

- La API de Anthropic **no tiene trial gratuito**: hay que comprar créditos en [Plans & Billing](https://console.anthropic.com/settings/billing).
- En **`apps/api/.env`** añade (solo si quieres IA real):

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

- Si el worker no tiene esta variable, el documento puede quedarse en error según el flujo de n8n.

### 3. S3 configurado

La IA lee el PDF desde S3. Necesitas en `apps/api/.env`:

```env
AWS_S3_BUCKET=tu-bucket
AWS_REGION=eu-west-1
# Y credenciales (variables de entorno estándar de AWS o en .env):
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
```

Si S3 no está configurado, la subida o la descarga del PDF fallarán y la IA no podrá analizar.

### 4. Límite de uso por plan

- Plan **FREE**: 5 documentos con IA por mes (por organización).
- Plan **PRO**: 100/mes.
- Si superas el límite, la API responde error al confirmar y no lanza el análisis.

---

## Pasos para probar (flujo completo)

1. Arranca API y Web (y Clerk, BD, S3 según tu setup).
2. Inicia sesión en la app y entra en una **organización**.
3. Crea o abre un **expediente** (matter).
4. Ve a la pestaña **Documentos** del expediente.
5. **Sube un PDF** (por ejemplo un contrato o una sentencia):
   - Elige archivo → se genera URL firmada y se sube a S3.
   - La app llama a confirmar; si es PDF, la API encola el evento y n8n/worker hace el análisis.
6. Espera unos segundos (según tamaño del PDF).
7. **Recarga o vuelve a abrir el documento**: deberías ver el **resumen** y, si la IA detectó plazos, la opción para **Agendar plazo** (días hábiles).

Para ver errores de la IA (clave faltante, S3, límite, etc.) revisa los **logs de la API** (NestJS) al confirmar la subida y durante el análisis.

---

## Resumen rápido

| Qué | Dónde |
|-----|--------|
| **Configurar IA real** | Worker IA (`legal-ai-service`) → `ANTHROPIC_API_KEY` |
| **Subir documento** | Web: Expediente → Documentos → subir PDF |
| **Confirmar (dispara IA)** | La web llama a `POST /documents/:id/confirm` tras subir |
| **Ver resultado** | Misma pestaña Documentos: abrir el documento y ver resumen / “Agendar plazo” |
| **Límites** | Settings → plan (FREE 5 docs/mes con IA) |
