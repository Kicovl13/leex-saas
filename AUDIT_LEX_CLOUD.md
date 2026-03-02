# Auditoría LEX-CLOUD — Estado actual del producto

Este documento responde a cinco bloques de auditoría solicitados sobre consistencia de datos, escalabilidad del audit log, seguridad del portal público, integración de plazos y optimización de IA.

---

## 1. Consistencia de datos: TimeEntry, Matter y Organization (Socio vs Asociado)

### Estado actual: **No blindado**

- **Organization**: Todas las consultas de time-entries, matters y deadlines están correctamente filtradas por `organizationId` (multi-tenancy a nivel organización).
- **TimeEntry**: El servicio `TimeEntriesService` y el controlador filtran por `organizationId` y opcionalmente por `userId` cuando el cliente envía el query `?userId=...`. **No existe lógica por rol**:
  - No se inyecta el `role` del usuario (OWNER/ADMIN vs MEMBER/VIEWER) en el request.
  - Si el front no envía `userId`, `findAll` devuelve **todos** los time entries de la organización.
  - Un Asociado (MEMBER) podría ver y modificar tiempos de otros si el front no filtra por su `userId`.

**Recomendación:**

1. Añadir un decorador o dato en el request que exponga el `User.role` (y `userId`) tras verificar el token con Clerk (por ejemplo en `ClerkAuthService` / TenantGuard).
2. En `TimeEntriesController.findAll` y en `TimeEntriesService.findAll`:
   - Si el usuario es **OWNER** o **ADMIN**: permitir ver todos los time entries de la organización (comportamiento actual cuando no se pasa `userId`).
   - Si el usuario es **MEMBER** o **VIEWER**: forzar `userId = request.userId` en el filtro para que solo vea sus propios registros.
3. En `findOne`, `update` y `remove`: para MEMBER/VIEWER, comprobar que el time entry pertenezca al usuario actual; si no, devolver 403.

Con esto la relación TimeEntry–Matter–Organization queda blindada por rol (Socio/Admin ve todo; Asociado solo lo suyo).

---

## 2. Escalabilidad del Audit Log (millones de registros)

### Estado actual: **Preparado para no ralentizar expedientes; mejorable para consultas masivas**

- **Modelo**: `AuditLog` tiene `organizationId`, `entityType`, `entityId`, `action`, `oldData`, `newData`, `createdAt`. Índices existentes: `@@index([organizationId])` y `@@index([entityType, entityId])`.
- **Uso**: El audit se usa solo para **escritura** (`AuditService.log`). Las consultas de expedientes (`matters.service.findOne`, listados, etc.) **no** incluyen `auditLogs` ni hacen JOIN con la tabla de audit. Por tanto, el crecimiento de `audit_logs` **no afecta** al rendimiento de las consultas de matters ni de documentos.
- **Riesgos a futuro**:
  - Si se añade una vista “Historial de cambios” que liste audit por matter u organización sin paginación ni límite, las consultas sobre millones de filas pueden ser lentas.
  - No hay índice compuesto `(organizationId, createdAt)` para listados por rango de fechas ni política de retención/archivo.

**Recomendación:**

1. Mantener la regla de no incluir `auditLogs` en las consultas normales de matters.
2. Si se implementa un endpoint “auditoría por expediente” o “por organización”:
   - Paginar siempre (cursor o offset) y limitar (p. ej. 50–100 por página).
   - Añadir índice `(organizationId, createdAt DESC)` para listados por tiempo.
3. A largo plazo: valorar particionamiento por `created_at` (p. ej. mensual) o archivo de registros antiguos a cold storage.

Con esto la tabla puede crecer a millones de registros sin alentar las consultas de expedientes; las consultas de auditoría serán acotadas y indexadas.

---

## 3. Seguridad del portal público (publicToken)

### Estado actual: **Token no predecible; falta mitigación ante fuerza bruta**

- **Generación**: En `matters.service.ts` el token se genera con `randomBytes(16).toString('base64url')`. Son 16 bytes (128 bits) de entropía criptográfica, base64url (~22 caracteres). No es secuencial ni predecible.
- **Unicidad**: `publicToken` tiene constraint `@unique` en el modelo Matter y índice en la BD.
- **Uso**: El endpoint público `GET /public/matters/:token` busca por `publicToken` y devuelve datos limitados (nombre, estado, fase, código, cliente, actividades públicas). No requiere autenticación.
- **Riesgo**: Un atacante podría intentar **fuerza bruta** probando tokens al azar. Con 128 bits el espacio es enorme, pero sin rate limiting muchas peticiones por segundo podrían suponer abuso o DoS.

**Recomendación:**

1. Mantener la generación actual (no reducir entropía).
2. Añadir **rate limiting** al controlador (o ruta) `GET /public/matters/:token` (p. ej. por IP: 30–60 req/min). Si usas Nest, se puede aplicar un throttle o un guard con Redis/memoria.
3. Opcional: registrar intentos fallidos (token no encontrado) por IP y, tras N fallos, bloquear temporalmente esa IP.

