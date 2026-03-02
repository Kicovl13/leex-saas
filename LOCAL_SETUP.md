# LEX-SAAS — Cómo arrancar en local

## Requisitos

- Node 20+
- pnpm
- PostgreSQL (o Prisma Postgres local con `prisma dev`)
- Cuenta Clerk para auth

## 1. Instalar dependencias

Desde la raíz del monorepo:

```bash
pnpm install
```

## 1.1 Levantar infraestructura local (Postgres, Redis y n8n)

Desde la raíz del repo:

```bash
docker compose up -d
```

Servicios expuestos:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- n8n: `http://localhost:5678` (usuario/password por defecto: `admin` / `admin123`)
- LocalStack (SNS/SQS/KMS/S3): `http://localhost:4566`
- legal-ai-service: `http://localhost:8081`

Para apagar:

```bash
docker compose down
```

## 2. Backend (API)

```bash
cd apps/api
```

- Crea `.env` a partir de `.env.example` y configura al menos:
  - `PORT=3001` (recomendado para no chocar con Next.js en 3000)
  - `DATABASE_URL` (PostgreSQL o `prisma+postgres://...` si usas Prisma Postgres)
  - `CLERK_SECRET_KEY` y `CLERK_JWT_KEY` (Dashboard Clerk → API Keys)
  - Opcional: `CLERK_WEBHOOK_SIGNING_SECRET` para webhooks
  - Para callback interno de IA:
    - `INTERNAL_WEBHOOK_TOKEN=<token-seguro>`
  - Para publicar al workflow de n8n en local:
    - `EVENT_BUS_DOCUMENT_UPLOADED_URL=http://localhost:5678/webhook/document-uploaded`

Generar cliente Prisma y aplicar migraciones:

```bash
pnpm exec prisma generate
pnpm exec prisma migrate dev   # o prisma db push si no usas migraciones
```

Arrancar en desarrollo (con watch):

```bash
pnpm run start:dev
```

La API quedará en **http://localhost:3001** si usas `PORT=3001` (el frontend espera esa URL en `NEXT_PUBLIC_API_URL`).

Para compilar y ejecutar en modo producción:

```bash
pnpm run build
pnpm run start:prod
```

## 3. Frontend (Web)

```bash
cd apps/web
```

