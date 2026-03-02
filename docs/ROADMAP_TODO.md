# LEX-SAAS — Roadmap & TODO

Seguimiento de funcionalidades implementadas y pendientes.

---

## ✅ Completado

- [x] **Etapas configurables por tipo de materia** — Schema, API (`GET/PUT /matters/stages`), UI selector dinámico y pestaña en Configuración
- [x] **Contactos del cliente** — Schema `ClientContact`, API CRUD, UI en ficha del cliente (lista + crear/editar/eliminar)
- [x] **Comunicaciones del expediente** — Schema `MatterCommunication`, API GET/POST, pestaña Comunicaciones en expediente (lista + registrar)
- [x] **Presupuesto por expediente** — Campo `budgetHours`, API, campo en formulario de edición
- [x] **Tipo de actividad en time entries** — Campo `activityType`, API
- [x] **UI configuración de etapas** — Pestaña "Etapas" en Configuración (definir etapas por tipo de asunto)
- [x] **Tareas sin expediente / recordatorios** — Schema `Task.matterId` opcional, API list/create sin matterId, página "Recordatorios" y enlace en sidebar
- [x] **Plantillas por tipo de expediente** — Schema `Template.matterType`, API filtrar por matterType, selector en "Generar desde plantilla" filtra por tipo del expediente
- [x] **Tipos de actividad configurables** — Schema `OrganizationActivityType`, API `GET/PUT /settings/activity-types`, pestaña en Configuración y selector al registrar tiempo

---

## ✅ Portal del cliente ampliado

- [x] **Subida de documentos por parte del cliente** — `POST /api/public/matters/:token/documents` (multipart); botón en la página del portal
- [x] **Visibilidad de hitos / etapas** — El portal ya muestra estado, fase y actuaciones públicas
- [x] **Mensajes al cliente** — Sección "Mensaje para el cliente" en bitácora (visible en portal); portal muestra "Mensajes del despacho"

---

## 🔲 Pendiente: Corporativo / Contratos

- [x] Tipos de asunto y etapas específicas — **Cubierto** con la configuración de etapas por tipo (Configuración → Etapas; indicar tipo "Contrato", "Corporativo", etc. y definir sus etapas)
- [x] **Campos específicos por tipo** — `Matter.customFields` (JSON); UI para Corporativo (fecha junta, partes) y Contratos (partes, entrada en vigor, vencimiento); visibles en portal

---

## 🔲 TODO — Nuevas funcionalidades

### Prioridad alta
- [x] **Búsqueda global (cmd+k)** — Endpoint `GET /search?q=`; expedientes, clientes, plazos y documentos; teclado (↑↓ Enter)
- [x] **Dashboard mejorado** — KPIs por abogado (expedientes activos, tareas, horas registradas); gráfico de barras de carga
- [ ] **Recordatorios por email** — Notificar plazos cercanos (3–7 días antes); opción de recordatorios por expediente o tipo de plazo

### Prioridad media
- [ ] **Firma electrónica** — Integrar proveedor (PandaDoc, DocuSign, etc.) para documentos que requieren firma; flujo enviar → firmar → guardar copia firmada
- [ ] **Módulo de conflictos de interés** — Comprobar cliente/contraparte al crear expediente; extender `checkConflict` para bloquear o alertar
- [ ] **Reportes de tiempo** — Gráficos de tiempo por expediente/cliente/abogado; exportar informes (PDF/Excel) de actividad por periodo
- [ ] **Comparación de versiones de documentos** — Vista diff entre versiones; etiquetar versiones (borrador, final, firmado)

### Prioridad media/baja
- [ ] **Calendario de plazos** — Vista calendario mensual/semanal de plazos; integración Google Calendar / Outlook
- [ ] **Multi-idioma (i18n)** — Soporte inglés además de español en toda la UI
- [ ] **Auditoría visible** — Histórico de cambios por expediente/documento visible para el usuario (quién modificó qué y cuándo)
- [ ] **API pública / webhooks** — Webhooks para eventos (documento subido, plazo vencido); API REST documentada para integraciones externas

---

## ✅ Eliminado: Facturación y pagos

- [x] **Quitado todo lo relacionado con facturas y pagos** — modelos Invoice/InvoiceItem, API, pestaña Finanzas, endpoints AI de facturas

---

## Migraciones

```bash
cd apps/api
pnpm prisma migrate deploy
pnpm prisma generate
```

Migraciones creadas:
- `20260220100000_matter_stages_configurable`
- `20260220110000_client_contacts_and_communications`
- `20260220120000_matter_budget_and_time_activity_type`
- `20260220130000_task_optional_matter_template_mattertype_activity_types`
- `20260220140000_matter_custom_fields`
- `20260220150000_remove_invoices`
