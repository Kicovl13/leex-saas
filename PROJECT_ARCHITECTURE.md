# LEX-CLOUD — Arquitectura del Proyecto

Documentación técnica oficial del SaaS legal multi-tenant. Este documento describe la visión general, la arquitectura, el esquema de datos, los módulos implementados, la seguridad y la configuración necesaria para el MVP.

---

## 1. Visión general

### Propósito del SaaS

**LEX-CLOUD** es una plataforma SaaS orientada a despachos de abogados que centraliza la gestión de expedientes (matters), clientes, documentos, plazos procesales y facturación. El producto permite:

- Gestionar expedientes y clientes por organización (despacho).
- Subir documentos asociados a cada expediente con almacenamiento en la nube (S3).
- Analizar documentos legales (PDF) con **IA** para extraer resúmenes, partes, plazos y puntos clave.
- Gestionar plazos y agenda con cálculo de **días hábiles** (excluyendo fines de semana y festivos configurables).
- Visualizar un dashboard con resumen de actividad, semáforo de plazos y calendario mensual.
- Controlar el uso de la IA por plan (FREE, PRO, ENTERPRISE) para gestionar costes de API.

### Stack tecnológico

| Capa | Tecnología |
|------|------------|
| **Frontend** | Next.js 15+ (App Router), React 19, Tailwind CSS 4, Clerk (auth en el cliente) |
| **Backend** | NestJS 11, Node.js |
| **Base de datos** | PostgreSQL (Prisma ORM 7.x) |
| **Autenticación y organizaciones** | Clerk (JWT, multi-org) |
| **Almacenamiento de archivos** | AWS S3 (subida directa con URLs firmadas) |
| **IA / Análisis legal** | Claude 3.5 Sonnet vía Anthropic (LangChain) |

El frontend se comunica con la API NestJS enviando el JWT de Clerk en el header `Authorization: Bearer <token>`. La API verifica el token, sincroniza organización y usuario en la base de datos y aplica el aislamiento multi-tenant en todas las operaciones.

---

## 2. Arquitectura multi-tenant

### Principio de aislamiento

Cada **organización** (despacho) es la raíz del multi-tenancy. Los datos de clientes, expedientes, documentos, plazos, tiempos, tareas, festivos e facturas están siempre asociados a un `organizationId`. Un usuario solo puede operar dentro de la organización con la que ha iniciado sesión en Clerk.

### Flujo de contexto de organización

1. **Petición HTTP**  
   El cliente envía `Authorization: Bearer <token>` (JWT de Clerk).

2. **Tenant Middleware** (`TenantMiddleware`)  
   - Llama a `ClerkAuthService.verifyAndSync(authHeader)` para verificar el JWT y extraer `org_id` (o equivalente) de Clerk.
   - Sincroniza en la base de datos la **Organization** (por `clerk_org_id`) y el **User** (por `clerk_user_id` + `organization_id`), creándolos si no existen.
   - Establece en el request el `organizationId` (nuestro ID interno de Prisma).
   - Ejecuta el resto de la petición dentro de un **AsyncLocalStorage** (`tenantStorage`) que guarda `{ organizationId, userId }`.

3. **Tenant Guard** (`TenantGuard`)  
   En las rutas protegidas, comprueba que el request tenga `organizationId`. Si no lo tiene (por ejemplo, token sin org o inválido), responde con **403 Forbidden** y el mensaje *"Organization context required. Unauthorized tenant access."*.

4. **Extensión Prisma (`orgScope`)**  
   El cliente Prisma usado por la aplicación está extendido con `orgScopeExtension()`:
   - En **lecturas** (`findMany`, `findFirst`, `findUnique`, etc.): inyecta automáticamente `where: { organizationId }` usando el valor de `getOrganizationId()` (desde `tenantStorage`).
   - En **escrituras** (`create`, `createMany`): inyecta `organizationId` en el objeto `data` si no está presente.
   - Los modelos afectados son: `client`, `matter`, `document`, `deadline`, `timeEntry`, `task`, `organizationHoliday`, `invoice`.

Con esto, las consultas normales a través del cliente “scoped” (`prisma.document`, `prisma.matter`, etc.) **no pueden** devolver ni modificar datos de otra organización. Para operaciones que requieren comprobar existencia en otra org (por ejemplo, validar que un `matterId` pertenece a la org actual) se usa el cliente **raw** (`prisma.raw`) sin extensión, siempre acompañado de un `where` explícito con `organizationId`.

---

## 3. Esquema de base de datos

Resumen de los modelos principales y sus relaciones. Todos los recursos de negocio incluyen `organizationId`.

### Entidades principales

| Modelo | Descripción | Relaciones clave |
|--------|-------------|------------------|
| **Organization** | Despacho / tenant. Raíz del multi-tenancy. | `users`, `clients`, `matters`, `documents`, `deadlines`, `timeEntries`, `tasks`, `holidays`, `invoices`. Incluye `plan` (FREE/PRO/ENTERPRISE) y `settings` (JSON). |
| **User** | Usuario del despacho, vinculado a Clerk. | Pertenece a una `Organization`; `timeEntries`, `assignedTasks`. |
| **Client** | Cliente del despacho. | Pertenece a una `Organization`; tiene muchos `matters` e `invoices`. |
| **Matter** | Expediente. Centro de la aplicación. | `organization`, `client`; `documents`, `deadlines`, `timeEntries`, `tasks`, `invoices`. Estados: ACTIVE, ON_HOLD, CLOSED. |
| **Document** | Documento del expediente (fichero en S3). | `organization`, `matter`. Campos de IA: `aiSummary`, `aiMetadata` (JSON: status, parties, deadlines, keyPoints, error). |
| **Deadline** | Plazo / vencimiento. | `organization`, `matter`. Tipo: HEARING, FILING, RESPONSE, DISCOVERY, CONTRACT, STATUTE, OTHER. Soporta `completedAt`. |
| **TimeEntry** | Registro de tiempo facturable. | `organization`, `matter`, `user`. Incluye `minutes`, `billable`, `rateCents`, `date`. |
| **Task** | Tarea del expediente. | `organization`, `matter`, `assignedTo` (User). Estados: TODO, IN_PROGRESS, REVIEW, DONE. |
| **OrganizationHoliday** | Festivo por organización (para cálculo de días hábiles). | Solo `organization`. |
| **Invoice** / **InvoiceItem** | Factura y líneas. | `organization`, `client`, `matter` opcional; items con posible vínculo a `timeEntry`. |

### Enums relevantes

- **UserRole**: OWNER, ADMIN, MEMBER, VIEWER  
- **MatterStatus**: ACTIVE, ON_HOLD, CLOSED  
- **DeadlineType**: HEARING, FILING, RESPONSE, DISCOVERY, CONTRACT, STATUTE, OTHER  
- **TaskStatus**: TODO, IN_PROGRESS, REVIEW, DONE  
- **InvoiceStatus**: DRAFT, SENT, PAID, OVERDUE, CANCELLED  
- **Plan**: FREE (límite IA 5 docs/mes), PRO (100 docs/mes), ENTERPRISE (sin límite)

---

## 4. Módulos implementados

### 4.1 Auth y sincronización (Clerk)

- **ClerkAuthService**: Verifica el JWT de Clerk y sincroniza Organization y User en la base de datos (upsert por `clerk_org_id` y por `organizationId` + `clerkUserId`). Obtiene email y nombre del usuario desde la API de Clerk cuando está disponible.
- **TenantMiddleware**: Aplica la verificación y el run del contexto de tenant en `tenantStorage` para las rutas de: `clients`, `matters`, `deadlines`, `time-entries`, `dashboard`, `documents`.
- **TenantGuard**: Asegura que exista `organizationId` en el request antes de ejecutar los controladores protegidos.
- **OrganizationId** (decorador): Inyecta el `organizationId` del request en los parámetros de los controladores.

### 4.2 Gestión de expedientes (Matters)

- CRUD de expedientes filtrado por organización.
- Relación con Client; campos: name, description, status, matterType, referenceCode, openedAt, closedAt.
- El frontend lista expedientes, crea nuevos (diálogo) y navega al detalle por `matters/[id]` con pestañas: Resumen, Documentos, Línea de tiempo.

