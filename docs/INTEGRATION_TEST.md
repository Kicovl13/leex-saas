# Prueba integral del flujo de negocio (LEX-SAAS)

Esta guía permite verificar que el “cableado” completo funciona: festivos, clientes, expedientes, plazos, documentos con IA, tareas y uso en Configuración.

**Requisitos:** API y Web en marcha; usuario logueado en la app con una organización activa; opcional: `ANTHROPIC_API_KEY` y S3 para el paso del documento.

---

## Resumen de pasos

| Paso | Acción | Verificación |
|------|--------|--------------|
| 1 | Festivo (mañana), Cliente, Expediente | Festivo en /settings; cliente y expediente visibles |
| 2 | Plazo que vence pasado mañana | Plazo en dashboard/detalle; festivo excluido del cómputo de días hábiles |
| 3 | Subir PDF y confirmar | Resumen IA en el documento; contador en /settings +1 |
| 4 | Tarea asignada y marcada | Tarea DONE con `completedAt` en DB |

---

## Paso 1: Festivo, Cliente y Expediente

### 1.1 Crear un festivo (mañana)

- Ir a **Configuración** (`/settings`).
- En “Festivos”, elegir **Fecha** = **mañana** (ej. si hoy es 13 feb 2026 → 14 feb 2026).
- Nombre opcional (ej. “Festivo prueba”).
- Pulsar **Añadir festivo**.
- **Verificación:** La fila aparece en la lista de festivos.

### 1.2 Crear un cliente

- Ir a **Clientes** (`/clients`).
- Pulsar **Nuevo cliente**.
- Rellenar: Nombre, Email, Teléfono, DNI/CIF si quieres, Notas.
- Guardar.
- **Verificación:** El cliente sale en la tabla; al hacer clic se ve su detalle (sin expedientes aún).

### 1.3 Crear un expediente para ese cliente

- Ir a **Expedientes** (`/matters`).
- Pulsar **Nuevo expediente**.
- Nombre (ej. “Expediente prueba integración”), Cliente = el recién creado, Estado = Activo.
- Guardar.
- **Verificación:** El expediente aparece en la lista; al abrirlo ves Resumen, Documentos, Tareas, Línea de tiempo.

**Alternativa con script:** ver sección “Script de prueba” más abajo para automatizar 1.1–1.3 (y plazos/tareas) con un token Bearer.

---

## Paso 2: Plazo que vence pasado mañana

- Abrir el **expediente** creado en 1.3.
- Añadir un **plazo (Deadline)** con vencimiento **pasado mañana**:
  - En la UI actual los plazos se crean desde la pestaña **Documentos**: al abrir un documento analizado por IA, en “Plazos detectados” puedes usar **Agendar plazo** y elegir fecha = pasado mañana. Si no tienes aún documento con IA, crea el plazo con el **script de prueba** (más abajo) o con `curl` POST a `/deadlines` (matterId, title, dueDate en ISO).
  - Fecha de vencimiento = **pasado mañana** (ej. 15 feb 2026); título a elección.
- Guardar.

**Verificación:**

- El plazo aparece en el detalle del expediente y/o en el **Dashboard** en “Próximos vencimientos”.
- **Festivo y días hábiles:** El sistema usa la tabla `OrganizationHoliday` en el cálculo de días hábiles (`deadline.util.ts` y `DeadlinesService.computeDueDate`). Al tener **mañana** como festivo:
  - “Hoy + 1 día hábil” = pasado mañana (mañana no cuenta).
  - El plazo que has puesto a “pasado mañana” es coherente con ese criterio. Cualquier cálculo futuro que use “N días hábiles” excluirá automáticamente el festivo.

Si en tu UI existe una pantalla de “calcular vencimiento” (días hábiles), prueba ahí añadiendo 1 día hábil desde hoy y comprueba que la fecha resultante sea pasado mañana.

---

## Paso 3: Documento PDF y contador de IA

- En el mismo **expediente**, pestaña **Documentos**.
- Subir un **PDF de prueba** (cualquier documento legal o texto en PDF).
- Completar el flujo de subida y **confirmar** el documento en la app.

**Verificación:**

1. **Resumen IA:** Tras unos segundos, en el detalle del documento debe aparecer el **resumen** (y si aplica, partes, plazos, puntos clave) generado por la IA.  
   - Requiere `ANTHROPIC_API_KEY` y S3 configurados. Si no, el documento se confirma pero no se generará resumen.

2. **Contador en Configuración:** Ir a **Configuración** (`/settings`). En “Perfil de plan” debe verse:
   - **Documentos analizados con IA este mes: X / Límite**
   - Tras confirmar **un** PDF procesado por IA, **X debe haber subido en +1** (recarga la página si hace falta).

---

## Paso 4: Tarea asignada y marcada como hecha

- En el **mismo expediente**, pestaña **Tareas**.
- Añadir una tarea (ej. “Revisar documentación”).
- En el desplegable **Asignar a**, elegir un usuario de la organización (o “Sin asignar” si solo hay un usuario).
- Marcar el **checkbox** de la tarea para pasarla a **DONE**.

**Verificación en la UI:** La tarea se muestra tachada y con estilo de completada.

**Verificación en base de datos:** La tarea debe tener `completedAt` rellenado:

```sql
SELECT id, title, status, "completedAt" FROM tasks WHERE "matterId" = '<ID_DEL_EXPEDIENTE>' ORDER BY "updatedAt" DESC LIMIT 5;
```

O vía API (con token Bearer):

```bash
curl -s -H "Authorization: Bearer $CLERK_TOKEN" "$API_BASE/tasks?matterId=<MATTER_ID>" | jq '.[] | {title, status, completedAt}'
```

Debe aparecer `"status": "DONE"` y `"completedAt": "<fecha ISO>"` no nula.

---

## Script de prueba (automatización parcial)

En la raíz del proyecto hay un script que, con un **token Bearer de Clerk** y la **URL de la API**, crea:

- Un festivo con fecha **mañana**
- Un cliente
- Un expediente para ese cliente
- Un plazo con vencimiento **pasado mañana**
- Una tarea en el expediente, asignada a un usuario de la org (si hay), y la marca como **DONE**

Luego hace un GET de esa tarea y comprueba que `completedAt` viene rellenado.

**Cómo obtener el token (ejemplo):** Con la app web abierta y sesión iniciada, en DevTools → Application → Local Storage (o donde guarde Clerk el token), o usando temporalmente en la app un `console.log(await getToken({ orgId }))` en un componente que se renderice tras login, y copiar el valor.

**Uso:**

```bash
export API_BASE="http://localhost:3001"   # o la URL de tu API
export CLERK_TOKEN="<tu_token_bearer>"
node scripts/integration-test.mjs
```

El script imprime los IDs creados y si la verificación de `completedAt` pasó. Los pasos de **subida de PDF** (Paso 3) y la comprobación visual en **Configuración** y en la UI siguen siendo manuales.

---

## Checklist final

- [ ] Festivo “mañana” creado y visible en /settings.
- [ ] Cliente creado y visible en /clients y en detalle.
- [ ] Expediente creado para ese cliente y visible en /matters.
- [ ] Plazo “pasado mañana” creado en el expediente; visible en dashboard/detalle; criterio de días hábiles con festivo correcto.
- [ ] PDF subido y confirmado; resumen IA visible en el documento.
- [ ] En /settings el contador “Documentos analizados con IA este mes” ha aumentado en +1.
- [ ] Tarea creada, asignada y marcada como hecha; en DB la tarea tiene `status = DONE` y `completedAt` no nulo.
