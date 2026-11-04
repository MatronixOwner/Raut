/**
 * Интеграционный smoke-тест сервера Raut (только встроенные модули Node.js 22+).
 *   node scripts/smoke-test.mjs [http://127.0.0.1:8787]
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const WS = BASE.replace(/^http/, 'ws') + '/ws';

let passed = 0;
const ok = (cond, label) => {
  if (!cond) throw new Error('FAIL: ' + label);
  passed++;
  console.log('  ok  ' + label);
};

function client(name) {
  const ws = new WebSocket(WS);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].test(msg)) {
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  };
  const waitFor = (test, label, timeout = 4000) => new Promise((resolve, reject) => {
    const found = inbox.find(test);
    if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeout);
    waiters.push({ test, resolve: (m) => { clearTimeout(t); resolve(m); } });
  });
  const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { ws, inbox, waitFor, ready, name, send: (o) => ws.send(JSON.stringify(o)) };
}

async function main() {
  console.log('Raut smoke-test →', BASE);

  const health = await (await fetch(BASE + '/api/health')).json();
  ok(health.ok === true && health.version, 'GET /api/health');

  const config = await (await fetch(BASE + '/api/config')).json();
  ok(Array.isArray(config.iceServers) && config.iceServers.length > 0, 'GET /api/config (ICE)');

  if (config.installer) {
    const dl = await fetch(BASE + config.installer.url);
    const buf = Buffer.from(await dl.arrayBuffer());
    ok(dl.status === 200 && buf[0] === 0x4d && buf[1] === 0x5a, 'GET /download/RautSetup.exe (PE, MZ)');
    ok(buf.length === config.installer.size, 'размер установщика совпадает с /api/config');
    ok(/attachment/.test(dl.headers.get('content-disposition') || ''), 'Content-Disposition: attachment');
  }
  if (config.portable) {
    const zip = await fetch(BASE + config.portable.url);
    const buf = Buffer.from(await zip.arrayBuffer());
    ok(zip.status === 200 && buf[0] === 0x50 && buf[1] === 0x4b, 'GET /download/Raut-portable.zip (ZIP)');
  }

  const html = await (await fetch(BASE + '/')).text();
  ok(html.includes('connectScreen') && html.includes('/app.js'), 'GET / (клиент)');

  for (const f of ['/styles.css', '/app.js', '/rtc.js', '/net.js', '/assets/logo.png']) {
    const r = await fetch(BASE + f);
    ok(r.status === 200 && (await r.arrayBuffer()).byteLength > 100, 'GET ' + f);
  }

  const a = client('Алиса');
  const b = client('Борис');
  await Promise.all([a.ready, b.ready]);
  ok(true, 'WebSocket handshake (RFC 6455, без зависимостей)');

  a.send({ t: 'hello', name: 'Алиса', color: '#5865f2' });
  b.send({ t: 'hello', name: 'Борис', color: '#eb459e' });
  const wa = await a.waitFor((m) => m.t === 'welcome', 'welcome A');
  const wb = await b.waitFor((m) => m.t === 'welcome', 'welcome B');
  ok(wa.guilds?.length > 0 && wa.config?.version, 'welcome: серверы и конфигурация');
  ok(wa.self?.id && wb.self?.id && wa.self.id !== wb.self.id, 'разные id участников');

  const presence = await a.waitFor((m) => m.t === 'presence' && m.members.length >= 2, 'presence 2 участника');
  ok(presence.members.some((m) => m.name === 'Борис'), 'presence: второй участник виден');

  const ch = wa.guilds[0].channels.find((c) => c.type === 'text');
  a.send({ t: 'chat', channelId: ch.id, text: 'Привет из теста 🎧' });
  const chat = await b.waitFor((m) => m.t === 'chat' && m.message.text.includes('Привет'), 'chat доставлен B');
  ok(chat.message.authorName === 'Алиса' && chat.message.id, 'chat: автор и id');

  const typ = b.waitFor((m) => m.t === 'typing', 'typing');
  a.send({ t: 'typing', channelId: ch.id });
  await typ; ok(true, 'typing ретранслируется');

  const vc = wa.guilds[0].channels.find((c) => c.type === 'voice');
  a.send({ t: 'join-voice', channelId: vc.id });
  await a.waitFor((m) => m.t === 'voice-roster' && m.peers.length === 1, 'roster: A в канале');
  b.send({ t: 'join-voice', channelId: vc.id });
  const roster = await a.waitFor((m) => m.t === 'voice-roster' && m.peers.length === 2, 'roster: A+B в канале');
  ok(roster.peers.some((p) => p.name === 'Борис'), 'roster: оба собеседника');

  const sig = b.waitFor((m) => m.t === 'signal' && m.kind === 'offer', 'signal offer → B');
  a.send({ t: 'signal', to: wb.self.id, kind: 'offer', media: 'audio', sdp: { type: 'offer', sdp: 'v=0\r\n' } });
  const offer = await sig;
  ok(offer.from === wa.self.id && offer.media === 'audio', 'WebRTC-сигналинг: таргетная доставка');

  const guilds = a.waitFor((m) => m.t === 'guilds' && m.guilds.length > wa.guilds.length, 'новый сервер');
  a.send({ t: 'guild-create', name: 'Тестовый сервер' });
  await guilds; ok(true, 'создание сервера и рассылка состояния');

  const channels = b.waitFor((m) => m.t === 'guilds' && m.guilds[0].channels.length > wb.guilds[0].channels.length, 'новый канал');
  a.send({ t: 'channel-create', guildId: wa.guilds[0].id, name: 'музыка', type: 'text' });
  await channels; ok(true, 'создание канала и рассылка состояния');

  const data = 'data:text/plain;base64,' + Buffer.from('привет').toString('base64');
  const up = await (await fetch(BASE + '/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'тест.txt', data }),
  })).json();
  ok(up.url?.startsWith('/uploads/'), 'POST /api/upload');
  const downloaded = await (await fetch(BASE + up.url)).text();
  ok(downloaded === 'привет', 'GET /uploads/... (байты совпадают)');

  a.ws.close(); b.ws.close();
  console.log(`\n✓ ${passed} проверок пройдено`);
}

main().catch((err) => { console.error('\n' + err.message); process.exit(1); });
