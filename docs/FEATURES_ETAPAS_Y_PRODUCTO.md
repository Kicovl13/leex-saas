# Funcionalidades: Etapas configurables y ampliación de producto

Resumen de lo implementado para etapas por tipo de materia, clientes, comunicaciones, tiempo y presupuesto.

## 1. Etapas configurables por tipo de materia

- **Schema**: `Matter.stage` pasa de enum fijo a `String`. Nueva tabla `MatterStageDefinition` (organizationId, matterType, key, label, sortOrder). Si `matterType` es null, son las etapas por defecto de la organización.
- **API**:
  - `GET /matters/stages?matterType=...` — lista etapas para la org (y opcionalmente para un tipo). Si no hay definiciones, devuelve las por defecto (Borrador, Presentado, Pruebas, Sentencia, Ejecución).
  - En el futuro se puede añadir `PUT /matters/stages` para que la org guarde sus propias etapas (el servicio `MatterStagesService.setStages` ya existe).
- **Web**: El selector de etapa en la ficha del expediente carga las etapas vía API según el `matterType` del expediente. El diálogo de edición también usa etapas desde la API.

**Migración**: `20260220100000_matter_stages_configurable`

---

## 2. Clientes: contactos adicionales

- **Schema**: Nueva tabla `ClientContact` (organizationId, clientId, name, role, email, phone, isPrimary, notes).
- **API**:
  - `GET /clients/:id/contacts` — listar contactos del cliente
  - `POST /clients/:id/contacts` — crear contacto
  - `PATCH /clients/:id/contacts/:contactId` — actualizar
  - `DELETE /clients/:id/contacts/:contactId` — eliminar
- **Web**: Tipo `ClientContact` y funciones `getClientContacts`, `createClientContact`, `updateClientContact`, `deleteClientContact` en `lib/api.ts`. `getClient` devuelve ya `contacts` incluidos.

**Migración**: `20260220110000_client_contacts_and_communications`

---

## 3. Comunicaciones del expediente

- **Schema**: Nueva tabla `MatterCommunication` (organizationId, matterId, type, subject, occurredAt, notes, userId). `type`: email | call | meeting.
- **API**:
  - `GET /matters/:id/communications` — listar comunicaciones
  - `POST /matters/:id/communications` — crear (body: type, subject?, occurredAt, notes?)
- **Web**: Tipos `MatterCommunication` y funciones `getMatterCommunications`, `createMatterCommunication` en `lib/api.ts`.

**Migración**: misma que contactos (`20260220110000_client_contacts_and_communications`).

---

## 4. Tiempo y presupuesto

- **Schema**:
  - `TimeEntry.activityType` (string opcional): ej. litigio | asesoria | reunion | documentacion | otro.
  - `Matter.budgetHours` (Decimal opcional): presupuesto en horas para alertas.
- **API**:
  - Crear/actualizar time entry acepta `activityType`.
  - Actualizar matter acepta `budgetHours`. El detalle del expediente devuelve `budgetHours` como número.
- **Web**: En el diálogo de edición del expediente se añadió el campo "Presupuesto (horas)". Tipo `MatterDetail` y `updateMatter` incluyen `budgetHours`.

**Migración**: `20260220120000_matter_budget_and_time_activity_type`

---

## Cómo aplicar

```bash
cd apps/api
pnpm prisma migrate deploy
pnpm prisma generate
pnpm run build
```

La primera migración convierte `matters.stage` de enum a texto y crea `matter_stage_definitions`. Si hay datos existentes, los valores actuales (BORRADOR, etc.) se mantienen como texto.

---

## Pendiente / sugerido

- **UI** para contactos del cliente en la ficha de cliente.
- **UI** para historial de comunicaciones en la ficha del expediente (y formulario para alta).
- **Configuración de etapas** en ajustes de la organización (uso de `MatterStagesService.setStages`).
- **Tareas sin expediente** (recordatorios): requeriría `Task.matterId` opcional y filtros en listados.
- **Documentos/plantillas por tipo**: el modelo `Document` ya tiene `classification`; las plantillas están en `Template` (por org). Se puede asociar plantillas a `matterType` en configuración o en el modelo.
