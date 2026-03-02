# TODO Enterprise Roadmap (ejecución paso a paso)

## Estado actual

- [x] Fase 1: Pipeline asíncrono base de documentos (evento + endpoint interno seguro).
- [x] Fase 2: Persistencia enterprise mínima (`DocumentVersion` + `WorkflowExecution`).
- [x] Fase 2.1: Soft delete inicial en entidades core + scope Prisma por `deletedAt`.
- [x] Fase 3: Aislar por completo `legal-ai-service` como worker externo (sin fallback local).
- [x] Fase 4: Predicción financiera enterprise y snapshots BI precalculados.
- [x] Fase 5: Motor de plazos por regla de tribunal (`DeadlineRule`).
- [x] Fase 6: Hardening final (reintentos, DLQ, observabilidad y E2E del flujo IA).

## Notas de implementación

- `POST /documents/:id/confirm` ya publica `DOCUMENT_UPLOADED` a `EVENT_BUS_DOCUMENT_UPLOADED_URL`.
- `POST /internal/documents/ai-result` persiste resultados IA con seguridad por `X-Internal-Token` y HMAC opcional.
- Se añadieron migraciones para:
  - `document_versions`
  - `workflow_executions`
  - `deleted_at` en tablas core

## Próximos pasos

1. ~~Aplicar migraciones~~ — `start.sh` ejecuta `prisma migrate deploy` antes de arrancar.
2. ~~Pruebas E2E del callback interno~~ — `internal-documents.e2e-spec.ts` y smoke test en `app.e2e-spec.ts`.
3. ~~Endpoint de observabilidad~~ — `GET /observability/workflows` (protegido por `OBSERVABILITY_TOKEN`).
   - Errores por org: `workflowErrorsByOrg`
   - Tiempos de procesamiento: `workflowProcessingStats` (avg segundos, completed count).
4. Validar en staging con n8n real.
5. Ajustar umbral y canales de alertas según operación real.

## Mejoras implementadas (Enterprise)

- **Error boundaries** — `error.tsx`, `global-error.tsx`, rutas específicas (matters, clients).
- **Reanalizar documento** — `POST /documents/:id/reanalyze` + botón "Reanalizar" en documentos failed/processing.
- **Toast unificado** — Sonner integrado; feedback en reanalizar y exportar.
- **Historial de cambios** — Panel "Historial de cambios" en detalle documento (auditoría + actividad).
- **Health check completo** — `GET /health` devuelve `{ checks: { db, s3, redis } }`.
- **Loading** — `loading.tsx` en `/matters/[id]` con Skeleton.
- **Retry workflows** — `POST /observability/workflows/:id/retry` (protegido por OBSERVABILITY_TOKEN).
- **Export expedientes** — `GET /matters/:id/export` + botón "Exportar" en detalle expediente.
