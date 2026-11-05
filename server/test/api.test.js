import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { generateIdentity, wrapKeyFor, bytesToB64, encryptText } from '../../web/src/crypto.js';

let serverBase;
let dataDir;
let app;
let server;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raut-test-'));
  app = createApp({ dataDir, rateLimitScale: 1000 });
  server = http.createServer();
  app.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverBase = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  app.close();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(method, url, body, token) {
  const res = await fetch(serverBase + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function register(username, password = 'super-pass-123') {
  const identity = await generateIdentity();
  const r = await api('POST', '/api/register', {
    username,
    password,
    displayName: username,
    publicKey: identity.pub,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { token: r.json.token, user: r.json.user, identity };
}

test('health и config отвечают', async () => {
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.name, 'Raut');
  const c = await api('GET', '/api/config');
  assert.equal(c.status, 200);
  assert.ok(c.json.ws.startsWith('ws://'));
});

test('регистрация, вход, защищённые ручки', async () => {
  const alice = await register('alice');
  assert.equal(alice.user.username, 'alice');

  const dup = await api('POST', '/api/register', { username: 'alice', password: '12345678', publicKey: 'x' });
  assert.equal(dup.status, 409);

  const bad = await api('POST', '/api/login', { username: 'alice', password: 'wrong-password' });
  assert.equal(bad.status, 401);

  const ok = await api('POST', '/api/login', { username: 'alice', password: 'super-pass-123' });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);

  assert.equal((await api('GET', '/api/me')).status, 401);
  const me = await api('GET', '/api/me', null, alice.token);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, 'alice');
});

test('сервер, каналы, приглашения и ключи канала', async () => {
  const alice = await register('alice2');
  const bob = await register('bob2');

  const created = await api('POST', '/api/servers', { name: 'Мой уголок' }, alice.token);
  assert.equal(created.status, 200);
  const srv = created.json.server;
  assert.equal(srv.channels.length, 2);
  assert.equal(srv.role, 'owner');
  assert.ok(srv.inviteCode);

  const text = srv.channels.find((c) => c.type === 'text');
  const voice = srv.channels.find((c) => c.type === 'voice');
  assert.ok(text && voice);

  // ключ канала: владелец заворачивает 32 байта для себя и будущих участников
  const key = crypto.randomBytes(32);
  const envForAlice = await wrapKeyFor(alice.identity.pub, new Uint8Array(key));
  let put = await api('PUT', `/api/channels/${text.id}/keys`, { adminPub: alice.identity.pub, keys: { [alice.user.id]: envForAlice } }, alice.token);
  assert.equal(put.status, 200);

  const got = await api('GET', `/api/channels/${text.id}/keys`, null, alice.token);
  assert.deepEqual(got.json.myEnvelope, envForAlice);

  // bob вступает по инвайту
  const joined = await api('POST', '/api/servers/join', { code: srv.inviteCode }, bob.token);
  assert.equal(joined.status, 200);
  assert.equal(joined.json.server.memberCount, 2);

  const keyForBob = await wrapKeyFor(bob.identity.pub, new Uint8Array(key));
  put = await api('PUT', `/api/channels/${text.id}/keys`, { keys: { [bob.user.id]: keyForBob } }, alice.token);
  assert.equal(put.status, 200);

  const bobKeys = await api('GET', `/api/channels/${text.id}/keys`, null, bob.token);
  assert.ok(bobKeys.json.myEnvelope);

  // bob не владелец — не может творить произвол
  assert.equal((await api('PATCH', `/api/servers/${srv.id}`, { name: 'hack' }, bob.token)).status, 403);
  assert.equal((await api('POST', `/api/servers/${srv.id}/channels`, { name: 'hack' }, bob.token)).status, 403);
});

test('шифрованные сообщения и права доступа', async () => {
  const alice = await register('alice3');
  const bob = await register('bob3');
  const eve = await register('eve3');
  const srv = (await api('POST', '/api/servers', { name: 'Test' }, alice.token)).json.server;
  const text = srv.channels.find((c) => c.type === 'text');

  const key = crypto.randomBytes(32);
  const payload = await encryptText(new Uint8Array(key), text.id, 'секрет');
  const sent = await api('POST', `/api/channels/${text.id}/messages`, { payload }, alice.token);
  assert.equal(sent.status, 200);
  assert.equal(sent.json.message.authorId, alice.user.id);

  const list = await api('GET', `/api/channels/${text.id}/messages`, null, alice.token);
  const mine = list.json.messages.filter((m) => m.kind !== 'system');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].payload, payload);
  assert.equal(list.json.authors[alice.user.id].username, 'alice3');

  // посторонний не читает
  assert.equal((await api('POST', '/api/servers/join', { code: 'nope' }, eve.token)).status, 404);
  assert.equal((await api('GET', `/api/channels/${text.id}/messages`, null, eve.token)).status, 403);
  assert.equal((await api('POST', `/api/channels/${text.id}/messages`, { payload }, eve.token)).status, 403);

  // bob вступает и читает
  const joined = await api('POST', '/api/servers/join', { code: srv.inviteCode }, bob.token);
  assert.equal(joined.status, 200);
  const bobList = await api('GET', `/api/channels/${text.id}/messages`, null, bob.token);
  // + системное сообщение «присоединился»
  const chatMessages = bobList.json.messages.filter((m) => m.kind !== 'system');
  assert.equal(chatMessages.length, 1);
  assert.deepEqual(chatMessages[0].payload, payload);
});

