# syntax=docker/dockerfile:1
# Imagen de producción del frontend (planilla-web): build de Vite servido por nginx.
#
# VITE_API_URL se deja VACÍO a propósito: src/services/api.ts usa
# `import.meta.env.VITE_API_URL || ''`, así que con string vacío el front llama
# a rutas relativas (/api/v1/...) y el nginx del borde las enruta al API. Eso
# hace que la misma imagen sirva para cualquier dominio, sin rebuild.

# ─── Etapa 1: build ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ─── Etapa 2: servidor estático ───────────────────────────────────────────────
FROM nginx:alpine AS runner

ENV TZ=America/Argentina/Buenos_Aires

COPY nginx.web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Escucha en 3000 para que el upstream `web:3000` del nginx del borde no cambie
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1
