# Guía paso a paso: crear bucket S3 y usuario IAM para LEX-CLOUD

La API usa S3 para: (1) que el cliente suba documentos con una URL firmada, (2) que la IA descargue el PDF para analizarlo. Necesitas **un bucket** y **un usuario IAM** con acceso solo a ese bucket.

---

## Requisitos

- Cuenta de [AWS](https://aws.amazon.com/) (puedes crear una gratuita).
- En la consola usaremos **región** `eu-west-1` (Irlanda); si prefieres otra, cámbiala también en `apps/api/.env` (`AWS_REGION`).

---

## Parte 1: Crear el bucket S3

1. Entra en la consola de AWS: https://console.aws.amazon.com/
2. Arriba a la derecha elige la **región** (por ejemplo **eu-west-1**, Irlanda).
3. Busca **S3** en el buscador y entra en **S3**.
4. Pulsa **Create bucket**.
5. **Bucket name:** un nombre único global (ej: `lex-cloud-docs-tuempresa` o `lex-saas-docs-2025`). Anótalo.
6. **Region:** la misma que usarás en la API (ej: `eu-west-1`).
7. **Block Public Access:** deja **todas las casillas marcadas** (acceso público desactivado). La API usará credenciales IAM, no URLs públicas.
8. **Bucket Versioning:** puedes dejarlo en **Disable**.
9. El resto en por defecto. Pulsa **Create bucket**.

Ya tienes el bucket. El **nombre del bucket** es el valor de `AWS_S3_BUCKET` en `.env`.

---

## Parte 2: Crear usuario IAM solo para este bucket

1. En el buscador de la consola AWS escribe **IAM** y entra en **IAM**.
2. En el menú izquierdo: **Users** → **Create user**.
3. **User name:** por ejemplo `lex-cloud-s3-api`. Pulsa **Next**.
4. **Set permissions:** elige **Attach policies directly**. No añadas ninguna política todavía; pulsa **Next**.
5. Revisa y pulsa **Create user**.

Ahora daremos a ese usuario **solo** permiso sobre tu bucket (y solo las acciones que usa la API).

---

## Parte 3: Política para el usuario (solo tu bucket)

1. Sigue en **IAM** → **Users** → haz clic en el usuario que acabas de crear (ej: `lex-cloud-s3-api`).
2. Pestaña **Permissions** → **Add permissions** → **Create inline policy**.
3. Pestaña **JSON** y pega esto (sustituye `NOMBRE-DE-TU-BUCKET` por el nombre real del bucket, sin `s3://`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LexCloudBucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::NOMBRE-DE-TU-BUCKET/*"
    },
    {
      "Sid": "LexCloudBucketList",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::NOMBRE-DE-TU-BUCKET"
    }
  ]
}
```

4. **Next** → **Policy name:** `LexCloudS3Policy` → **Create policy**.

Con esto el usuario solo puede leer, escribir y borrar objetos en ese bucket (y listar el bucket). No puede tocar otros buckets ni otros servicios.

---

## Parte 4: Crear Access Key para el usuario

1. IAM → **Users** → tu usuario (`lex-cloud-s3-api`).
2. Pestaña **Security credentials**.
3. En **Access keys** pulsa **Create access key**.
4. Elige **Application running outside AWS** (o “Other”) → **Next** → **Create access key**.
5. Te mostrará:
   - **Access key ID** (ej: `AKIA...`).
   - **Secret access key** (solo se muestra una vez; cópiala ya).
6. Guárdalas en un lugar seguro. Cierra la ventana cuando termines.

---

## Parte 5: Configurar `apps/api/.env`

En `apps/api/.env` pon:

```env
AWS_S3_BUCKET=nombre-de-tu-bucket
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=tu-secret-access-key
```

- **AWS_S3_BUCKET:** el nombre exacto del bucket (Parte 1).
- **AWS_REGION:** la región del bucket (ej: `eu-west-1`).
- **AWS_ACCESS_KEY_ID** y **AWS_SECRET_ACCESS_KEY:** los de la Parte 4.

Guarda el archivo, **no subas `.env` a Git** (debe estar en `.gitignore`).

---

## Comprobar que funciona

1. Reinicia la API.
2. En la web: entra en un expediente → **Documentos** → sube un PDF.
3. Si la subida y la confirmación van bien, S3 está bien configurado. Si la IA tiene `ANTHROPIC_API_KEY`, en unos segundos verás el resumen del documento.

Si algo falla, revisa los logs de la API (errores de S3 o de credenciales).

---

## Resumen rápido

| Paso | Dónde | Qué hacer |
|------|--------|-----------|
| 1 | S3 Console | Create bucket → nombre único, región (ej. eu-west-1), Block Public Access ON |
| 2 | IAM → Users | Create user (ej. lex-cloud-s3-api), sin políticas aún |
| 3 | IAM → User → Permissions | Create inline policy (JSON) con PutObject, GetObject, DeleteObject, ListBucket sobre tu bucket |
| 4 | IAM → User → Security credentials | Create access key → guardar Access Key ID y Secret |
| 5 | apps/api/.env | AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY |
