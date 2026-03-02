/**
 * Copia el cliente Prisma generado (src/generated) a dist para que
 * require('../generated/prisma') resuelva en runtime.
 * Nest puede generar dist/ o dist/src/ según configuración; copiamos a ambos.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'generated');
const distRoot = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(src)) {
  console.warn('copy-prisma-generated: src/generated no existe. Ejecuta "prisma generate" antes.');
  process.exit(0);
}

const targets = [
  path.join(distRoot, 'generated'),      // dist/generated (Nest estándar)
  path.join(distRoot, 'src', 'generated'), // dist/src/generated
];

for (const dest of targets) {
  if (!fs.existsSync(distRoot)) break;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log('copy-prisma-generated: copiado a', path.relative(distRoot, dest));
  } catch (e) {
    console.warn('copy-prisma-generated:', dest, e.message);
  }
}
