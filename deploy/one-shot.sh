#!/usr/bin/env bash
# Поднимает центральный сервер Raut с пользователями одной командой.
#
#     sudo bash one-shot.sh                       # домен НЕ нужен: бесплатный sslip.io по IP
#     sudo bash one-shot.sh chat.example.ru       # или свой домен
#     GH_TOKEN=... sudo -E bash one-shot.sh       # + сам пропишет адрес в SERVER_URL.txt
#     DRY_RUN=1 RAUT_CONFIG_DIR=/tmp/cfg bash one-shot.sh   # только конфиги, без системы
#
# Скрипт сам: открывает файрвол (включая UDP 3478), ставит Docker, генерирует
# пароль TURN, получает TLS-сертификат через Caddy, поднимает приложение,
# HTTPS/WSS и свой STUN/TURN, создаёт демо-пользователей, проверяет голос
# и печатает готовую ссылку.
set -euo pipefail

DOMAIN_HOST="${1:-${RAUT_DOMAIN:-}}"
AUTO_DOMAIN=0
DRY="${DRY_RUN:-0}"

# Публичный IP нужен не только для бесплатного домена, но и для coturn:
# если VPS за 1:1 NAT, TURN обязан знать external-ip, иначе голос не пробьётся.
echo "==> Определяю публичный IP"
PUBLIC_IP="${RAUT_PUBLIC_IP:-}"
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(curl -fsS --max-time 8 https://ifconfig.me/ip 2>/dev/null || true)"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/");print a[1];exit}' || true)"
fi
if [[ ! "$PUBLIC_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "(!) публичный IP не определён — external-ip для coturn задан не будет" >&2
  PUBLIC_IP=""
fi

if [[ -z "$DOMAIN_HOST" ]]; then
  AUTO_DOMAIN=1
  if [[ -z "$PUBLIC_IP" ]]; then
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

REPO_DIR="${RAUT_DIR:-/opt/raut}"
REPO_URL="${RAUT_REPO_URL:-https://github.com/MatronixOwner/Raut.git}"
BRANCH="${RAUT_BRANCH:-arena/d55d4f5c-raut}"
ACME_EMAIL="${RAUT_ACME_EMAIL:-admin@$DOMAIN_HOST}"
CONFIG_DIR="${RAUT_CONFIG_DIR:-$REPO_DIR/deploy}"

if [[ "$DRY" == "1" ]]; then
  mkdir -p "$CONFIG_DIR"
  echo "==> DRY_RUN: только генерация конфигов в $CONFIG_DIR"
else
  if [[ $EUID -ne 0 ]]; then
    echo "Запустите с sudo: sudo bash one-shot.sh $DOMAIN_HOST" >&2
    exit 1
  fi

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

  echo "==> Файрвол: 80/443 (HTTPS), UDP+TCP 3478 и TCP 5349 (TURN)"
  # Без UDP 3478 текст работает, а голос между разными сетями — нет.
  # Правила вставляем в НАЧАЛО INPUT: у образов Oracle Cloud в конце стоит
  # REJECT, который перебивает правила, добавленные обычным append.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
    for rule in 80/tcp 443/tcp 3478/tcp 3478/udp 5349/tcp; do
      ufw allow "$rule" >/dev/null 2>&1 || true
    done
  fi
  if command -v iptables >/dev/null 2>&1; then
    while read -r proto port; do
      [[ -z "$proto" ]] && continue
      iptables -C INPUT -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null \
        || iptables -I INPUT 1 -p "$proto" --dport "$port" -j ACCEPT 2>/dev/null || true
    done <<'PORTS'
tcp 80
tcp 443
tcp 3478
udp 3478
tcp 5349
PORTS
    if command -v netfilter-persistent >/dev/null 2>&1; then
      netfilter-persistent save >/dev/null 2>&1 || true
    fi
  fi
  if command -v firewall-cmd >/dev/null 2>&1; then
    for rule in 80/tcp 443/tcp 3478/tcp 3478/udp 5349/tcp; do
      firewall-cmd --permanent --add-port="$rule" >/dev/null 2>&1 || true
    done
    firewall-cmd --reload >/dev/null 2>&1 || true
  fi

  echo "==> Код: $REPO_DIR ($BRANCH)"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1 \
      || git clone --depth 1 "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1
  fi
  git -C "$REPO_DIR" fetch --depth 1 origin "$BRANCH" >/dev/null 2>&1 || true
  git -C "$REPO_DIR" checkout "$BRANCH" >/dev/null 2>&1 || true
  mkdir -p "$CONFIG_DIR"
fi

cd "$CONFIG_DIR"

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

# Если публичного IP нет ни на одном интерфейсе (VPS за 1:1 NAT), coturn
# обязан знать external-ip, иначе TURN отдаст клиенту внутренний адрес.
EXTERNAL_IP_LINE="# external-ip не требуется: публичный IP настроен на интерфейсе"
if [[ -n "$PUBLIC_IP" ]] && ! ip -4 -o addr show scope global 2>/dev/null | grep -q " $PUBLIC_IP/"; then
  EXTERNAL_IP_LINE="external-ip=$PUBLIC_IP"
  echo "==> VPS за NAT: coturn получит $EXTERNAL_IP_LINE"
fi

cat > turnserver.conf <<EOF
# Сгенерировано one-shot.sh — собственный STUN/TURN, без зарубежных сервисов.
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=0.0.0.0
$EXTERNAL_IP_LINE

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
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=169.254.0.0-169.254.255.255

pidfile=/var/run/turnserver.pid
log-file=stdout
simple-log
total-quota=200
bps-capacity=0
stale-nonce=600
channel-lifetime=-1
EOF

SERVER_URL="https://$DOMAIN_HOST"

if [[ "$DRY" != "1" ]]; then
  echo "==> Сборка и запуск"
  docker compose up -d --build

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

  echo "==> Проверяю текст и голос"
  # Caddy получает TLS-сертификат асинхронно — ждём до минуты.
  for _i in $(seq 1 12); do
    if curl -fsS -o /dev/null "$SERVER_URL/api/health" 2>/dev/null; then break; fi
    sleep 5
  done
  if [[ -f "$REPO_DIR/deploy/check-voice.py" ]]; then
    RAUT_INSECURE=1 python3 "$REPO_DIR/deploy/check-voice.py" "$DOMAIN_HOST" "$SERVER_URL" \
      || echo "(!) голос не подтверждён — откройте UDP 3478 в панели хостера и повторите проверку"
  fi
fi

echo "=== ГОТОВО ========================================================"
echo "Ссылка для вас и друга:  $SERVER_URL"
echo "Конфиги: $CONFIG_DIR (Caddyfile, turnserver.conf, .env)"
echo "Демо-аккаунты: raut / raut123, drug / drug123, team / team123"
echo "Проверка: python3 $REPO_DIR/deploy/check-voice.py $DOMAIN_HOST"
if [[ "$DRY" != "1" ]]; then
  echo "TLS, WSS и TURN настроены автоматически. Логи: docker compose logs -f"
  echo "ВАЖНО: UDP 3478 должен быть открыт и в панели хостера (Security List / Файрвол)."
  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "Впишите '$SERVER_URL' одной строкой в SERVER_URL.txt репозитория —"
    echo "и все установленные копии Raut переедут сюда без переустановки."
  fi
fi
if [[ "$AUTO_DOMAIN" == 1 ]]; then
  echo "Домен бесплатный (sslip.io), покупать ничего не нужно."
fi
echo "===================================================================="
