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
  ok(Array.isArray(config.iceServers) && config.accounts === true, 'GET /api/config (аккаунты включены, ICE без зарубежных STUN)');
  ok(!JSON.stringify(config.iceServers).includes('google.com'), 'нет зарубежных STUN по умолчанию');

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

  for (const f of ['/styles.css', '/app.js', '/rtc.js', '/net.js', '/config.js', '/assets/logo.png']) {
    const r = await fetch(BASE + f);
    ok(r.status === 200 && (await r.arrayBuffer()).byteLength > 100, 'GET ' + f);
  }

  const a = client('Алиса');
  const b = client('Борис');
  await Promise.all([a.ready, b.ready]);
  ok(true, 'WebSocket handshake (RFC 6455, без зависимостей)');

  const tag = Date.now().toString(36);
  const loginA = 'alice_' + tag, loginB = 'boris_' + tag;
  a.send({ t: 'auth', mode: 'register', login: loginA, password: 'secret123', name: 'Алиса', color: '#5865f2' });
  b.send({ t: 'auth', mode: 'register', login: loginB, password: 'secret123', name: 'Борис', color: '#eb459e' });
  const wa = await a.waitFor((m) => m.t === 'welcome', 'welcome A');
  const wb = await b.waitFor((m) => m.t === 'welcome', 'welcome B');
  ok(wa.guilds?.length > 0 && wa.config?.version, 'welcome: серверы и конфигурация');
  ok(wa.self?.id && wb.self?.id && wa.self.id !== wb.self.id, 'разные id участников');
  ok(wa.token && wb.token && wa.token !== wb.token, 'регистрация выдаёт токен сессии');
  ok(wa.self.login === loginA && wb.self.login === loginB, 'логины сохранены в аккаунтах');
  ok(Array.isArray(wa.friends) && Array.isArray(wa.dms), 'welcome: друзья и личные чаты');

  // Повторный вход по сохранённому токену (как при перезапуске приложения).
  const c = client('Алиса-2');
  await c.ready;
  c.send({ t: 'auth', mode: 'token', token: wa.token });
  const wc = await c.waitFor((m) => m.t === 'welcome', 'welcome по токену');
  ok(wc.self.id === wa.self.id, 'автовход по токену возвращает тот же аккаунт');
  c.ws.close();

  // Друзья: запрос → принятие → личный чат.
  const req = b.waitFor((m) => m.t === 'friend-request', 'входящий запрос');
  a.send({ t: 'friend-add', login: loginB });
  const gotReq = await req;
  ok(gotReq.from?.login === loginA, 'запрос в друзья доставлен адресату');
  const accepted = a.waitFor((m) => m.t === 'friends' && m.friends.length === 1, 'список друзей A');
  b.send({ t: 'friend-accept', userId: wa.self.id });
  const acc = await accepted;
  ok(acc.friends[0].login === loginB, 'друг появился в списке');

  a.send({ t: 'dm-open', userId: wb.self.id });
  const opened = await a.waitFor((m) => m.t === 'dm-opened', 'личный канал создан');
  ok(opened.channel?.id && Array.isArray(opened.dms), 'личный чат доступен обоим');
  const dmText = 'Привет лично!';
  const dmGot = b.waitFor((m) => m.t === 'chat' && m.message.channelId === opened.channel.id, 'ЛС доставлено');
  a.send({ t: 'chat', channelId: opened.channel.id, text: dmText });
  const dmsg = await dmGot;
  ok(dmsg.message.text === dmText, 'личное сообщение не ушло в общий чат');
  // Посторонний не должен видеть ЛС.
  const outsider = client('Посторонний');
  await outsider.ready;
  outsider.send({ t: 'auth', mode: 'guest', name: 'Гость' });
  await outsider.waitFor((m) => m.t === 'welcome', 'welcome гостя');
  a.send({ t: 'chat', channelId: opened.channel.id, text: 'Второе личное' });
  await new Promise((r) => setTimeout(r, 250));
  ok(!outsider.inbox.some((m) => m.t === 'chat' && m.message.channelId === opened.channel.id), 'ЛС приватно: гость его не получил');
  outsider.ws.close();

  const presence = await a.waitFor((m) => m.t === 'presence' && m.members.length >= 2, 'presence 2 участника');
  ok(presence.members.some((m) => m.name === 'Борис'), 'presence: второй участник виден');

  const ch = wa.guilds[0].channels.find((c) => c.type === 'text');
  a.send({ t: 'chat', channelId: ch.id, text: 'Привет из теста 🎧' });
  const chat = await b.waitFor((m) => m.t === 'chat' && m.message.text.includes('из теста'), 'chat доставлен B');
  ok(chat.message.authorName === 'Алиса' && chat.message.id, 'chat: автор и id');

  const game = b.waitFor((m) => m.t === 'presence' && m.members.some((x) => x.game === 'CS2'), 'игровой статус');
  a.send({ t: 'state', patch: { game: 'CS2' } });
  await game; ok(true, 'игровой статус «во что играю» виден всем');

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
