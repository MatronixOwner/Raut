#!/usr/bin/env bash
# Заглушки NSS/NSPR для запуска headless Chromium в контейнере без libnss3.
#
# Зачем: puppeteer-проверки гоняют интерфейс на 127.0.0.1 по http, живой TLS
# не нужен, но Chromium линкуется с libnss3/libnssutil3/libnspr4 и без них
# падает на старте с "libnspr4.so: cannot open shared object file".
#
# Использование:
#   bash scripts/qa/nss-stub.sh /tmp/runlibs
#   LD_LIBRARY_PATH=/tmp/runlibs node scripts/qa/smoke.mjs
#
# Требуется: gcc, objdump (binutils). Скрипт читает неразрешённые символы из
# самого бинарника Chromium, поэтому переживает обновление версии браузера.
set -euo pipefail

OUT="${1:-/tmp/runlibs}"
CHROMIUM="${CHROMIUM:-/tmp/chromium}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

test -x "$CHROMIUM" || { echo "нет $CHROMIUM — сначала node scripts/qa/smoke.mjs"; exit 1; }
mkdir -p "$OUT"

# у objdump -T формат: адрес, флаги, версия, *UND*, имя — имя всегда последнее поле
objdump -T "$CHROMIUM" | grep '\*UND\*' | awk '{print $NF}' | grep -E "${SYMBOL_RE:-^(NSS|NSSU|SEC|CERT|PK11|SSL|PKCS|PORT|PR_|PRUint|NSSTrust|SGN|VFY|HASH|DSA|RSA|ECDSA|EC_|SEED|RC2|DES|AES_|MD5|SHA|HMAC|CK_|NSSCK|nss|NSS|ssl|SSL_|SSL3|SECITEM|SECOid|SECKEY|SECStatus|SECAsn1|SECItem|SEC_PKCS|NSSBase64|NSSCert|NSSUTIL)}" | sort -u > "$TMP/syms"

if [ ! -s "$TMP/syms" ]; then
  echo "не нашёл символов NSS в $CHROMIUM — Chromium уже не зависит от NSS?"
  exit 0
fi

{
  echo '/* Заглушки NSS/NSPR: живой TLS в проверках не используется. */'
  while read -r s; do echo "void* ${s}(void) { return 0; }"; done < "$TMP/syms"
} > "$TMP/stub.c"

for lib in libnspr4 libnssutil3 libnss3; do
  gcc -shared -fPIC -o "$OUT/$lib.so" "$TMP/stub.c" -Wl,-soname,"$lib.so"
done
echo "готово: $OUT ($(wc -l < "$TMP/syms") символов в $(ls "$OUT" | wc -l) библиотеках)"
