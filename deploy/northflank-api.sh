#!/usr/bin/env bash
# Создаёт Combined service Raut на Northflank через официальный REST API.
# Альтернатива кликам из northflank.md; удобно, если деплой делает агент.
#
#   NORTHFLANK_API_TOKEN=xxx PROJECT_ID=raut bash deploy/northflank-api.sh
#   DRY_RUN=1 NORTHFLANK_API_TOKEN=x PROJECT_ID=x bash deploy/northflank-api.sh  # только JSON
#
# Схема: https://northflank.com/docs/v1/api/project/services/create-combined-service
# Токен: Account settings → API → Create token (право Project > Services > General > Create).
set -euo pipefail

: "${NORTHFLANK_API_TOKEN:?задайте NORTHFLANK_API_TOKEN}"
: "${PROJECT_ID:?задайте PROJECT_ID (имя проекта в Northflank)}"

NAME="${RAUT_SERVICE:-raut}"
BRANCH="${RAUT_BRANCH:-arena/d55d4f5c-raut}"
REPO="${RAUT_REPO:-https://github.com/MatronixOwner/Raut}"
PLAN="${RAUT_PLAN:-nf-compute-20}"

read -r -d '' BODY <<JSON || true
{
  "name": "$NAME",
  "description": "Raut shared server: accounts, friends, DMs, chat, voice signaling",
  "billing": { "deploymentPlan": "$PLAN" },
  "deployment": {
    "type": "statefulSet",
    "instances": 1,
    "docker": { "configType": "default" },
    "storage": { "ephemeralStorage": { "storageSize": 1024 } },
    "volumes": [
      {
        "id": "raut-data",
        "mounts": [ { "containerMountPath": "/data" } ],
        "spec": { "accessMode": "ReadWriteOnce", "storageSize": 1024 }
      }
    ]
  },
  "ports": [
    { "name": "http", "internalPort": 8787, "public": true, "protocol": "HTTP" }
  ],
  "buildSource": "git",
  "vcsData": {
    "projectUrl": "$REPO",
    "projectType": "github",
    "projectBranch": "$BRANCH"
  },
  "buildSettings": {
    "dockerfile": {
      "buildEngine": "buildkit",
      "dockerFilePath": "/Dockerfile",
      "dockerWorkDir": "/"
    }
  },
  "runtimeEnvironment": {
    "PORT": "8787",
    "RAUT_NAME": "Raut — общий сервер",
    "RAUT_DEMO": "1"
  },
  "healthChecks": [
    {
      "protocol": "HTTP", "type": "readinessProbe", "path": "/api/health",
      "port": 8787, "initialDelaySeconds": 10, "periodSeconds": 60,
      "timeoutSeconds": 2, "failureThreshold": 3, "successThreshold": 1
    }
  ]
}
JSON

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf '%s' "$BODY" | python3 -m json.tool
  exit 0
fi

API="https://api.northflank.com/v1/projects/$PROJECT_ID"
echo "==> Создаю Combined service '$NAME' из ветки $BRANCH"
curl -fsS -X POST "$API/services/combined" \
  -H "Authorization: Bearer $NORTHFLANK_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$BODY" | python3 -m json.tool

echo "==> Публичный адрес (появится после завершения сборки)"
curl -fsS "$API/services/$NAME/ports" \
  -H "Authorization: Bearer $NORTHFLANK_API_TOKEN" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)
for p in d.get("data",{}).get("ports",[]):
    print(" ", p.get("dns") or "(ещё создаётся)")' || echo "  откройте Networking → Ports в панели Northflank"

echo
echo "Дальше: node scripts/smoke-test.mjs https://<адрес>.code.run"
echo "И впишите адрес одной строкой в SERVER_URL.txt, чтобы все копии Raut переехали сами."