- Crea `.env.local` a partir de `.env.local.example` y **usa claves reales** (no dejes el placeholder `pk_test_...`):
  - En [Clerk Dashboard → API Keys](https://dashboard.clerk.com) copia **Publishable key** y **Secret key**.
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxx` (la clave real que empiece por `pk_test_` o `pk_live_`)
  - `CLERK_SECRET_KEY=sk_test_xxxx`
  - `NEXT_PUBLIC_API_URL=http://localhost:3000` (o el puerto donde corre la API)

Arrancar en desarrollo:

```bash
pnpm run dev
```

La web quedará en **http://localhost:3000** (Next.js; si hay conflicto usa otro puerto).

## 3.1 n8n — flujo mínimo para callback IA

1. Entra a `http://localhost:5678`.
2. Crea workflow con:
   - **Webhook** (ruta: `document-uploaded`)
   - **HTTP Request** (simula worker IA o llama tu worker real)
   - **HTTP Request** callback a API:
     - `POST http://localhost:3001/internal/documents/ai-result`
     - Header: `x-internal-token: <INTERNAL_WEBHOOK_TOKEN>`
3. Payload de callback de ejemplo:

```json
{
  "documentId": "11111111-1111-4111-8111-111111111111",
  "organizationId": "22222222-2222-4222-8222-222222222222",
  "status": "completed",
  "aiMetadata": {
    "summary": "Resumen generado por IA",
    "ocrContent": "Texto OCR del documento"
  }
}
```

## 3.2 Inicializar SNS/SQS en LocalStack (opcional recomendado)

Con AWS CLI configurado para LocalStack:

```bash
aws --endpoint-url=http://localhost:4566 sns create-topic --name lex-documents-uploaded
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name lex-documents-ai
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name lex-documents-dlq
```

Luego coloca en `apps/api/.env`:

```env
EVENT_BUS_MODE=sns
AWS_SNS_TOPIC_DOCUMENT_UPLOADED_ARN=arn:aws:sns:us-east-1:000000000000:lex-documents-uploaded
AWS_SQS_DLQ_URL=http://localhost:4566/000000000000/lex-documents-dlq
AWS_ENDPOINT_URL_SNS=http://localhost:4566
AWS_ENDPOINT_URL_SQS=http://localhost:4566
```

## 4. Clerk y localhost

Clerk **sí acepta localhost** en desarrollo:

- Usa la instancia **Development** en [Clerk Dashboard](https://dashboard.clerk.com) y las claves que empiezan por `pk_test_` y `sk_test_`. Con esas claves, `http://localhost:3000` (o el puerto que uses) funciona sin configurar nada más.
- Si en el Dashboard te pide añadir un dominio, en **Configure → Domains** (o **Paths**) añade `http://localhost:3000`.
- No uses claves de **Production** (`pk_live_` / `sk_live_`) para desarrollar en local: esas solo aceptan dominios de producción configurados.

## 5. "The provided Clerk Secret Key is invalid" (handshake)

Si ves este error en el frontend al cargar la app:

1. **Misma aplicación y entorno**  
   En [Clerk Dashboard](https://dashboard.clerk.com) → **API Keys**: la **Publishable key** (`pk_test_...`) y la **Secret key** (`sk_test_...`) deben ser de la **misma aplicación** y del mismo entorno (Development).

2. **Copia exacta de la Secret key**  
   No debe faltar ni sobrar ningún carácter. Sin espacios ni saltos de línea al final. Debe empezar por `sk_test_` (desarrollo) o `sk_live_` (producción).

3. **Probar con CLERK_JWT_KEY**  
   En el Dashboard → tu app → **API Keys** → busca **JWT public key** o **JWKS**. Copia la clave (formato PEM o JWKS) y en `apps/web/.env.local` añade:
   ```env
   CLERK_JWT_KEY=tu_jwt_key_aqui
   ```
   Reinicia `pnpm run dev`. A veces el handshake usa esta clave para verificar el token.

4. **Regenerar la Secret key**  
   En API Keys → **Secret keys** → **Regenerate** y vuelve a copiar la nueva clave a `CLERK_SECRET_KEY`.

## 6. Errores frecuentes

- **Frontend: "No se pudo cargar el resumen. Compruebe que la API esté en marcha"**  
  La web llama a `GET /dashboard/summary` en la URL de `NEXT_PUBLIC_API_URL` (p. ej. `http://localhost:3001`). Arranca la API en otra terminal (`cd apps/api && pnpm run start:dev`) y asegúrate de tener `PORT=3001` en `apps/api/.env` para que coincida con lo que tiene la web en `.env.local`.

- **Backend: "Cannot find module '../generated/prisma'"**  
  Ejecuta `pnpm run build` en `apps/api` (el script ya copia el cliente Prisma a `dist`). En desarrollo, `start:dev` usa el código en `src/` y el import apunta a `src/generated`, así que antes hay que haber ejecutado `prisma generate`.

- **Backend: "CLERK_WEBHOOK_SIGNING_SECRET is not set"**  
  Solo hace falta si vas a recibir webhooks de Clerk. Para login y uso normal no es obligatorio.

- **Frontend: 404 o CORS al llamar a la API**  
  Comprueba que `NEXT_PUBLIC_API_URL` en `.env.local` sea la URL correcta del backend (ej. `http://localhost:3000`).

- **Prisma: "url is no longer supported in schema"**  
  Estás en Prisma 7: la URL va en `prisma.config.ts` (datasource.url), no en el schema. Ver `apps/api/prisma.config.ts`.

## 7. Multi-organización y 403 al cambiar de organización

- **Un usuario puede tener varias organizaciones.** En Clerk un mismo usuario puede pertenecer a varias organizaciones (despachos). En LEX-CLOUD guardamos un registro **User** por cada par (organización, usuario de Clerk): al cambiar de organización, la API usa el mismo Clerk user pero el **User** de nuestra base de datos correspondiente a esa organización (y su rol).

- **403 al cambiar de organización o "La API ha rechazado la sesión (403)"** (incluso recargando):
  1. **Misma Secret Key en web y API.** En [Clerk Dashboard → API Keys](https://dashboard.clerk.com) copia la **Secret key** (sk_test_...). Pégala en `apps/web/.env.local` como `CLERK_SECRET_KEY` y en `apps/api/.env` como `CLERK_SECRET_KEY`. Debe ser exactamente la misma en ambos (misma aplicación Clerk).
  2. **Quitar CLERK_JWT_KEY de la API.** En `apps/api/.env` borra la línea `CLERK_JWT_KEY=...` o déjala vacía. Así la API verificará el token con JWKS por red y se evitan 403 por una PEM antigua o incorrecta.
  3. Reinicie la API (`pnpm run start:dev` en `apps/api`) y recargue la web (F5).
  4. En la terminal de la API, si sigue el 403, busque la línea `Clerk token verification failed. reason=... message=...`; el `reason` y `message` indican la causa (token expirado, firma inválida, etc.).
