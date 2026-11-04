#!/usr/bin/env bash
# Поднимает центральный сервер Raut с пользователями одной командой.
#
#     sudo bash one-shot.sh                       # домен НЕ нужен: бесплатный sslip.io по IP
#     sudo bash one-shot.sh chat.example.ru       # или свой домен
#     GH_TOKEN=... sudo -E bash one-shot.sh       # + сам пропишет адрес в SERVER_URL.txt
#
# Скрипт сам: ставит Docker, генерирует пароль TURN, получает TLS-сертификат
# через Caddy, поднимает приложение, HTTPS/WSS и свой STUN/TURN, создаёт
# демо-пользователей raut / drug / team и печатает готовую ссылку.
set -euo pipefail

DOMAIN_HOST="${1:-${RAUT_DOMAIN:-}}"
AUTO_DOMAIN=0
if [[ -z "$DOMAIN_HOST" ]]; then
  AUTO_DOMAIN=1
  echo "==> Домен не задан: определяю публичный IP и беру бесплатный адрес sslip.io"
  PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  [[ -z "$PUBLIC_IP" ]] && PUBLIC_IP="$(curl -fsS --max-time 8 https://ifconfig.me/ip 2>/dev/null || true)"
  [[ -z "$PUBLIC_IP" ]] && PUBLIC_IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/");print a[1];exit}' || true)"
  if [[ ! "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Не удалось определить публичный IP. Передайте домен: sudo bash one-shot.sh chat.example.ru" >&2
    exit 1
  fi
  DOMAIN_HOST="raut.${PUBLIC_IP//./-}.sslip.io"
  echo "==> Бесплатный HTTPS-адрес: https://$DOMAIN_HOST"
fi
if [[ "$DOMAIN_HOST" == http* || "$DOMAIN_HOST" == */* ]]; then
  echo "Нужен голый домен без https://, например chat.example.ru" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Запустите с sudo: sudo bash one-shot.sh $DOMAIN_HOST" >&2
  exit 1
fi

REPO_DIR="${RAUT_DIR:-/opt/raut}"
REPO_URL="${RAUT_REPO_URL:-https://github.com/MatronixOwner/Raut.git}"
BRANCH="${RAUT_BRANCH:-arena/d55d4f5c-raut}"
ACME_EMAIL="${RAUT_ACME_EMAIL:-admin@$DOMAIN_HOST}"

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-plugin curl git openssl python3 >/dev/null
  systemctl enable --now docker >/dev/null
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin >/dev/null
fi

echo "==> Код: $REPO_DIR ($BRANCH)"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1 \
    || git clone --depth 1 "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1
fi
cd "$REPO_DIR/deploy"
git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH" >/dev/null 2>&1 || true
git -C "$REPO_DIR" checkout "$BRANCH" >/dev/null 2>&1 || true

echo "==> Пароль TURN и конфиги"
if [[ -f .env ]]; then
  TURN_PASSWORD="$(grep -E '^TURN_PASSWORD=' .env | cut -d= -f2- || true)"
fi
if [[ -z "${TURN_PASSWORD:-}" ]]; then
  TURN_PASSWORD="$(openssl rand -hex 24)"
fi
cat > .env <<EOF
DOMAIN_HOST=$DOMAIN_HOST
TURN_PASSWORD=$TURN_PASSWORD
RAUT_ACME_EMAIL=$ACME_EMAIL
EOF
chmod 600 .env

cat > Caddyfile <<EOF
# Сгенерировано one-shot.sh. Caddy сам получает и продлевает TLS.
{
	email $ACME_EMAIL
}

$DOMAIN_HOST {
	encode zstd gzip
	reverse_proxy raut:8787 {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-For {remote_host}
	}
	header {
		Strict-Transport-Security "max-age=31536000;"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
}
EOF

cat > turnserver.conf <<EOF
# Сгенерировано one-shot.sh — собственный STUN/TURN, без зарубежных сервисов.
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=0.0.0.0

fingerprint
lt-cred-mech
user=raut:$TURN_PASSWORD
realm=$DOMAIN_HOST
server-name=$DOMAIN_HOST

no-tlsv1
no-tlsv1_1
no-cli
no-multicast-peers
no-loopback-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255

pidfile=/var/run/turnserver.pid
log-file=stdout
simple-log
total-quota=200
bps-capacity=0
stale-nonce=600
channel-lifetime=-1
EOF

echo "==> Сборка и запуск"
docker compose up -d --build

SERVER_URL="https://$DOMAIN_HOST"

# Необязательно: сразу прописать адрес в репозитории, чтобы ВСЕ уже
# установленные копии Raut переехали на общий сервер без переустановки.
if [[ -n "${GH_TOKEN:-}" ]] && command -v python3 >/dev/null 2>&1; then
  echo "==> Публикую адрес в SERVER_URL.txt"
  GH_TOKEN="$GH_TOKEN" RAUT_GH_REPO="${RAUT_GH_REPO:-MatronixOwner/Raut}" \
    RAUT_GH_BRANCH="$BRANCH" SERVER_URL="$SERVER_URL" python3 - <<'PY' || echo "(!) не удалось обновить SERVER_URL.txt — впишите адрес вручную"
import base64, json, os, urllib.request
repo, branch, url = os.environ['RAUT_GH_REPO'], os.environ['RAUT_GH_BRANCH'], os.environ['SERVER_URL']
tok, api = os.environ['GH_TOKEN'], 'https://api.github.com'
endpoint = f"{api}/repos/{repo}/contents/SERVER_URL.txt"
def req(method, data=None):
    r = urllib.request.Request(endpoint, data=None if data is None else json.dumps(data).encode(),
        headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json', 'User-Agent': 'raut-one-shot'}, method=method)
    with urllib.request.urlopen(r, timeout=15) as f:
        return json.load(f)
sha = None
try:
    get = urllib.request.Request(endpoint + '?ref=' + branch,
        headers={'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'raut-one-shot'}, method='GET')
    with urllib.request.urlopen(get, timeout=15) as f:
        sha = json.load(f)['sha']
except Exception:
    pass
body = {'message': 'deploy: общий сервер Raut ' + url, 'content': base64.b64encode((url + '\n').encode()).decode(), 'branch': branch}
if sha:
    body['sha'] = sha
req('PUT', body)
print('    SERVER_URL.txt обновлён:', url)
PY
fi

echo "=== ГОТОВО ========================================================"
echo "Ссылка для вас и друга:  $SERVER_URL"
echo "Демо-аккаунты: raut / raut123, drug / drug123, team / team123"
echo "TLS, WSS и TURN настроены автоматически. Логи: docker compose logs -f"
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "Впишите '$SERVER_URL' одной строкой в SERVER_URL.txt репозитория —"
  echo "и все установленные копии Raut переедут сюда без переустановки."
fi
if [[ "$AUTO_DOMAIN" == 1 ]]; then
  echo "Домен бесплатный (sslip.io), покупать ничего не нужно."
fi
echo "===================================================================="