Con esto el token sigue sin ser predecible y se mitiga el riesgo de fuerza bruta.

---

## 4. Integración de plazos (computeDueDate y OrganizationHolidays)

### Estado actual: **Solo en backend; la interfaz no integra días hábiles**

- **Backend**:
  - Existe `DeadlinesService.computeDueDate(organizationId, fromDate, businessDays)`, que carga los `OrganizationHoliday` de la organización y usa `addBusinessDays` (días hábiles excluyendo fines de semana y festivos). La lógica está en `utils/deadline.util.ts`.
  - El endpoint `GET /deadlines/compute-due-date?from=...&businessDays=...` devuelve la fecha de vencimiento calculada.
- **Frontend**:
  - En `api.ts` (web) **no** hay ninguna llamada a `compute-due-date`.
  - Los plazos se crean con `createDeadline(..., { matterId, title, dueDate, ... })` donde `dueDate` es una cadena (fecha). Esa fecha viene del date picker del usuario o de la sugerencia de la IA en “Agendar plazo” (document-list), **sin** pasar por el cálculo de días hábiles.
  - La configuración de festivos (Settings → Festivos) existe y se guarda en BD; el backend ya la usa **solo** cuando se llama a `compute-due-date`.

**Conclusión:** La lógica de computeDueDate con OrganizationHolidays está correctamente implementada y utilizada **solo en el backend**. En la interfaz no se usa: al crear o sugerir plazos no se llama al endpoint de días hábiles, por lo que los festivos no se integran en los flujos de la UI.

**Recomendación:**

1. Donde la UI permita “vencimiento en N días hábiles” (o “N días hábiles desde hoy”), llamar a `GET /deadlines/compute-due-date?from=<hoy>&businessDays=N` y usar la `dueDate` devuelta al crear el deadline.
2. En el flujo “Agendar plazo” desde el documento (IA sugiere fecha): se puede seguir usando la fecha sugerida como referencia, u ofrecer un botón “N días hábiles desde hoy” que rellene la fecha vía `compute-due-date`.
3. Opcional: en el calendario o vista de plazos, si se muestra “días restantes”, considerar si debe ser “días hábiles” usando la misma utilidad (backend o réplica en front con festivos cargados) para coherencia.

---

## 5. Optimización de IA (resumen guardado vs recalculado)

### Estado actual: **Guardado en BD; no se recalcula cada vez**

- **Flujo**:
  1. Tras confirmar la subida del documento (`DocumentsService.confirmUpload`), si es PDF y hay `ANTHROPIC_API_KEY`, se marca `aiMetadata.status = 'processing'` y se dispara `LegalAIService.analyzeDocument(documentId)` en background.
  2. `LegalAIService.analyzeDocument` obtiene el texto del PDF, llama al modelo (Claude), parsea el JSON (summary, parties, deadlines, keyPoints) y llama a `updateDocumentResult(documentId, summary, aiMetadata)`.
  3. `updateDocumentResult` hace **un único** `prisma.document.update` guardando `aiSummary` y `aiMetadata` (status, parties, deadlines, keyPoints) en el documento.
- **Lecturas**: Cualquier consulta de documentos del matter (p. ej. `findByMatter`, `findOne`) devuelve el documento con `aiSummary` y `aiMetadata` ya persistidos. No se vuelve a llamar a la IA para mostrar el resumen.

**Conclusión:** El resumen de la IA **se guarda en la base de datos** (campos `ai_summary` y `ai_metadata` del modelo `Document`). No se recalcula en cada visualización, por lo que los costos de IA están acotados a la primera (y en principio única) análisis por documento.

**Recomendación (opcional):**

- Si en el futuro se permitiera “reanalizar” (p. ej. tras cambiar el modelo o el prompt), mantener la misma idea: una vez terminado el reanálisis, actualizar de nuevo `aiSummary` y `aiMetadata` y no recalcular en cada lectura.

---

## Resumen ejecutivo

| Área                         | Estado       | Acción prioritaria                                              |
|-----------------------------|-------------|------------------------------------------------------------------|
| TimeEntry por rol           | No blindado | Filtrar por userId para MEMBER/VIEWER; validar en findOne/update/remove |
| Audit log escalabilidad     | Aceptable   | No incluir audit en queries de matters; paginar y indexar si hay vista auditoría |
| publicToken                 | Fuerte      | Añadir rate limiting (y opcional bloqueo por IP) en endpoint público |
| Plazos + festivos en UI     | Parcial     | Usar GET compute-due-date en flujos “N días hábiles” en la interfaz |
| Resumen IA                  | Optimizado  | Mantener: guardar en BD y no recalcular en cada lectura          |
