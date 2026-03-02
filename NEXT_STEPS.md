# LEX-CLOUD — Próximos pasos (roadmap)

Documento de referencia con mejoras priorizadas según la auditoría y el estado actual del proyecto.

---

## Prioridad alta

### 1. Tests automatizados
- **Tests unitarios**: `TimeEntriesService` (filtro por rol, 403 en update/delete ajeno).
- **Tests unitarios**: `computeDueDate` y `addBusinessDays` con festivos (`deadline.util`, `DeadlinesService`).
- **E2E mínimo**: `POST /time-entries`, `GET /public/matters/:token` (incl. rate limit).
- Sin esto, cambios de auditoría (roles, throttler, plazos) pueden romperse en silencio.

### 2. Variables de entorno validadas al arranque
- La API no debe arrancar si faltan `CLERK_*`, `DATABASE_URL`, o (si se usa IA) `ANTHROPIC_API_KEY`.
- Mensaje claro por cada variable faltante. Evita errores oscuros en producción.
- **Estado**: implementado en `main.ts` (validación al inicio de `bootstrap()`).

### 3. Health check
- `GET /health` que compruebe DB (+ opcionalmente S3) y devuelva 200/503.
- Útil para load balancers, Docker y monitorización.
- **Estado**: implementado en `HealthController` (DB obligatorio; S3 opcional si está configurado).

### 4. Manejo de errores y logs
- Filtro global que no devuelva stack traces al cliente en producción.
- Logger estructurado y, opcionalmente, request id.
- **Estado**: `AllExceptionsFilter` ya no envía el stack al cliente (solo lo registra en servidor). Revisar que no se filtre información sensible en el body de respuesta.

---

## Prioridad media

### 5. Documentación de API
- OpenAPI/Swagger para endpoints autenticados (matters, deadlines, time-entries, documents, etc.).
- Ayuda a frontend, integraciones y onboarding.

### 6. Paginación en listados
- `GET /matters`, `GET /time-entries`, `GET /deadlines`, etc. con `limit`/`offset` o cursor.
- Evita cargar miles de registros de golpe cuando la org crezca.

### 7. Soft delete (opcional)
- Para Matter (y quizá Client): marcar como “archivado”/eliminado en lugar de borrar.
- Preserva historial y referencias.

### 8. Renovación de publicToken
- Endpoint o flujo para “regenerar enlace del portal” (nuevo token, invalidar el anterior).
- Útil si se filtra el enlace o se quiere rotar.

---

## Prioridad más baja

### 9. Backup y retención de AuditLog
- Política de retención (archivar o borrar registros > N meses).
- Backups de BD programados (requisitos legales o compliance).

### 10. Notificaciones
- Recordatorios de plazos (email o in-app) “X días antes del vencimiento”.
- Reutilizar días hábiles y festivos ya implementados.

### 11. Métricas y observabilidad
- Métricas básicas (latencia, errores por endpoint, uso de IA por org).
- Tracing para depurar flujos completos.

### 12. CI/CD
- Pipeline: lint, tests y build en cada PR.
- Despliegue a staging/producción con variables y secretos gestionados de forma segura.

---

## Resumen de estado

| Ítem              | Estado      |
|-------------------|------------|
| Env al arranque   | Implementado |
| Health check      | Implementado |
| Filtro excepciones| Revisado (no envía stack) |
| Tests unitarios   | Implementado (TimeEntriesService rol/403, deadline.util addBusinessDays) |
| E2E mínimo        | Implementado (GET /, GET /public/matters/:token 404, GET /health) |
| OpenAPI/Swagger   | Implementado (GET /api-docs) |
| Paginación        | Implementado (matters, clients, deadlines: take/skip, máx. 100) |
| Resto             | Pendiente  |
 