#!/bin/sh
# Генерирует client/config.js из RAUT_PUBLIC_URL и запускает сервер.
set -e
: "${RAUT_DISCOVERY_URL:=https://api.github.com/repos/MatronixOwner/Raut/contents/SERVER_URL.txt?ref=arena/d55d4f5c-raut}"
export RAUT_DISCOVERY_URL
node -e 'const fs=require("fs");const u=(process.env.RAUT_PUBLIC_URL||"").replace(/\/+$/,"");fs.writeFileSync("/app/client/config.js","window.RAUT_DEFAULT_SERVER = "+JSON.stringify(u)+";\nwindow.RAUT_DISCOVERY_URL = "+JSON.stringify(process.env.RAUT_DISCOVERY_URL||"")+";\n")'
if [ -n "${RAUT_PUBLIC_URL:-}" ]; then
  exec node server/index.js \
    --host "${RAUT_HOST:-0.0.0.0}" --port "${RAUT_PORT:-8787}" \
    --data "${RAUT_DATA_DIR:-/data}" --client /app/client \
    --public-url "$RAUT_PUBLIC_URL"
fi
exec node server/index.js \
  --host "${RAUT_HOST:-0.0.0.0}" --port "${RAUT_PORT:-8787}" \
  --data "${RAUT_DATA_DIR:-/data}" --client /app/client
