#!/usr/bin/env bash
# =====================================================================
# Сборка Windows-установщика Raut прямо из этого репозитория.
# Работает на Linux (и в GitHub Actions на ubuntu-latest), не требует Wine.
#
#   bash scripts/build-installer.sh
#
# Скачивает два компонента (кешируются в .cache/, в Git не попадают):
#   1. NSIS 3.13 (Linux-makensis + Windows-стабы) из electron-builder-binaries
#   2. node.exe (Windows x64) из npm-пакета node-win-x64
# Результат: release/RautSetup-<версия>.exe + .sha256
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.cache"
PAYLOAD="$CACHE/payload"
RELEASE="${RAUT_RELEASE_DIR:-$ROOT/release}"
VERSION="1.0.1"
NODE_VERSION="22.23.4"
# Адрес общего сервера Raut. Если задан, установщик открывает его сразу,
# и пользователю не нужно поднимать свой сервер.
RAUT_PUBLIC_URL="${RAUT_PUBLIC_URL:-}"

NSIS_URL="${NSIS_URL:-https://api.github.com/repos/electron-userland/electron-builder-binaries/contents/artifacts/nsis/nsis-bundle-3.13.tar.gz}"
NODE_URL="${NODE_URL:-https://registry.npmjs.org/node-win-x64/-/node-win-x64-${NODE_VERSION}.tgz}"
NSIS_TGZ="$CACHE/nsis-bundle-3.13.tar.gz"
NODE_TGZ="$CACHE/node-win-x64-${NODE_VERSION}.tgz"
NSIS_DIR="$CACHE/nsis/nsis-bundle"
MAKENSIS="$NSIS_DIR/makensis"