test('личные сообщения: канал создаётся один раз', async () => {
  const a = await register('dma');
  const b = await register('dmb');
  const r1 = await api('POST', `/api/dm/${b.user.id}`, {}, a.token);
  assert.equal(r1.status, 200);
  const r2 = await api('POST', `/api/dm/${b.user.id}`, {}, a.token);
  assert.equal(r2.json.channel.id, r1.json.channel.id);

  const dmId = r1.json.channel.id;
  const key = crypto.randomBytes(32);
  const payload = await encryptText(new Uint8Array(key), dmId, 'только для тебя');
  const sent = await api('POST', `/api/channels/${dmId}/messages`, { payload }, a.token);
  assert.equal(sent.status, 200);
  const bList = await api('GET', `/api/channels/${dmId}/messages`, null, b.token);
  assert.equal(bList.json.messages.length, 1);
});

test('вложения: приватность и привязка к каналу', async () => {
  const a = await register('upa');
  const b = await register('upb');
  const up = await api('POST', '/api/upload', {
    data: Buffer.from('encrypted-bytes').toString('base64'),
    name: 'секрет.png',
    mime: 'image/png',
    iv: bytesToB64(crypto.randomBytes(12)),
  }, a.token);
  assert.equal(up.status, 200);
  const url = up.json.url;

  // до отправки в канал — только владелец
  assert.equal((await fetch(serverBase + url, { headers: { Authorization: `Bearer ${a.token}` } })).status, 200);
  assert.equal((await fetch(serverBase + url, { headers: { Authorization: `Bearer ${b.token}` } })).status, 403);

  // создаём канал и прикрепляем
  const dm = await api('POST', `/api/dm/${b.user.id}`, {}, a.token);
  const key = crypto.randomBytes(32);
  const payload = await encryptText(new Uint8Array(key), dm.json.channel.id, '');
  await api('POST', `/api/channels/${dm.json.channel.id}/messages`, {
    payload,
    kind: 'file',
    attachment: { id: up.json.id, name: 'секрет.png', channelId: dm.json.channel.id },
  }, a.token);

  assert.equal((await fetch(serverBase + url, { headers: { Authorization: `Bearer ${b.token}` } })).status, 200);

  // клиент не сможет расшифровать файл без iv — сервер обязан его вернуть
  const history = await api('GET', `/api/channels/${dm.json.channel.id}/messages`, null, a.token);
  const sent = history.json.messages.find((m) => m.kind === 'file');
  assert.ok(sent.attachment.iv, 'iv файла должен возвращаться в истории сообщений');
  assert.equal(sent.attachment.iv, up.json.iv);
});

test('валидация входных данных', async () => {
  const bad = await api('POST', '/api/register', { username: 'Я', password: '12345678', publicKey: 'k' });
  assert.equal(bad.status, 400);
  const weak = await api('POST', '/api/register', { username: 'weakuser', password: '123', publicKey: 'k' });
  assert.equal(weak.status, 400);
  const u = await register('validuser');
  const short = await api('POST', '/api/servers', { name: 'x' }, u.token);
  assert.equal(short.status, 400);
});
