# syntax=docker/dockerfile:1
# Imagen de producción del API (planilla-api).
#
# Base Debian (no Alpine) a propósito: bcrypt trae prebuilds glibc y el cliente
# oficial de PostgreSQL 16 se instala desde el repo PGDG. pg_dump/pg_restore son
# obligatorios en la imagen final porque el backup automático (src/utils/backup.service.ts)
# los invoca desde dentro del contenedor.

# ─── Etapa 1: build (deps completas + prisma generate + tsc) ──────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# python3/make/g++ solo por si bcrypt tiene que compilarse desde fuente
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Etapa 2: node_modules solo de producción ─────────────────────────────────
FROM node:20-bookworm-slim AS deps-prod
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Etapa 3: imagen final ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    TZ=America/Argentina/Buenos_Aires

# Cliente de PostgreSQL 16 desde el repo oficial PGDG.
# La versión debe coincidir con la del servidor (postgres:16-alpine): un pg_dump
# más viejo que el servidor aborta con "server version mismatch".
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg openssl tzdata \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
         -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y --auto-remove gnupg curl \
    && rm -rf /var/lib/apt/lists/*

# tsx: el seed y los scripts de mantenimiento de prisma/ son TypeScript y se
# ejecutan dentro del contenedor (docker compose exec api tsx prisma/seed.ts)
RUN npm install -g tsx@4.19.2 && npm cache clean --force

# node_modules de producción + el cliente Prisma ya generado en el builder
COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder   /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder   /app/node_modules/@prisma ./node_modules/@prisma
# CLI de Prisma (bundle autocontenido) — necesario para `migrate deploy` al arrancar
COPY --from=builder   /app/node_modules/prisma ./node_modules/prisma

COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Directorios montados como volúmenes: se crean con owner node para que el
# volumen nombrado herede esos permisos al inicializarse.
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/uploads /app/backups/primary /app/backups/secondary \
    && chown -R node:node /app/uploads /app/backups

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/app.js"]