### 4.3 Sistema de documentos y subida directa a S3

- **Flujo**:
  1. El cliente solicita una **URL firmada** (POST `/documents/upload-url`) con `matterId`, `fileName`, `mimeType`, `sizeBytes`.
  2. La API comprueba que el matter pertenezca a la organización y crea el registro `Document` en estado “pendiente” con `aiMetadata: { status: 'pending' }`.
  3. El cliente sube el archivo con **PUT** directamente a S3 usando la URL firmada.
  4. El cliente llama a **POST `/documents/:id/confirm`** para confirmar la subida.
- **S3Service**: Genera URLs firmadas para `PutObject` y descarga objetos con `GetObject` (por ejemplo, para que la IA lea el PDF). Soporta configuración por variables de entorno (bucket, región, credenciales opcionales).
- Los documentos se listan por expediente (GET `/documents?matterId=...`). Todas las operaciones exigen `organizationId` (TenantGuard + Prisma scoped o comprobaciones con `raw`).

### 4.4 Legal AI Brain (Claude y metadatos)

- **LegalAIService** (LangChain + Anthropic):
  - Tras la confirmación de un documento PDF, si hay `ANTHROPIC_API_KEY`, se comprueba el **límite de uso por plan** (UsageLimitService) y se lanza el análisis en segundo plano.
  - Descarga el PDF desde S3, extrae texto (pdf-parse) y envía un prompt estructurado a **Claude 3.5 Sonnet** pidiendo JSON con: `summary`, `parties`, `deadlines` (descripción + fecha), `keyPoints`.
  - Actualiza el documento con `aiSummary` y `aiMetadata`: `status` (processing | done | failed), `parties`, `deadlines`, `keyPoints`, y en caso de error `error`.
- **UsageLimitService**: Cuenta documentos con `aiSummary` no nulo en el mes actual por organización. Según el plan (FREE=5, PRO=100, ENTERPRISE=ilimitado), `assertCanProcessDocument(organizationId)` lanza **Forbidden** si se supera el límite. Se invoca antes de encolar el análisis en `DocumentsService.confirmUpload`.

### 4.5 Sistema de plazos y agenda (días hábiles)

- **DeadlinesService**: CRUD de plazos; listado con filtros opcionales `matterId`, `from`, `to`; método `upcoming(organizationId, limit)` para el dashboard.
- **Cálculo de días hábiles** (`deadline.util.ts`): Excluye sábados y domingos y una lista configurable de festivos. Funciones: `isBusinessDay`, `addBusinessDays`, `subtractBusinessDays`, `countBusinessDays`. Los festivos se obtienen del modelo `OrganizationHoliday` por organización.
- **DeadlinesService.computeDueDate(organizationId, fromDate, businessDays)**: Suma N días hábiles a una fecha usando los festivos de la organización.
- **Frontend**:
  - **Semáforo de plazos**: Componente que agrupa plazos por urgencia (rojo &lt; 48h, naranja esta semana, verde &gt; 7 días) en Dashboard y en la pestaña Línea de tiempo del expediente.
  - **Calendario mensual**: Vista por mes con navegación; carga plazos por rango de fechas (y opcionalmente por `matterId` en la vista de expediente).
  - En el Sheet del resumen IA, si `aiMetadata.deadlines` existe, se muestra “Plazos Detectados” con botón **Agendar** por cada plazo; al confirmar se abre un formulario pre-rellenado y se crea un `Deadline` en la API (POST `/deadlines`).

### 4.6 Dashboard y tiempo facturable

- **DashboardService**: Agrega para la organización: número de expedientes activos, próximos vencimientos (deadlines), minutos/horas facturables del mes (TimeEntries).
- **TimeEntriesModule**: Registro de tiempo por matter y usuario; cálculo de minutos facturables en un periodo para el dashboard.

### 4.7 Otros módulos

- **Clients**: CRUD de clientes por organización.
- **Tasks**: Módulo de tareas (estructura preparada; integración con Matter).
- **Invoices**: Módulo de facturación (estructura preparada).

