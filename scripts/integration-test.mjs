#!/usr/bin/env node
/**
 * Script de prueba integral del flujo de negocio (LEX-SAAS).
 *
 * Crea: festivo (mañana), cliente, expediente, plazo (pasado mañana), tarea
 * asignada y la marca DONE. Verifica que completedAt se guarde.
 *
 * Uso:
 *   export API_BASE="http://localhost:3001"
 *   export CLERK_TOKEN="<bearer_token_de_clerk>"
 *   node scripts/integration-test.mjs
 *
 * El token se puede obtener tras iniciar sesión en la app (p. ej. desde DevTools
 * o temporalmente con getToken() en un componente).
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const TOKEN = process.env.CLERK_TOKEN;

if (!TOKEN) {
  console.error('Falta CLERK_TOKEN. Ejemplo: export CLERK_TOKEN="bearer_..."');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

function datePlusDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out.toISOString().slice(0, 10);
}

async function api(method, path, body = undefined) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : undefined;
}

async function main() {
  const today = new Date();
  const tomorrow = datePlusDays(today, 1);
  const dayAfterTomorrow = datePlusDays(today, 2);

  console.log('Fechas usadas: mañana =', tomorrow, ', pasado mañana =', dayAfterTomorrow);
  console.log('');

  // 1. Festivo (mañana)
  const holiday = await api('POST', '/settings/holidays', {
    date: tomorrow,
    name: 'Festivo prueba integración',
  });
  console.log('1. Festivo creado:', holiday.id, holiday.date);

  // 2. Cliente
  const client = await api('POST', '/clients', {
    name: 'Cliente prueba integración',
    email: 'prueba@test.local',
    phone: '+34 600 000 000',
    taxId: '12345678A',
    notes: 'Creado por integration-test.mjs',
  });
  console.log('2. Cliente creado:', client.id, client.name);

  // 3. Expediente
  const matter = await api('POST', '/matters', {
    name: 'Expediente prueba integración',
    clientId: client.id,
    status: 'ACTIVE',
  });
  console.log('3. Expediente creado:', matter.id, matter.name);

  // 4. Plazo (vencimiento pasado mañana)
  const dueDate = `${dayAfterTomorrow}T17:00:00.000Z`;
  const deadline = await api('POST', '/deadlines', {
    matterId: matter.id,
    title: 'Plazo prueba integración',
    dueDate,
    deadlineType: 'OTHER',
    notes: 'Vence pasado mañana; mañana es festivo.',
  });
  console.log('4. Plazo creado:', deadline.id, 'dueDate:', dueDate);

  // 5. Usuarios para asignar
  let assignedToId = null;
  try {
    const users = await api('GET', '/users');
    if (Array.isArray(users) && users.length > 0) {
      assignedToId = users[0].id;
      console.log('5. Usuario para asignar:', users[0].name || users[0].email);
    }
  } catch (e) {
    console.log('5. No se pudo cargar usuarios (opcional):', e.message);
  }

  // 6. Tarea y marcar DONE
  const task = await api('POST', '/tasks', {
    matterId: matter.id,
    title: 'Tarea prueba integración',
    assignedToId: assignedToId || undefined,
  });
  console.log('6. Tarea creada:', task.id, task.title);

  const updated = await api('PATCH', `/tasks/${task.id}`, { status: 'DONE' });
  console.log('7. Tarea marcada DONE. completedAt:', updated.completedAt ?? '(null)');

  // 8. Verificación: GET task y comprobar completedAt
  const tasks = await api('GET', `/tasks?matterId=${matter.id}`);
  const doneTask = tasks?.find((t) => t.id === task.id);
  const completedAtOk = doneTask && doneTask.status === 'DONE' && doneTask.completedAt != null;

  if (completedAtOk) {
    console.log('');
    console.log('Verificación: completedAt guardado correctamente en la DB (vía API).');
  } else {
    console.error('');
    console.error('Verificación fallida: la tarea no tiene status DONE y completedAt.');
    console.error('Respuesta GET tasks:', JSON.stringify(doneTask, null, 2));
    process.exit(1);
  }

  console.log('');
  console.log('IDs para comprobaciones manuales:');
  console.log('  Matter ID:', matter.id);
  console.log('  Cliente:', client.id);
  console.log('  Plazo:', deadline.id);
  console.log('  Tarea:', task.id);
  console.log('');
  console.log('Siguiente: subir un PDF en el expediente y confirmar; revisar /settings (contador IA +1).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
