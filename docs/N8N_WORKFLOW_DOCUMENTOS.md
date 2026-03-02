# Flujo n8n: Análisis de Documentos LEX-CLOUD

Guía paso a paso para crear el workflow que conecta la API, n8n y el legal-ai-service.

## Diagrama del flujo

**Modo simplificado (1 solo túnel ngrok)** – recomendado:

```
[API] --POST webhook--> [n8n Webhook] --> [HTTP Request: legal-ai-service] --> legal-ai hace PATCH a localhost:3001
```

El legal-ai-service hace el callback a la API por sí mismo (usa `LEX_API_BASE_URL` y `LEX_API_INTERNAL_TOKEN`). Solo necesitas exponer el legal-ai con ngrok.

**Modo clásico (2 túneles):**

```
[API] --POST webhook--> [n8n Webhook] --> [HTTP Request: legal-ai-service] --> [HTTP Request: API callback]
```

---

## Requisitos previos

1. **legal-ai-service** corriendo en puerto 8081 (o expuesto vía ngrok)
2. **API** corriendo en puerto 3001
3. **Modo simplificado (1 ngrok)**: Configura en `legal-ai-service/.env`:
   - `LEX_API_BASE_URL=http://localhost:3001`
   - `LEX_API_INTERNAL_TOKEN=<mismo que INTERNAL_WEBHOOK_TOKEN o INTERNAL_API_KEY de la API>`
4. URLs públicas si usas ngrok (solo legal-ai en modo simplificado):
   - legal-ai: `https://xxx.ngrok-free.dev` → `http://localhost:8081`

---

## Paso 1: Crear el workflow en n8n

1. Entra a tu instancia n8n (ej: https://lex-saas.app.n8n.cloud)
2. **New workflow** → Pon nombre: `Documento Legal - Análisis IA`

---

## Paso 2: Nodo Webhook (trigger)

1. Añade un nodo **Webhook**
2. Configuración:
   - **Webhook URLs**: Production (o Test para pruebas)
   - **HTTP Method**: POST
   - **Path**: `nuevo-documento-legal` (o el que prefieras)
   - **Authentication**: Header Auth
     - Header Name: `x-n8n-auth` (o el que tengas en N8N_WEBHOOK_AUTH_HEADER)
     - Header Value: el mismo secreto que en `N8N_WEBHOOK_AUTH_VALUE` de la API

3. El webhook recibirá un JSON con:
   ```json
   {
     "matterId": "...",
     "documentId": "...",
     "s3Key": "org-id/matter-id/xxx-archivo.pdf",
     "taskType": "CLASSIFY | DEEP_ANALYSIS | MASSIVE_SUMMARY",
     "organizationId": "..."
   }
   ```

4. Guarda y **Activa** el webhook. Copia la URL (ej: `https://lex-saas.app.n8n.cloud/webhook/nuevo-documento-legal`)

5. En `apps/api/.env`:
   ```
   N8N_WEBHOOK_URL=https://lex-saas.app.n8n.cloud/webhook/nuevo-documento-legal
   N8N_WEBHOOK_AUTH_HEADER=x-n8n-auth
   N8N_WEBHOOK_AUTH_VALUE=tu_secreto
   ```

---

## Paso 3: Nodo HTTP Request → legal-ai-service

1. Añade un nodo **HTTP Request** después del Webhook
2. Configuración:
   - **Method**: POST
   - **URL**: `https://TU-NGROK-LEGAL-AI.ngrok-free.dev/analyze-document`
     - (Si local: `http://localhost:8081/analyze-document`)
   - **Authentication**: Header Auth
     - Header Name: `x-internal-token`
     - Header Value: `LexSaaS_Secure_2026_!` (o tu INTERNAL_API_KEY del legal-ai-service)
   - **Send Body**: Yes
   - **Body Content Type**: JSON
   - **Specify Body**: Using JSON
   - **JSON**:
     ```json
     {
       "s3Key": "{{ $json.s3Key }}",
       "organizationId": "{{ $json.organizationId }}",
       "documentId": "{{ $json.documentId }}",
       "taskType": "{{ $json.taskType || 'DEEP_ANALYSIS' }}"
     }
     ```
   - **Nota**: El Webhook suele poner el body en `$json` directamente. Si ves `$json.body`, usa `$json.body.s3Key` etc. Ejecuta "Test step" en el Webhook para ver la estructura real.

3. En n8n, el Webhook suele devolver `$json.body` con el JSON recibido. Si no, inspecciona la salida del Webhook y ajusta las expresiones.

---

## Paso 4: Manejar errores (opcional)

1. Añade un nodo **IF** después del HTTP Request
2. Condición: `{{ $json.ok }}` equals `true`
3. Rama **true** → continúa al callback
4. Rama **false** → puedes mandar a un nodo de error, Slack, etc.

---

## Paso 5: Nodo HTTP Request → API callback (solo modo clásico)

Si usas **modo simplificado** con `LEX_API_BASE_URL` y `LEX_API_INTERNAL_TOKEN` en el legal-ai-service, **no necesitas este nodo**: el legal-ai hará el callback a la API por sí mismo. Puedes terminar el workflow tras el Paso 3.

Si usas **modo clásico** (2 túneles ngrok):

1. Añade un nodo **HTTP Request** (en la rama de éxito)
2. Configuración:
   - **Method**: PATCH
   - **URL**: `https://TU-NGROK-API.ngrok-free.dev/internal/documents/{{ $('Webhook').item.json.documentId }}/ai-results`
     - (Si local: `http://localhost:3001/internal/documents/...`)
   - **Authentication**: Header Auth
     - Header Name: `x-internal-token`
     - Header Value: `LexSaaS_Secure_2026_!` (o tu INTERNAL_WEBHOOK_TOKEN de la API)
   - **Send Body**: Yes
   - **Body Content Type**: JSON
   - **JSON** (mapear resultado del legal-ai-service al formato del callback):
     ```json
     {
       "organizationId": "{{ $('Webhook').item.json.organizationId }}",
       "summary": "{{ $json.result.summary }}",
       "classification": "{{ $json.result.classification }}",
       "riskLevel": "{{ $json.result.riskLevel }}",
       "aiMetadata": {
         "parties": "{{ $json.result.parties }}",
         "deadlines": "{{ $json.result.deadlines }}",
         "amount": "{{ $json.result.amount }}",
         "taskType": "{{ $json.result.taskType }}",
         "ocrContent": "{{ $json.result.ocrContent }}"
       }
     }
     ```

**Importante**: En n8n, las expresiones para objetos anidados pueden requerir sintaxis diferente. Si `$json.result` es un objeto, usa:
```json
{
  "organizationId": "{{ $('Webhook').item.json.body.organizationId }}",
  "summary": "{{ $json.result.summary }}",
  "classification": "{{ $json.result.classification }}",
  "riskLevel": "{{ $json.result.riskLevel }}",
  "aiMetadata": "{{ JSON.stringify($json.result) }}"
}
```
O construye el aiMetadata en un nodo **Code** previo.

---

## Paso 6: Expresiones n8n – referencias de nodos

- `$('Webhook')` = primer nodo (Webhook)
- `$('HTTP Request')` = nodo HTTP que llama al legal-ai
- `$json` = datos del nodo actual
- Para el callback, el documentId viene del Webhook: `$('Webhook').item.json.body.documentId` (o `$('Webhook').item.json.documentId` si el body se aplana)

Prueba con "Execute node" en cada paso para ver la estructura real.

---

## Paso 7: Usar nodo Code para construir el body del callback

Para evitar problemas con JSON anidado, añade un nodo **Code** entre el HTTP (legal-ai) y el HTTP (callback):

**Entrada**: resultado del legal-ai-service
**Código**:
```javascript
// Datos del webhook (entrada original)
const webhook = $('Webhook').first().json;
// Resultado del legal-ai-service (ajusta el nombre del nodo HTTP si es distinto)
const aiResponse = $('HTTP Request').first().json;
const result = aiResponse.result || aiResponse;

return {
  json: {
    organizationId: webhook.organizationId,
    documentId: webhook.documentId,
    summary: result.summary || null,
    classification: result.classification || null,
    riskLevel: result.riskLevel || null,
    aiMetadata: {
      ...result,
      parties: result.parties,
      deadlines: result.deadlines,
      amount: result.amount,
      taskType: result.taskType,
      ocrContent: result.ocrContent
    }
  }
};
```

Luego en el nodo HTTP (callback) usa expresiones como `{{ $json.summary }}`, `{{ $json.aiMetadata }}`, etc.

---

## Paso 8: Activar el workflow

1. **Save** el workflow
2. **Activate** (toggle arriba a la derecha)
3. El webhook debe estar en estado "Listening"

---

## Resumen de variables de entorno

| Servicio         | Variable                 | Uso                                                          |
|------------------|--------------------------|--------------------------------------------------------------|
| API              | N8N_WEBHOOK_URL          | URL del webhook n8n                                          |
| API              | N8N_WEBHOOK_AUTH_HEADER  | Nombre header para autenticar en n8n                         |
| API              | N8N_WEBHOOK_AUTH_VALUE   | Valor del header                                             |
| API              | INTERNAL_WEBHOOK_TOKEN   | Token para callback (usar mismo valor en LEX_API_INTERNAL_TOKEN) |
| legal-ai-service | INTERNAL_API_KEY         | Token que n8n envía al legal-ai                              |
| legal-ai-service | LEX_API_BASE_URL         | URL base de la API para callback (ej: `http://localhost:3001`) |
| legal-ai-service | LEX_API_INTERNAL_TOKEN   | Token para el callback PATCH (mismo que INTERNAL_WEBHOOK_TOKEN) |

---

## Probar el flujo

1. Sube un documento PDF en LEX-CLOUD
2. La API llama al webhook de n8n
3. n8n llama al legal-ai-service (expuesto vía ngrok en modo simplificado)
4. legal-ai devuelve el análisis
5. **Modo simplificado**: legal-ai hace PATCH a la API (localhost) con los resultados
   **Modo clásico**: n8n llama al callback de la API
6. El documento debería mostrar el resumen/clasificación en la UI