---

## 5. Seguridad

- **Autenticación**: Todas las rutas de negocio pasan por el **Tenant Middleware**, que verifica el JWT de Clerk y establece el contexto de organización. Las rutas protegidas usan además el **Tenant Guard**.
- **Aislamiento por organización**:  
  - Las lecturas y escrituras se realizan con el cliente Prisma extendido (`orgScope`), que inyecta `organizationId` en `where` y en `data`, de modo que no se pueden listar ni modificar recursos de otra organización.  
  - Donde se necesita validar pertenencia (por ejemplo, “este matter es de mi org”), se usa `prisma.raw` con `where: { id, organizationId }`; si no existe, las operaciones subsiguientes devuelven 404 o 403 según el caso.
- **403 Forbidden**: Se devuelve cuando:
  - No hay token o el token es inválido o ha expirado (Clerk).
  - El token no incluye contexto de organización (Clerk).
  - El Tenant Guard no encuentra `organizationId` en el request.
  - Se supera el límite de documentos con IA del plan (UsageLimitService).
- **S3**: El acceso a los objetos es mediante URLs firmadas con expiración; las claves incluyen `organizationId` y `matterId` para trazabilidad y posibles políticas de bucket.

---

## 6. Guía de variables de entorno

### API (NestJS) — `apps/api/.env`

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `DATABASE_URL` | Cadena de conexión PostgreSQL (o Prisma Postgres). | Sí |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk para verificar JWT y sincronizar usuarios. | Sí (para auth) |
| `CLERK_JWT_KEY` | Clave pública JWT de Clerk (verificación de token). | Sí (para auth) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Secreto de firma del endpoint de webhooks (Svix). Obligatorio para POST /auth/webhooks/clerk. | Sí (para webhooks) |
| `ANTHROPIC_API_KEY` | API key de Anthropic para Claude (análisis legal). | No (sin ella no se ejecuta IA) |
| `AWS_S3_BUCKET` | Nombre del bucket S3 para documentos. | Sí (para subida/descarga) |
| `AWS_REGION` | Región de AWS (p. ej. `eu-west-1`). | Recomendado |
| `AWS_ACCESS_KEY_ID` | Credenciales AWS (opcional si se usan roles IAM/entorno). | Según despliegue |
| `AWS_SECRET_ACCESS_KEY` | Credenciales AWS. | Según despliegue |

### Web (Next.js) — `apps/web/.env.local` (o equivalente)

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk para el cliente. | Sí |
| `CLERK_SECRET_KEY` | Clave secreta (para Server Components / webhooks si se usan). | Según uso |
| `NEXT_PUBLIC_API_URL` | URL base de la API NestJS (p. ej. `http://localhost:3001`). | Sí (para llamadas desde el frontend) |

Para entornos de producción, configurar las mismas variables con los valores adecuados y no versionar archivos `.env` con secretos.

---

## 7. Resumen de flujos clave

1. **Login y contexto**: Usuario inicia sesión con Clerk y selecciona organización → el frontend envía el JWT en cada petición a la API → la API sincroniza org/usuario y establece `organizationId` en el request y en AsyncLocalStorage → todas las queries Prisma (scoped) quedan limitadas a esa organización.
2. **Subir documento**: Frontend pide URL firmada → API crea `Document` y devuelve URL → Frontend hace PUT a S3 → Frontend confirma con POST `/documents/:id/confirm` → API comprueba límite de IA y, si aplica, lanza análisis con Claude en segundo plano.
3. **Plazos desde IA**: Usuario abre el Sheet del documento con resumen IA → ve “Plazos Detectados” → clic en “Agendar” → formulario con título y fecha sugeridos → POST `/deadlines` → el plazo aparece en semáforo y calendario (Dashboard y Línea de tiempo del expediente).
4. **Dashboard**: Resumen con expedientes activos, próximos vencimientos y horas facturables; semáforo de plazos y calendario mensual cargados vía GET `/deadlines` con filtros `from`/`to` (y opcionalmente `matterId` en la vista de expediente).

---

*Documento generado como referencia técnica oficial del proyecto LEX-CLOUD (MVP).*
