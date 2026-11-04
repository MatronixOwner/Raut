#!/bin/sh
# Универсальная точка входа: VPS (docker compose), Render, Railway, Northflank.
# Сама определяет публичный адрес и порт, которые выдаёт платформа, генерирует
# client/config.js и запускает сервер. Никаких ручных настроек.
set -e

: "${RAUT_DISCOVERY_URL:=https://api.github.com/repos/MatronixOwner/Raut/contents/SERVER_URL.txt?ref=arena/d55d4f5c-raut}"
export RAUT_DISCOVERY_URL

# Публичный адрес: явная переменная, либо то, что выдаёт сама платформа.
PUBLIC_URL="${RAUT_PUBLIC_URL:-}"
if [ -z "$PUBLIC_URL" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  PUBLIC_URL="$RENDER_EXTERNAL_URL"
fi
if [ -z "$PUBLIC_URL" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  PUBLIC_URL="https://$RAILWAY_PUBLIC_DOMAIN"
fi
if [ -z "$PUBLIC_URL" ] && [ -n "${KOYEB_PUBLIC_DOMAIN:-}" ]; then
  PUBLIC_URL="https://$KOYEB_PUBLIC_DOMAIN"
fi
PUBLIC_URL="${PUBLIC_URL%/}"

# Render/Railway сами назначают PORT; на VPS остаётся 8787.
PORT="${PORT:-${RAUT_PORT:-8787}}"
HOST="${RAUT_HOST:-0.0.0.0}"
DATA="${RAUT_DATA_DIR:-/data}"

export RAUT_EFFECTIVE_URL="$PUBLIC_URL"
node -e 'const fs=require("fs");const u=(process.env.RAUT_EFFECTIVE_URL||"").replace(/\/+$/,"");fs.writeFileSync("/app/client/config.js","window.RAUT_DEFAULT_SERVER = "+JSON.stringify(u)+";\nwindow.RAUT_DISCOVERY_URL = "+JSON.stringify(process.env.RAUT_DISCOVERY_URL||"")+";\n")'
mkdir -p "$DATA"

set -- --host "$HOST" --port "$PORT" --data "$DATA" --client /app/client
if [ -n "$PUBLIC_URL" ]; then
  set -- "$@" --public-url "$PUBLIC_URL"
fi
exec node server/index.js "$@"
