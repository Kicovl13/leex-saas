# Integración n8n + Worker IA (contrato técnico)

## 1) Evento saliente desde API

La API publica `DOCUMENT_UPLOADED` con dos modos:

- `EVENT_BUS_MODE=webhook`: publica a `EVENT_BUS_DOCUMENT_UPLOADED_URL`
- `EVENT_BUS_MODE=sns`: publica a `AWS_SNS_TOPIC_DOCUMENT_UPLOADED_ARN`

Headers opcionales:

- `x-internal-token`: `EVENT_BUS_INTERNAL_TOKEN`
- `x-signature`: HMAC SHA256 del body con `EVENT_BUS_HMAC_SECRET`

Payload:

```json
{
  "type": "DOCUMENT_UPLOADED",
  "documentId": "doc_xxx",
  "organizationId": "org_xxx",
  "s3Key": "org_xxx/matter_xxx/doc_xxx-file.pdf",
  "workflowExecutionId": "doc_abcd1234",
  "plan": "FREE|PRO|ENTERPRISE",
  "featureFlags": ["advanced_prediction", "full_ai"],
  "featuresRequested": ["summary", "classification", "risk_score"]
}
```

## 2) Flujo esperado en n8n

1. Recibir webhook/evento.
2. Aplicar reglas por plan/feature flags.
3. Enviar trabajo al worker IA (ECS/Fargate).
4. Si éxito: llamar a API interna con resultado.
5. Si falla: reintentos y DLQ (recomendado).

## 3) Endpoint interno de resultados en API

`POST /internal/documents/ai-result`

Header obligatorio:

- `x-internal-token`: debe coincidir con `INTERNAL_WEBHOOK_TOKEN`

Header opcional:

- `x-signature`: HMAC SHA256 del body con `INTERNAL_WEBHOOK_HMAC_SECRET`

Payload mínimo:

```json
{
  "documentId": "doc_xxx",
  "organizationId": "org_xxx",
  "status": "completed",
  "aiMetadata": {
    "summary": "Resumen del documento",
    "ocrContent": "Texto OCR"
  }
}
```

Payload recomendado:

```json
{
  "documentId": "doc_xxx",
  "organizationId": "org_xxx",
  "status": "completed",
  "aiMetadata": {
    "summary": "Resumen del documento",
    "classification": "LABORAL",
    "riskScore": 0.4,
    "financialPrediction": {
      "estimatedDuration": "8 meses",
      "probabilityOfRecovery": 0.73,
      "estimatedProfitMargin": 0.31,
      "riskLevel": "MEDIUM"
    },
    "parties": ["Actor", "Demandado"],
    "deadlines": [
      { "description": "Contestación", "date": "2026-03-15" }
    ],
    "keyPoints": ["Punto clave 1", "Punto clave 2"],
    "rawResult": { "provider": "legal-ai-service" }
  }
}
```

Payload de error:

```json
{
  "documentId": "doc_xxx",
  "organizationId": "org_xxx",
  "status": "failed",
  "errorMessage": "No fue posible procesar el PDF",
  "aiMetadata": {
    "provider": "legal-ai-service",
    "attemptCount": 3
  }
}
```

## 4) Snapshot BI nocturno (Fase 4)

Para evitar cálculos en tiempo real, n8n puede ejecutar cada noche:

`POST /internal/dashboard/metrics-snapshot/recompute`

Header obligatorio:

- `x-internal-token`: `INTERNAL_WEBHOOK_TOKEN`

Body:

```json
{
  "organizationId": "org_xxx"
}
```

Después, el dashboard puede leer el último snapshot en:

- `GET /dashboard/metrics-snapshot/latest`

## 5) Hardening de errores (Fase 6)

- La API incrementa `attempt_count` en `workflow_executions` cuando recibe callback `status=failed`.
- Si `attempt_count` alcanza `WORKFLOW_FAILURE_ALERT_THRESHOLD` (default 3) y existe `SLACK_WEBHOOK_URL`, envía alerta automática.
- Recomendado en n8n:
  - reintentos con backoff exponencial,
  - DLQ tras agotar reintentos,
  - callback final a `/internal/documents/ai-result` con `aiMetadata` y `errorMessage`.

## 6) SQS/SNS + DLQ + BullMQ + KMS

- Si `EVENT_BUS_MODE=sns`, la API publica el evento en SNS (topic de documentos).
- Si falla publicación principal, la API intenta enviar mensaje a `AWS_SQS_DLQ_URL`.
- Jobs pesados internos se pueden encolar con BullMQ cuando `BULLMQ_ENABLED=true`.
- Para cifrado por tenant:
  - la API busca `organization.settings.kmsKeyId`,
  - si no existe usa `DEFAULT_TENANT_KMS_KEY_ID`,
  - la subida a S3 usa SSE-KMS por objeto.
