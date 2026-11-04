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
RELEASE="$ROOT/release"
VERSION="1.0.0"
NODE_VERSION="22.23.4"

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
python3 - "$CACHE/node.exe" <<'PY'
import struct, sys
d = open(sys.argv[1], 'rb').read(1024)
assert d[:2] == b'MZ', 'node.exe не является PE-файлом'
pe = struct.unpack_from('<I', d, 0x3c)[0]
assert d[pe:pe+4] == b'PE\0\0', 'node.exe: неверная сигнатура PE'
print('[raut] node.exe: PE, machine=0x%04x' % struct.unpack_from('<H', d, pe+4)[0])
PY

# --------------------------------------------------------------- payload ---
log "Собираю payload…"
rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD/client" "$PAYLOAD/server" "$PAYLOAD/bin"
cp -a "$ROOT/client/." "$PAYLOAD/client/"
cp "$ROOT/server/index.js" "$ROOT/server/ws.js" "$PAYLOAD/server/"
cp "$CACHE/node.exe" "$PAYLOAD/bin/node.exe"
cp "$ROOT/installer/Raut.ico" "$PAYLOAD/Raut.ico"
cp "$ROOT/installer/README.txt" "$PAYLOAD/README.txt"
cp "$ROOT/LICENSE" "$PAYLOAD/LICENSE.txt"

# WSH понимает .vbs в ANSI или UTF-16LE с BOM — перекодируем, иначе русский
# текст в MsgBox отобразится крокозябрами на Windows с CP1251.
python3 - "$ROOT/installer" "$PAYLOAD" <<'PY'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
for name in ('Raut.vbs', 'RautServer.vbs'):
    text = open(os.path.join(src, name), 'r', encoding='utf-8').read()
    with open(os.path.join(dst, name), 'wb') as f:
        f.write(b'\xff\xfe' + text.encode('utf-16-le'))
    print('[raut] %s -> UTF-16LE' % name)
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
  "-DRAUT_ICON=$PAYLOAD/Raut.ico" \
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

log "Готово: $OUT"
log "Проверка: $(cat "$OUT.sha256")"
