#!/bin/sh
# Entrypoint del API: espera a Postgres, aplica migraciones y arranca.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: falta DATABASE_URL" >&2
  exit 1
fi

echo "→ Esperando a PostgreSQL..."
i=0
until pg_isready -d "$DATABASE_URL" -q; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "ERROR: PostgreSQL no respondió tras 60 intentos" >&2
    exit 1
  fi
  sleep 2
done
echo "→ PostgreSQL listo."

# CLI de Prisma invocado por ruta: node_modules/.bin no se copia a la imagen final.
echo "→ Aplicando migraciones (prisma migrate deploy)..."
node node_modules/prisma/build/index.js migrate deploy

echo "→ Arrancando API."
exec "$@"