log() { printf '\033[1;36m[raut]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[raut] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

mkdir -p "$CACHE" "$RELEASE"

# ---------------------------------------------------------------- NSIS ---
if [[ -x "$MAKENSIS" ]]; then
  log "NSIS уже в кеше: $MAKENSIS"
else
  log "Скачиваю NSIS 3.13 (makensis для Linux + Windows-стабы)…"
  curl -fsSL --retry 3 --connect-timeout 20 \
    -H "Accept: application/vnd.github.raw+json" \
    -o "$NSIS_TGZ" "$NSIS_URL"
  python3 - "$NSIS_TGZ" <<'PY'
import sys
p = sys.argv[1]
with open(p, 'rb') as f:
    magic = f.read(2)
if magic != b'\x1f\x8b':
    raise SystemExit('Ожидался gzip-архив NSIS, получено что-то другое (проверьте URL/доступ)')
PY
  mkdir -p "$CACHE/nsis"
  tar xzf "$NSIS_TGZ" -C "$CACHE/nsis"
  chmod +x "$MAKENSIS" "$NSIS_DIR/linux/x64/makensis"
fi
[[ -x "$MAKENSIS" ]] || die "makensis не найден по пути $MAKENSIS"

# ------------------------------------------------------------- node.exe ---
if [[ -f "$CACHE/node.exe" ]]; then
  log "node.exe уже в кеше"
else
  log "Скачиваю Node.js ${NODE_VERSION} для Windows x64 (npm registry)…"
  curl -fsSL --retry 3 --connect-timeout 20 -o "$NODE_TGZ" "$NODE_URL"
  tar xzf "$NODE_TGZ" -C "$CACHE" package/bin/node.exe
  mv "$CACHE/package/bin/node.exe" "$CACHE/node.exe"
  rm -rf "$CACHE/package"
fi
python3 - "$CACHE/node.exe" "$CACHE/nodew.exe" <<'PY'
import struct, sys

src, dst = sys.argv[1], sys.argv[2]
data = bytearray(open(src, 'rb').read())
assert data[:2] == b'MZ', 'node.exe не является PE-файлом'
pe = struct.unpack_from('<I', data, 0x3c)[0]
assert data[pe:pe+4] == b'PE\0\0', 'node.exe: неверная сигнатура PE'
machine = struct.unpack_from('<H', data, pe + 4)[0]
magic = struct.unpack_from('<H', data, pe + 24)[0]
assert magic in (0x10b, 0x20b), 'неизвестный тип optional header'

# Subsystem лежит по смещению 68 от начала optional header и в PE32, и в PE32+.
# 3 = WINDOWS_CUI (консоль), 2 = WINDOWS_GUI (окон не создаёт вообще).
SUBSYS = pe + 24 + 68
CHECKSUM = pe + 24 + 64
assert struct.unpack_from('<H', data, SUBSYS)[0] == 3, 'ожидалась консольная подсистема'
struct.pack_into('<H', data, SUBSYS, 2)

# Пересчёт контрольной суммы PE (поле checksum временно считаем нулевым).
total = 0
for i in range(0, len(data) - (len(data) % 2), 2):
    if CHECKSUM <= i < CHECKSUM + 4:
        continue
    total += data[i] | (data[i + 1] << 8)
    total = (total & 0xffff) + (total >> 16)
total = (total & 0xffff) + (total >> 16)
total = (total + len(data)) & 0xffffffff
struct.pack_into('<I', data, CHECKSUM, total)

open(dst, 'wb').write(bytes(data))
print('[raut] node.exe: PE, machine=0x%04x' % machine)
print('[raut] nodew.exe: GUI-подсистема (без консольного окна), checksum=0x%08x' % total)
PY
[[ -f "$CACHE/nodew.exe" ]] || die "не удалось создать nodew.exe"

# --------------------------------------------------------------- payload ---
log "Собираю payload…"
rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD/client" "$PAYLOAD/server" "$PAYLOAD/bin"
cp -a "$ROOT/client/." "$PAYLOAD/client/"
cp "$ROOT/server/index.js" "$ROOT/server/ws.js" "$PAYLOAD/server/"
cp "$CACHE/nodew.exe" "$PAYLOAD/bin/nodew.exe"
cp "$ROOT/installer/Raut.ico" "$PAYLOAD/Raut-logo.ico"
cp "$ROOT/installer/README.txt" "$PAYLOAD/README.txt"
cp "$ROOT/LICENSE" "$PAYLOAD/LICENSE.txt"

# Клиент узнаёт адрес центрального сервера из config.js (можно заменить
# в уже установленной программе, не пересобирая её).
python3 - "$PAYLOAD/client/config.js" "$RAUT_PUBLIC_URL" <<'PY'
import json, sys
p, url = sys.argv[1], sys.argv[2].rstrip('/')
text = ("/* Адрес центрального сервера Raut. Генерируется scripts/build-installer.sh. */\n"
        "window.RAUT_DEFAULT_SERVER = %s;\n" % json.dumps(url, ensure_ascii=False))
open(p, 'w', encoding='utf-8').write(text)
print('[raut] config.js: сервер = ' + (url or 'локальный (по умолчанию)'))
PY

# Прозрачный «состав сборки»: откуда взяты бинарники и их контрольные суммы.
# Это ответ на ложные срабатывания антивирусов — пользователь может всё проверить.
python3 - "$PAYLOAD" "$CACHE/nodew.exe" "$VERSION" "$NODE_VERSION" <<'PY'
import hashlib, os, sys
payload, node, version, node_version = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()
text = f"""RAUT {version} — СОСТАВ СБОРКИ И ПРОВЕРКА ПОДЛИННОСТИ
======================================================

В установщике НЕТ скриптов WSH/VBS, скрытых окон, автозапуска,
загрузчиков и КОНСОЛЬНОГО ОКНА. Запуск идёт напрямую через
bin\\nodew.exe (тот же node.exe с GUI-подсистемой PE, как pythonw.exe)
с параметрами --open --no-console. Логи пишутся в app\\data\\server.log,
а окно приложения открывает сам сервер через child_process.

СОСТАВ
  app/client/     веб-клиент (HTML/CSS/JS, исходники в репозитории)
  app/server/     сервер: аккаунты, друзья, ЛС, чат, сигналинг
  bin/nodew.exe  Node.js {node_version} для Windows x64 с GUI-подсистемой
                 (тот же официальный бинарник, но без консольного окна)
  Raut-logo.ico   иконка из присланного логотипа
  README.txt      краткая инструкция
  LICENSE.txt     MIT

ОТКУДА БИНАРНИКИ
  nodew.exe: npm-пакет node-win-x64@22.23.4 (registry.npmjs.org),
             официальная сборка Node.js, лицензия MIT. У неё изменено
             только поле Subsystem в PE-заголовке (3 -> 2) и пересчитана
             контрольная сумма PE. Код Node.js не менялся.
  установщик собран NSIS 3.13 (Linux-makensis + стабы x86-unicode)
             из electron-builder-binaries, сжатие LZMA.

КОНТРОЛЬНЫЕ СУММЫ
  nodew.exe SHA-256: {sha(node)}
  установщик SHA-256 : см. файл RautSetup-{version}.exe.sha256
                       рядом с установщиком на сервере/GitHub.

ПРОВЕРИТЬ САМОСТОЯТЕЛЬНО (PowerShell)
  Get-FileHash .\\RautSetup-{version}.exe -Algorithm SHA256
  Get-FileHash .\\bin\\nodew.exe -Algorithm SHA256

ПЕРЕСОБРАТЬ ИЗ ИСХОДНИКОВ
  git clone https://github.com/MatronixOwner/Raut
  bash scripts/build-installer.sh

ЕСЛИ АНТИВИРУС РУГАЕТСЯ
  Установщик не подписан (нет Code Signing сертификата) — это частая
  причина срабатывания эвристик SmartScreen/Defender на любых NSIS-сборках.
  Проверьте хэш, проверьте файл на virustotal.com, при необходимости
  добавьте в исключения или используйте портативный ZIP-архив.
"""
with open(os.path.join(payload, 'BUILDINFO.txt'), 'w', encoding='utf-8') as f:
    f.write(text)
print('[raut] BUILDINFO.txt: SHA-256 nodew.exe = ' + sha(node)[:16] + '…')
PY

# Синтаксическая проверка всего JS, который попадёт в установщик.
for f in "$PAYLOAD"/server/*.js "$PAYLOAD"/client/*.js; do
  node --check "$f" || die "Синтаксическая ошибка в $f"
done

# ------------------------------------------------------------- makensis ---
OUT="$RELEASE/RautSetup-${VERSION}.exe"
rm -f "$OUT"
log "Компилирую установщик: $(basename "$OUT")"
"$MAKENSIS" -V3 -INPUTCHARSET UTF8 \
  "-DRAUT_VERSION=$VERSION" \
  "-DRAUT_PAYLOAD=$PAYLOAD" \
  "-DRAUT_OUTFILE=$OUT" \
  "-DRAUT_ICON=$PAYLOAD/Raut-logo.ico" \
  "-DRAUT_PUBLIC_URL=$RAUT_PUBLIC_URL" \
  "$ROOT/installer/raut.nsi" || die "makensis завершился с ошибкой"

# -------------------------------------------------------------- проверка ---
python3 - "$OUT" <<'PY'
import hashlib, os, struct, sys
p = sys.argv[1]
with open(p, 'rb') as f:
    head = f.read(4096)
assert head[:2] == b'MZ', 'Установщик не начинается с MZ'
pe = struct.unpack_from('<I', head, 0x3c)[0]
assert head[pe:pe+4] == b'PE\0\0', 'Установщик не является PE-файлом'
machine, sections = struct.unpack_from('<HH', head, pe+4)
size = os.path.getsize(p)
h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
print('[raut] PE OK: machine=0x%04x, sections=%d, size=%.1f MB' % (machine, sections, size/1048576))
print('[raut] SHA256: ' + h)
open(p + '.sha256', 'w').write(h + '  ' + os.path.basename(p) + '\n')
PY

# --------------------------------------------------- портативная версия ---
# Альтернатива на случай, когда антивирус блокирует именно NSIS-установщик:
# обычный ZIP без инсталлятора, без реестра и без скриптов WSH.
PORTABLE="$RELEASE/Raut-${VERSION}-portable.zip"
python3 - "$PAYLOAD" "$PORTABLE" "$VERSION" "$RAUT_PUBLIC_URL" <<'PY'
import hashlib, os, sys, zipfile
payload, out, version, public_url = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].rstrip('/')
url_arg = (' --public-url "' + public_url + '"') if public_url else ''
launcher = (
    '@echo off\r\n'
    'rem Raut portable launcher (no installer, no registry, no WSH, no console)\r\n'
    'cd /d "%~dp0"\r\n'
    'start "" "bin\\nodew.exe" "app\\server\\index.js" '
    '--client "app\\client" --data "app\\data" --host 0.0.0.0 --port 8787 --open --no-console' + url_arg + '\r\n'
)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.writestr(f'Raut-{version}/Run-Raut.cmd', launcher)
    for base, _, files in os.walk(payload):
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, payload).replace(os.sep, '/')
            # Внутри установки и архива клиент/сервер лежат в app/
            if rel.startswith('client/') or rel.startswith('server/'):
                rel = 'app/' + rel
            z.write(full, f'Raut-{version}/{rel}')
h = hashlib.sha256(open(out, 'rb').read()).hexdigest()
open(out + '.sha256', 'w').write(h + '  ' + os.path.basename(out) + '\n')
print('[raut] portable ZIP: %.1f MB, SHA256 %s…' % (os.path.getsize(out)/1048576, h[:16]))
PY

log "Готово: $OUT"
log "Проверка: $(cat "$OUT.sha256")"
log "Портативная версия: $PORTABLE"
