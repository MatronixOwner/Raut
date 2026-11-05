/**
 * Raut crypto — E2E-шифрование сообщений.
 *
 * Схема (одна и та же в браузере, Electron и Node — всё через WebCrypto):
 *  • У каждого устройства есть долговременная пара ключей ECDH P-256.
 *    Приватный ключ не покидает устройство (localStorage), публичный — на сервере.
 *  • Ключ канала/сервера — случайные 32 байта (AES-256-GCM). Он «заворачивается»
 *    (ECIES: эфемерный ECDH + HKDF-SHA256 + AES-GCM) отдельно для каждого участника.
 *    Сервер хранит только завёрнутые копии и не может прочитать переписку.
 *  • Личные сообщения используют общий секрет ECDH(мой приватный, его публичный) —
 *    он выводится на обоих концах без всякой передачи данных.
 *  • Тексты сообщений шифруются AES-256-GCM с AAD = "raut-msg-v1:<channelId>",
 *    чтобы сообщение нельзя было «пересадить» в другой канал.
 *
 * Модуль не зависит от DOM и работает как в браузере, так и в Node 20+.
 */

const subtle = globalThis.crypto.subtle;

const WRAP_SALT = 'raut-wrap-v1';
const DM_SALT = 'raut-dm-v1';
const AAD_PREFIX = 'raut-msg-v1';
const HKDF_HASH = 'SHA-256';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ base64url */

export function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64ToBytes(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function randomId(n = 16) {
  return bytesToB64(randomBytes(n));
}

/* ------------------------------------------------------------------ identity */

/** Создаёт новую пару ключей устройства. Приватный ключ — JWK (объект). */
export async function generateIdentity() {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const priv = await subtle.exportKey('jwk', pair.privateKey);
  const pubRaw = await subtle.exportKey('raw', pair.publicKey);
  return { priv, pub: bytesToB64(new Uint8Array(pubRaw)) };
}

async function importPrivate(jwk) {
  return subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
}

async function importPublic(rawB64) {
  return subtle.importKey('raw', b64ToBytes(rawB64), ECDH, false, []);
}

async function hkdf(sharedBits, salt, info, bytes = 32) {
  const base = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await subtle.deriveBits(
      { name: 'HKDF', hash: HKDF_HASH, salt: encoder.encode(salt), info: encoder.encode(info) },
      base,
      bytes * 8,
    ),
  );
}

async function aesKey(raw, usage) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

/* -------------------------------------------------------------- wrap / unwrap */

/**
 * Заворачивает ключ канала (Uint8Array 32 байта) для получателя.
 * @returns {{e:string,i:string,c:string}} конверт, который можно отдать серверу
 */
export async function wrapKeyFor(recipientPubB64, keyBytes) {
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const recipientPub = await importPublic(recipientPubB64);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: recipientPub }, eph.privateKey, 256);
  const kek = await hkdf(shared, WRAP_SALT, recipientPubB64);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(recipientPubB64) },
    await aesKey(kek, ['encrypt']),
    keyBytes,
  );
  return { e: bytesToB64(ephPub), i: bytesToB64(iv), c: bytesToB64(new Uint8Array(ct)) };
}

/** Разворачивает ключ канала своим приватным ключом. Ошибка = ключ не для нас. */
export async function unwrapKey(privateJwk, myPubB64, envelope) {
  if (!envelope || !envelope.e) throw new Error('bad envelope');
  const priv = await importPrivate(privateJwk);
  const ephPub = await importPublic(envelope.e);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: ephPub }, priv, 256);
  const kek = await hkdf(shared, WRAP_SALT, myPubB64);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(envelope.i), additionalData: encoder.encode(myPubB64) },
    await aesKey(kek, ['decrypt']),
    b64ToBytes(envelope.c),
  );
  return new Uint8Array(plain);
}

/* ---------------------------------------------------------------- DM-ключи */

/**
 * Общий ключ личной переписки. Обе стороны получают одинаковые байты.
 * @param {{priv:object,pub:string}} identity моя пара ключей
 * @param {string} otherPub публичный ключ собеседника
 * @param {string[]} memberIds два id участников (сортируются)
 */
export async function deriveDMKey(identity, otherPubB64, memberIds) {
  const priv = await importPrivate(identity.priv);
  const pub = await importPublic(otherPubB64);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const info = [...memberIds].sort().join('|');
  return hkdf(shared, DM_SALT, info);
}

/* ---------------------------------------------------------------- messages */

/** Шифрует текст. Пустой текст тоже шифруется (для вложений без подписи). */
export async function encryptText(keyBytes, channelId, text) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${AAD_PREFIX}:${channelId}`) },
    await aesKey(keyBytes, ['encrypt']),
    encoder.encode(String(text ?? '')),
  );
  return { v: 1, i: bytesToB64(iv), c: bytesToB64(new Uint8Array(ct)) };
}

export async function decryptText(keyBytes, channelId, payload) {
  if (!payload || !payload.c) return '';
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.i), additionalData: encoder.encode(`${AAD_PREFIX}:${channelId}`) },
    await aesKey(keyBytes, ['decrypt']),
    b64ToBytes(payload.c),
  );
  return decoder.decode(plain);
}

/** Шифрует произвольные байты (вложения). Формат тот же, что у текста. */
export async function encryptBytes(keyBytes, channelId, bytes) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${AAD_PREFIX}:${channelId}`) },
    await aesKey(keyBytes, ['encrypt']),
    bytes,
  );
  return { v: 1, i: bytesToB64(iv), c: bytesToB64(new Uint8Array(ct)) };
}

export async function decryptBytes(keyBytes, channelId, payload) {
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.i), additionalData: encoder.encode(`${AAD_PREFIX}:${channelId}`) },
    await aesKey(keyBytes, ['decrypt']),
    b64ToBytes(payload.c),
  );
  return new Uint8Array(plain);
}

/* -------------------------------------------------------------- fingerprint */

/** Короткий отпечаток публичного ключа — для сверки «тот ли это человек». */
export async function fingerprint(pubB64) {
  const digest = new Uint8Array(await subtle.digest('SHA-256', b64ToBytes(pubB64)));
  const hex = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.toUpperCase().match(/.{4}/g).join(' ');
}
