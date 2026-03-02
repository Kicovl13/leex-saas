# LEX-CLOUD — Roadmap Enterprise V2

**Objetivo:** Mejoras de seguridad, UX, observabilidad y funcionalidad para madurez enterprise.

---

## Fase 1: Operación y Staging

| # | Tarea | Estado | Prioridad |
|---|-------|--------|-----------|
| 1.1 | Validar en staging con n8n real | Pendiente | Alta |
| 1.2 | Ajustar umbrales y canales de alertas según operación | Pendiente | Alta |

---

## Fase 2: Seguridad y Compliance

| # | Tarea | Estado | Prioridad |
|---|-------|--------|-----------|
| 2.1 | Revisar sweep automático de políticas de retención | Pendiente | Media |
| 2.2 | Registrar en AuditLog las exportaciones (`GET /matters/:id/export`) | Hecho | Media |
| 2.3 | Logs de acceso a documentos (quién descarga/visualiza) | Pendiente | Media |

---

## Fase 3: UX y Productividad

| # | Tarea | Estado | Prioridad |
|---|-------|--------|-----------|
| 3.1 | Búsqueda global en header (expedientes, documentos, clientes) | Hecho | Alta |
| 3.2 | Atajos de teclado (ej. Ctrl+K para búsqueda) | Pendiente | Baja |
| 3.3 | Centro de notificaciones in-app (plazos, tareas, menciones) | Pendiente | Media |

---

## Fase 4: Observabilidad y Operación

| # | Tarea | Estado | Prioridad |
|---|-------|--------|-----------|
| 4.1 | Endpoint `/metrics` (Prometheus) para Grafana/Datadog | Hecho | Media |
| 4.2 | Logs estructurados (JSON) en producción | Pendiente | Media |
| 4.3 | Rate limiting por plan (FREE / PRO / ENTERPRISE) | Hecho | Alta |

---

## Fase 5: Funcionalidad

| # | Tarea | Estado | Prioridad |
|---|-------|--------|-----------|
| 5.1 | Plantillas de documentos (crear expedientes/documentos desde plantilla) | Pendiente | Media |
| 5.2 | Flujo completo de firmas electrónicas (documentSignatureRequests) | Pendiente | Alta |
| 5.3 | Versionado de expedientes (snapshots en momentos clave) | Pendiente | Baja |
| 5.4 | Dashboard ejecutivo (gráficos: etapa, facturación, plazos, IA) | Pendiente | Alta |
| 5.5 | Soporte multi-idioma (i18n) en interfaz | Pendiente | Baja |

---

## Fase 6: Infraestructura

| # | Tarea | Estado | Prioridad |
|---|-------|--------|-----------|
| 6.1 | Tests E2E en CI (antes de deploy) | Hecho | Alta |
| 6.2 | Backup automático de BD y S3 | Pendiente | Alta |
| 6.3 | Página de mantenimiento programado (modo read-only) | Pendiente | Baja |

---

## Orden sugerido de ejecución

1. **Corto plazo (1–2 sprints):** 1.1, 1.2, 4.3, 6.1  
2. **Medio plazo (2–4 sprints):** 2.2, 2.3, 3.1, 4.1, 5.2, 5.4, 6.2  
3. **Largo plazo (4+ sprints):** 2.1, 3.2, 3.3, 4.2, 5.1, 5.3, 5.5, 6.3  

---

## Notas

- Actualizar el estado (`Pendiente` → `En curso` → `Hecho`) según avance.
- Las prioridades pueden ajustarse según feedback de negocio.
- Mantener alineado con `TODO_ENTERPRISE_ROADMAP.md` para trazabilidad.
