import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import {
  b64ToBytes,
  bytesToB64,
  decryptText,
  deriveDMKey,
  encryptText,
  generateIdentity,
  unwrapKey,
  wrapKeyFor,
} from '../../web/src/crypto.js';

test('base64url туда-обратно', () => {
  for (const n of [0, 1, 15, 16, 31, 32, 255, 1024]) {
    const bytes = crypto.randomBytes(n);
    assert.deepEqual(Buffer.from(b64ToBytes(bytesToB64(bytes))), bytes);
  }
});

test('заворот ключа канала: только получатель может развернуть', async () => {
  const alice = await generateIdentity();
  const bob = await generateIdentity();
  const eve = await generateIdentity();
  const key = crypto.randomBytes(32);

  const envelope = await wrapKeyFor(bob.pub, new Uint8Array(key));
  const opened = await unwrapKey(bob.priv, bob.pub, envelope);
  assert.deepEqual(Buffer.from(opened), key);

  await assert.rejects(unwrapKey(eve.priv, eve.pub, envelope));
  await assert.rejects(unwrapKey(alice.priv, alice.pub, envelope));
});

test('ECDH: обе стороны выводят одинаковый ключ личных сообщений', async () => {
  const alice = await generateIdentity();
  const bob = await generateIdentity();
  const k1 = await deriveDMKey(alice, bob.pub, ['bob', 'alice']);
  const k2 = await deriveDMKey(bob, alice.pub, ['alice', 'bob']);
  assert.deepEqual(Buffer.from(k1), Buffer.from(k2));
  assert.equal(k1.length, 32);
});

test('шифрование текста: расшифровка и AAD канала', async () => {
  const key = crypto.randomBytes(32);
  const payload = await encryptText(new Uint8Array(key), 'chan-1', 'привет, Raut! 🎧');
  assert.notEqual(payload.c, '');
  assert.equal(await decryptText(new Uint8Array(key), 'chan-1', payload), 'привет, Raut! 🎧');

  // перенос в другой канал должен провалиться
  await assert.rejects(decryptText(new Uint8Array(key), 'chan-2', payload));

  // чужой ключ
  await assert.rejects(decryptText(crypto.randomBytes(32), 'chan-1', payload));
});

test('пустой текст шифруется корректно', async () => {
  const key = new Uint8Array(crypto.randomBytes(32));
  const payload = await encryptText(key, 'c', '');
  assert.equal(await decryptText(key, 'c', payload), '');
});
