#!/usr/bin/env bash
# LEX-SAAS — Arranque del sistema con un solo comando.
# Uso: ./start.sh   (o bash start.sh)
# Ctrl+C para detener la web; la API y Docker se detienen también.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Limpiando cachés ==="
rm -rf apps/api/dist
rm -rf apps/web/.next
[ -d apps/api/node_modules/.cache ] && rm -rf apps/api/node_modules/.cache
[ -d apps/web/node_modules/.cache ] && rm -rf apps/web/node_modules/.cache
echo "Caché de back (dist) y front (.next) limpiada."
echo ""

echo "=== Subiendo Postgres y Redis (Docker) ==="
docker compose up -d
echo ""

echo "=== Esperando a que Postgres acepte conexiones (5s) ==="
sleep 5
echo ""

echo "=== Aplicando migraciones Prisma ==="
cd apps/api && pnpm prisma migrate deploy && pnpm prisma generate
cd "$ROOT"
echo ""

API_PID=""
cleanup() {
  echo ""
  echo "=== Deteniendo API (PID $API_PID) ==="
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "=== Arrancando API (puerto 3001) en segundo plano ==="
pnpm run dev:api &
API_PID=$!
sleep 3
echo ""

echo "=== Arrancando Web (puerto 3000) en primer plano ==="
echo "Ctrl+C para detener la web y la API."
echo ""
pnpm run dev:web
