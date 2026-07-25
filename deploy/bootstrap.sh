#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Planilla de Horas — puesta en marcha en un servidor Linux con Docker.
#
#   sudo bash deploy/bootstrap.sh
#
# Qué hace:
#   1. Verifica Docker y el plugin compose.
#   2. Genera .env con secretos aleatorios (si no existe).
#   3. Construye las imágenes y levanta el stack.
#   4. Aplica las migraciones (lo hace el entrypoint del API) y espera health.
#   5. Ofrece cargar los datos iniciales (seed) la primera vez.
#
# Es idempotente: volver a correrlo actualiza el stack sin perder datos ni
# pisar el .env existente.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMPOSE="docker compose -f docker-compose.prod.yml"

info()  { printf '\033[1;36m→ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── 1. Requisitos ───────────────────────────────────────────────────────────
info "Verificando Docker..."
command -v docker >/dev/null 2>&1 || fail "Docker no está instalado. Instalar con: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || fail "Falta el plugin 'docker compose' (v2)."
docker info >/dev/null 2>&1 || fail "El demonio de Docker no responde. Probar: sudo systemctl start docker"
ok "Docker disponible."

# ─── 2. Archivo .env ─────────────────────────────────────────────────────────
if [ -f .env ]; then
  ok ".env ya existe — se conserva."
else
  info "Generando .env con secretos aleatorios..."
  [ -f .env.docker.example ] || fail "Falta .env.docker.example"

  gen() { openssl rand -base64 36 | tr -d '\n/+=' | cut -c1-40; }

  read -rp "URL pública de la app (ej: https://planilla.tuempresa.com): " PUBLIC_URL
  [ -n "$PUBLIC_URL" ] || fail "La URL pública es obligatoria."
  PUBLIC_URL="${PUBLIC_URL%/}"

  echo
  echo "Modo de publicación:"
  echo "  1) HTTPS con dominio propio y certificado Let's Encrypt"
  echo "  2) HTTP puro — red interna (LAN) o detrás de Cloudflare Tunnel"
  read -rp "Opción [1/2]: " MODO
  if [ "$MODO" = "2" ]; then NGINX_CONF="./nginx.http.conf"; else NGINX_CONF="./nginx.conf"; fi

  sed \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(gen)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(gen)|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(gen)|" \
    -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" \
    -e "s|^NGINX_CONF=.*|NGINX_CONF=$NGINX_CONF|" \
    .env.docker.example > .env
  chmod 600 .env
  ok ".env generado (permisos 600). Guardarlo en un lugar seguro: contiene los secretos."
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

# ─── 3. Certificados (solo modo HTTPS) ───────────────────────────────────────
if [ "${NGINX_CONF:-./nginx.conf}" = "./nginx.conf" ]; then
  DOMINIO="$(echo "$PUBLIC_URL" | sed -e 's|^https\?://||' -e 's|/.*$||')"
  if grep -q 'PLANILLA_DOMINIO' nginx.conf; then
    info "Escribiendo el dominio $DOMINIO en nginx.conf..."
    sed -i "s|PLANILLA_DOMINIO|$DOMINIO|g" nginx.conf
  fi
  if [ ! -f "certs/live/$DOMINIO/fullchain.pem" ]; then
    warn "Todavía no hay certificado para $DOMINIO."
    warn "nginx no arranca sin él, así que el stack se levanta primero en modo HTTP"
    warn "para poder emitirlo. Después de que termine este script:"
    echo
    echo "    1) $COMPOSE --profile certbot run --rm certbot \\"
    echo "         certonly --webroot -w /var/www/certbot -d $DOMINIO --agree-tos -m TU_EMAIL"
    echo "    2) Cambiar NGINX_CONF=./nginx.conf en el .env"
    echo "    3) $COMPOSE up -d nginx"
    echo
    info "Arrancando en modo HTTP hasta que exista el certificado."
    sed -i 's|^NGINX_CONF=.*|NGINX_CONF=./nginx.http.conf|' .env
    NGINX_CONF="./nginx.http.conf"
    export NGINX_CONF
  fi
fi

# ─── 4. Construir y levantar ─────────────────────────────────────────────────
info "Construyendo imágenes (la primera vez tarda varios minutos)..."
$COMPOSE build

info "Levantando el stack..."
$COMPOSE up -d

info "Esperando a que el API responda..."
for i in $(seq 1 60); do
  if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok "API saludable."
    break
  fi
  [ "$i" -eq 60 ] && fail "El API no respondió. Revisar: $COMPOSE logs api"
  sleep 3
done

# ─── 5. Datos iniciales ──────────────────────────────────────────────────────
USUARIOS="$($COMPOSE exec -T db psql -U planilla_user -d planilla_horas -tAc 'SELECT COUNT(*) FROM usuarios' 2>/dev/null | tr -d '[:space:]' || echo 0)"
if [ "${USUARIOS:-0}" = "0" ]; then
  read -rp "La base está vacía. ¿Cargar datos iniciales (seed)? [s/N]: " R
  if [ "${R,,}" = "s" ]; then
    info "Cargando seed..."
    $COMPOSE exec -T api tsx prisma/seed.ts
    ok "Datos iniciales cargados."
  fi
else
  ok "La base ya tiene $USUARIOS usuarios — no se toca."
fi

# ─── Resumen ─────────────────────────────────────────────────────────────────
echo
ok "Stack en marcha."
echo "   App:      $PUBLIC_URL"
echo "   Estado:   $COMPOSE ps"
echo "   Logs:     $COMPOSE logs -f api"
echo "   Detener:  $COMPOSE down        (los datos sobreviven en los volúmenes)"
echo
echo "   Backups: el API genera un dump diario en el volumen 'planilla_backups'."
echo "   Copiarlo fuera del servidor con:"
echo "     docker run --rm -v planilla_backups:/b -v \$PWD:/out alpine tar czf /out/backups.tgz /b"
