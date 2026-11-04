'use strict';
/**
 * Raut Server — HTTP-раздача клиента + сигналинг WebRTC + чат.
 * Зависимостей нет: только стандартные модули Node.js.
 *
 *   node server/index.js --host 0.0.0.0 --port 8787 --open
 *
 *   --open   после старта открыть клиент в отдельном окне Edge/Chrome
 *            (заменяет VBS/WSH-лаунчеры — их часто ложно детектят антивирусы)
 *
 * Переменные окружения:
 *   RAUT_PORT, RAUT_HOST, RAUT_DATA_DIR, RAUT_CLIENT_DIR
 *   RAUT_TLS_CERT, RAUT_TLS_KEY           — включить HTTPS (нужно для удалённых клиентов)
 *   RAUT_TURN_URL, RAUT_TURN_USER, RAUT_TURN_PASS
 *   RAUT_STUN                            — список STUN через запятую
 *   RAUT_NAME                            — имя сервера
 */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { attachWebSocket } = require('./ws.js');

const VERSION = '1.0.2';
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CFG = {
  port: Number(arg('port', process.env.RAUT_PORT || 8787)),
  host: arg('host', process.env.RAUT_HOST || '0.0.0.0'),
  dataDir: path.resolve(arg('data', process.env.RAUT_DATA_DIR || path.join(ROOT, 'data'))),
  clientDir: path.resolve(arg('client', process.env.RAUT_CLIENT_DIR || path.join(ROOT, 'client'))),
  cert: arg('cert', process.env.RAUT_TLS_CERT || ''),
  key: arg('key', process.env.RAUT_TLS_KEY || ''),
  name: arg('name', process.env.RAUT_NAME || 'Raut Server'),
  turnUrl: arg('turn-url', process.env.RAUT_TURN_URL || ''),
  turnUser: arg('turn-user', process.env.RAUT_TURN_USER || ''),
  turnPass: arg('turn-pass', process.env.RAUT_TURN_PASS || ''),
  // Никаких зарубежных сервисов по умолчанию: WebRTC в одной сети ходит напрямую,
  // а для выхода в интернет администратор задаёт свой STUN/TURN (см. README).
  stun: arg('stun', process.env.RAUT_STUN || ''),
  open: process.argv.includes('--open') || process.env.RAUT_OPEN === '1',
  publicUrl: arg('public-url', process.env.RAUT_PUBLIC_URL || ''),
  // nodew.exe — тот же node.exe с GUI-подсистемой PE: консольного окна нет.
  // Логи в этом режиме пишутся в data/server.log, а не в несуществующий stdout.
  noConsole: process.argv.includes('--no-console') || process.env.RAUT_NO_CONSOLE === '1',
  demo: process.argv.includes('--demo') || process.env.RAUT_DEMO === '1',
};

if (CFG.noConsole) {
  try {
    fs.mkdirSync(CFG.dataDir, { recursive: true });
    const logFile = path.join(CFG.dataDir, 'server.log');
    const write = (...args) => {
      const line = args.map((a) => (a instanceof Error ? (a.stack || a.message) : (typeof a === 'string' ? a : JSON.stringify(a)))).join(' ');
      try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\r\n'); } catch (_) { /* диск недоступен — молчим */ }
    };
    console.log = write; console.info = write; console.warn = write; console.error = write;
    for (const stream of [process.stdout, process.stderr]) {
      if (!stream) continue;
      stream.on?.('error', () => {});
      if (typeof stream.write === 'function') {
        const original = stream.write.bind(stream);
        stream.write = (...a) => { try { return original(...a); } catch (_) { return true; } };
      }
    }
  } catch (_) { /* если не получилось — работаем дальше */ }
}

// Ни один случайный сбой не должен ронять сервер и обрывать соединение у всех.
process.on('uncaughtException', (err) => console.error('[raut] Необработанная ошибка:', err));
process.on('unhandledRejection', (err) => console.error('[raut] Необработанный промис:', err));
// Закрытие консоли/выход из сеанса Windows не должен убивать сервер.
for (const sig of ['SIGHUP', 'SIGBREAK']) process.on(sig, () => {});

const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');
const STATE_FILE = path.join(CFG.dataDir, 'state.json');
const MAX_UPLOAD = 15 * 1024 * 1024;
const MAX_TEXT = 2000;
const HISTORY_LIMIT = 300;
const COLORS = ['#5865f2', '#eb459e', '#3ba55d', '#faa81a', '#ed4245', '#00a8fc', '#9b59b6', '#1abc9c'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const uid = (prefix = '') => prefix + crypto.randomBytes(6).toString('hex');
const now = () => Date.now();

function defaultState() {
  return {
    guilds: [
      {
        id: 'g-main',
        name: 'Общий чат',
        icon: 'R',
        color: '#b83232',
        categories: [
          { id: 'cat-text', name: 'ЧАТ' },
          { id: 'cat-voice', name: 'ГОЛОС' },
        ],
        channels: [
          { id: 'ch-general', guildId: 'g-main', categoryId: 'cat-text', type: 'text', name: 'общий', topic: 'Общий чат для всех' },
          { id: 'ch-games', guildId: 'g-main', categoryId: 'cat-text', type: 'text', name: 'игры', topic: 'Договариваемся, во что играем' },
          { id: 'vc-lounge', guildId: 'g-main', categoryId: 'cat-voice', type: 'voice', name: 'Голосовая', topic: '' },
          { id: 'vc-gaming', guildId: 'g-main', categoryId: 'cat-voice', type: 'voice', name: 'Игровая', topic: '' },
        ],
      },
    ],
    messages: {},   // текстовые каналы серверов
    users: {},      // аккаунты: id -> {id, login, name, passHash, salt, color, avatar, createdAt}
    logins: {},     // логин (нижний регистр) -> id
    tokens: {},     // sha256(токена) -> id  (сессия переживает перезапуск сервера)
    friendships: [], // {a, b, from, status: 'pending'|'accepted', ts}
    dms: {},        // id канала -> {id, participants:[id,id], messages:[]}
  };
}

let state = defaultState();
let saveTimer = null;

async function loadState() {
  try {
    const raw = await fsp.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.guilds) && parsed.guilds.length) {
      const d = defaultState();
      state = {
        ...d, ...parsed,
        users: parsed.users || {},
        logins: parsed.logins || {},
        tokens: parsed.tokens || {},
        friendships: parsed.friendships || [],
        dms: parsed.dms || {},
        messages: parsed.messages || {},
      };
    }
  } catch (_) { /* первый запуск */ }
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fsp.mkdir(CFG.dataDir, { recursive: true });
      await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('[state] не удалось сохранить:', err.message);
    }
  }, 400);
  saveTimer.unref?.();
}

function iceServers() {
  const list = [];
  for (const raw of CFG.stun.split(',')) {
    const url = raw.trim();
    if (url) list.push({ urls: url });
  }
  if (CFG.turnUrl) {
    list.push({
      urls: CFG.turnUrl.split(',').map((u) => u.trim()).filter(Boolean),
      username: CFG.turnUser,
      credential: CFG.turnPass,
    });
  }
  return list;
}

/** Список собранных артефактов, чтобы клиент мог показать кнопки скачивания. */
function releaseEntry(pattern) {
  try {
    const dir = path.resolve(arg('release', process.env.RAUT_RELEASE_DIR || path.join(ROOT, 'release')));
    const file = fs.readdirSync(dir).filter((f) => pattern.test(f)).sort().pop();
    if (!file) return null;
    const full = path.join(dir, file);
    const shaPath = full + '.sha256';
    return {
      name: file,
      dir,
      path: full,
      size: fs.statSync(full).size,
      url: '/download/' + encodeURIComponent(file),
      sha: fs.existsSync(shaPath) ? fs.readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0] : '',
    };
  } catch (_) { return null; }
}
const installerInfo = () => releaseEntry(/^RautSetup-.*\.exe$/i);
const portableInfo = () => releaseEntry(/^Raut-.*-portable\.zip$/i);
const publicRelease = (e) => e ? { name: e.name, size: e.size, url: e.url, sha: e.sha } : null;

/**
 * Открывает клиент в отдельном окне браузера без адресной строки.
 * Обычный child_process.spawn — без WSH/VBS и без скрытых окон.
 */
function openClientWindow() {
  if (process.platform !== 'win32') return; // в Linux/macOS окно открывает пользователь
  const { spawn } = require('node:child_process');
  // Если сборка указывает центральный сервер, установщик открывает сразу его:
  // пользователю не нужно запускать или настраивать свой сервер.
  const url = CFG.publicUrl
    ? CFG.publicUrl.replace(/\/+$/, '') + '/'
    : `${CFG.cert && CFG.key ? 'https' : 'http'}://127.0.0.1:${CFG.port}/`;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const browser = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  const profile = path.join(path.dirname(CFG.dataDir), 'profile');
  try {
    if (browser) {
      const child = spawn(browser, [
        `--app=${url}`,
        '--window-size=1440,900',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
      ], { detached: true, stdio: 'ignore' });
      child.unref();
      console.log('[raut] окно приложения: ' + path.basename(browser));
    } else {
      const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      child.unref();
      console.log('[raut] Edge/Chrome не найден, открываем браузер по умолчанию');
    }
  } catch (err) {
    console.log('[raut] не удалось открыть окно: ' + err.message + ' — откройте ' + url + ' вручную');
  }
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    }
  }
  return out;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.resolve(CFG.clientDir, '.' + rel);
  if (!target.startsWith(CFG.clientDir + path.sep) && target !== CFG.clientDir) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-фолбэк
      const fallback = path.join(CFG.clientDir, 'index.html');
      return fs.readFile(fallback, (e2, buf) => {
        if (e2) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(buf);
      });
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
  });
}

function serveUpload(req, res, pathname) {
  let name;
  try { name = path.basename(decodeURIComponent(pathname)); }
  catch (_) { res.writeHead(400); res.end(); return; }
  const target = path.join(UPLOAD_DIR, name);
  if (!target.startsWith(UPLOAD_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (err, buf) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(name).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name.replace(/^[^_]*_/, ''))}`,
    });
    res.end(buf);
  });
}

function handleUpload(req, res) {
  let raw = '';
  let tooBig = false;
  req.on('data', (c) => {
    raw += c;
    if (raw.length > MAX_UPLOAD * 1.5) { tooBig = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (tooBig) return;
    try {
      const body = JSON.parse(raw);
      const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(body.data || '');
      if (!m) return sendJson(res, 400, { error: 'Некорректные данные' });
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > MAX_UPLOAD) return sendJson(res, 413, { error: 'Файл слишком большой (лимит 15 МБ)' });
      const original = String(body.name || 'file').replace(/[\\/\r\n\0]/g, '_').slice(0, 120);
      const safe = `${uid()}_${original}`;
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      await fsp.writeFile(path.join(UPLOAD_DIR, safe), buf);
      sendJson(res, 200, {
        url: '/uploads/' + encodeURIComponent(safe),
        name: original,
        size: buf.length,
        type: m[1] || 'application/octet-stream',
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Сигналинг и состояние участников                                     */
/* ------------------------------------------------------------------ */

const members = new Map(); // conn.id -> member

function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    color: m.color,
    avatar: m.avatar || '',
    voiceChannelId: m.voiceChannelId || null,
    muted: !!m.muted,
    deafened: !!m.deafened,
    sharing: !!m.sharing,
    camera: !!m.camera,
    status: m.status || 'online',
    game: m.game || '',
  };
}

function memberList() {
  return [...members.values()].map(publicMember);
}

/* ------------------------------------------------------------------ */
/* Аккаунты, друзья и личные сообщения (центральный сервер)            */
/* ------------------------------------------------------------------ */
const initials = (n) => String(n || '?').trim().slice(0, 2).toUpperCase();
const validColor = (c) => /^#[0-9a-f]{6}$/i.test(c) ? c : COLORS[Math.floor(Math.random() * COLORS.length)];

function hashPassword(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 64).toString('hex');
}
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const userById = (id) => state.users[id] || null;

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, login: u.login, name: u.name, color: u.color, avatar: u.avatar || '', createdAt: u.createdAt };
}
function onlineMember(userId) {
  for (const m of members.values()) if (m.id === userId) return m;
  return null;
}
function connForUser(userId) {
  for (const c of wsHub.clients) if (members.get(c.id)?.id === userId) return c;
  return null;
}
function sendToUser(userId, obj) { const c = connForUser(userId); if (c) c.send(obj); }
function friendship(a, b) {
  return state.friendships.find((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
}
function friendIds(userId) {
  return state.friendships
    .filter((f) => f.status === 'accepted' && (f.a === userId || f.b === userId))
    .map((f) => (f.a === userId ? f.b : f.a));
}
function friendsPayload(userId) {
  const friends = friendIds(userId).map((id) => {
    const u = publicUser(userById(id));
    if (!u) return null;
    const m = onlineMember(id);
    return { ...u, status: m ? (m.status || 'online') : 'offline', game: m?.game || '', voiceChannelId: m?.voiceChannelId || null, muted: !!m?.muted, deafened: !!m?.deafened, sharing: !!m?.sharing };
  }).filter(Boolean);
  const requests = state.friendships.filter((f) => f.status === 'pending' && f.b === userId)
    .map((f) => ({ from: publicUser(userById(f.from)), ts: f.ts })).filter((r) => r.from);
  const outgoing = state.friendships.filter((f) => f.status === 'pending' && f.from === userId)
    .map((f) => ({ to: publicUser(userById(f.b)), ts: f.ts })).filter((r) => r.to);
  return { friends, requests, outgoing };
}
function sendFriends(userId) { sendToUser(userId, { t: 'friends', ...friendsPayload(userId) }); }

function dmChannelFor(a, b) {
  return Object.values(state.dms).find((d) => d.participants.includes(a) && d.participants.includes(b));
}
function dmListFor(userId) {
  return Object.values(state.dms)
    .filter((d) => d.participants.includes(userId))
    .map((d) => {
      const peerId = d.participants.find((p) => p !== userId);
      const peer = publicUser(userById(peerId)) || { id: peerId, name: 'Участник', color: '#5865f2', avatar: 'УЧ' };
      const m = onlineMember(peerId);
      const last = d.messages[d.messages.length - 1];
      return {
        id: d.id, type: 'dm', name: peer.name, topic: '',
        peer: { ...peer, status: m ? 'online' : 'offline' },
        lastMessage: last ? { text: last.text, ts: last.ts, authorId: last.authorId } : null,
      };
    })
    .sort((x, y) => (y.lastMessage?.ts || 0) - (x.lastMessage?.ts || 0));
}
function allMessagesFor(userId) {
  const out = {};
  for (const g of state.guilds) for (const ch of g.channels) if (ch.type === 'text') out[ch.id] = state.messages[ch.id] || [];
  for (const d of Object.values(state.dms)) if (d.participants.includes(userId)) out[d.id] = d.messages;
  return out;
}
function makeMember(conn, { id, login = '', name, color, avatar = '', guest = false, token = '' }) {
  return {
    id, login, guest, token, conn,
    name, color, avatar: avatar || initials(name),
    voiceChannelId: null, muted: false, deafened: false, sharing: false, camera: false,
    status: 'online', game: '', lastChat: 0,
  };
}
function sendWelcome(conn, me, token, guest) {
  const social = guest ? { friends: [], requests: [], outgoing: [] } : friendsPayload(me.id);
  conn.send({
    t: 'welcome',
    token: token || '',
    self: { ...publicMember(me), login: me.login || '', guest: !!guest },
    guilds: state.guilds,
    messages: allMessagesFor(me.id),
    dms: guest ? [] : dmListFor(me.id),
    ...social,
    members: memberList(),
    config: {
      name: CFG.name,
      version: VERSION,
      iceServers: iceServers(),
      maxUpload: MAX_UPLOAD,
      lan: lanAddresses(),
      port: CFG.port,
      publicUrl: CFG.publicUrl,
      installer: publicRelease(installerInfo()),
      portable: publicRelease(portableInfo()),
    },
  });
  if (!guest) for (const id of friendIds(me.id)) sendFriends(id);
}

function doAuth(conn, msg) {
  const mode = String(msg.mode || '');
  const fail = (message) => conn.send({ t: 'auth-error', message });
  let user = null, token = null;

  if (mode === 'register') {
    const login = cleanText(msg.login, 24).toLowerCase();
    const pass = String(msg.password || '');
    const name = cleanText(msg.name, 32) || login;
    if (!/^[a-z0-9_.-]{3,24}$/.test(login)) return fail('Логин: 3–24 символа — латиница, цифры, точка, дефис или подчёркивание');
    if (pass.length < 6) return fail('Пароль должен быть не короче 6 символов');
    if (state.logins[login]) return fail('Этот логин уже занят');
    const salt = crypto.randomBytes(16).toString('hex');
    const id = uid('u-');
    user = { id, login, name, passHash: hashPassword(pass, salt), salt, color: validColor(msg.color), avatar: initials(name), createdAt: Date.now() };
    state.users[id] = user;
    state.logins[login] = id;
    token = crypto.randomBytes(32).toString('hex');
    state.tokens[tokenHash(token)] = id;
    saveState();
  } else if (mode === 'login') {
    const login = cleanText(msg.login, 24).toLowerCase();
    user = state.users[state.logins[login]];
    if (!user) return fail('Неверный логин или пароль');
    const given = Buffer.from(hashPassword(String(msg.password || ''), user.salt), 'hex');
    const expected = Buffer.from(user.passHash, 'hex');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return fail('Неверный логин или пароль');
    token = crypto.randomBytes(32).toString('hex');
    state.tokens[tokenHash(token)] = user.id;
    saveState();
  } else if (mode === 'token') {
    user = state.users[state.tokens[tokenHash(String(msg.token || ''))]];
    if (!user) return fail('Сессия истекла — войдите снова');
    token = String(msg.token);
  } else if (mode === 'guest') {
    const name = cleanText(msg.name, 32) || 'Гость';
    const m = makeMember(conn, { id: conn.id, name, color: validColor(msg.color), avatar: initials(name), guest: true });
    members.set(conn.id, m);
    sendWelcome(conn, m, '', true);
    broadcastPresence();
    return;
  } else {
    return fail('Неизвестный способ входа');
  }

  const m = makeMember(conn, { id: user.id, login: user.login, name: user.name, color: user.color, avatar: user.avatar, token });
  members.set(conn.id, m);
  sendWelcome(conn, m, token, false);
  broadcastPresence();
}

/** Демо-аккаунты: на сервере сразу есть пользователи, друзья и история. */
function seedDemoUsers() {
  const demos = [
    { login: 'raut', name: 'Raut', pass: 'raut123', color: '#b83232' },
    { login: 'drug', name: 'Друг', pass: 'drug123', color: '#5865f2' },
    { login: 'team', name: 'Команда', pass: 'team123', color: '#eb459e' },
  ];
  let changed = false;
  for (const d of demos) {
    if (state.logins[d.login]) continue;
    const salt = crypto.randomBytes(16).toString('hex');
    const id = uid('u-');
    state.users[id] = { id, login: d.login, name: d.name, passHash: hashPassword(d.pass, salt), salt, color: d.color, avatar: initials(d.name), createdAt: Date.now() };
    state.logins[d.login] = id;
    changed = true;
  }
  const ids = demos.map((d) => state.logins[d.login]);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!friendship(ids[i], ids[j])) {
        state.friendships.push({ a: ids[i], b: ids[j], from: ids[i], status: 'accepted', ts: Date.now() });
        changed = true;
      }
    }
  }
  if (!state.messages['ch-general']?.length) {
    state.messages['ch-general'] = [{
      id: uid('m-'), channelId: 'ch-general', authorId: ids[0], authorName: 'Raut',
      color: '#b83232', avatar: 'RA', text: 'Все уже здесь 🎮 Заходите в голосовую «Игровая» и играйте вместе.',
      ts: Date.now(), attachment: null,
    }];
    changed = true;
  }
  if (changed) saveState();
  console.log('[raut] демо-пользователи: raut / drug / team (пароль = логин + 123)');
}

function broadcastPresence() {
  wsHub.broadcast({ t: 'presence', members: memberList() });
}

function broadcastGuilds() {
  wsHub.broadcast({ t: 'guilds', guilds: state.guilds });
  saveState();
}

function broadcastRoster(channelId) {
  const peers = [...members.values()]
    .filter((m) => m.voiceChannelId === channelId)
    .map(publicMember);
  wsHub.broadcast(
    { t: 'voice-roster', channelId, peers },
    (c) => members.get(c.id)?.voiceChannelId === channelId
  );
}

function connById(id) {
  for (const c of wsHub.clients) if (members.get(c.id)?.id === id) return c;
  return null;
}

function cleanText(v, limit = MAX_TEXT) {
  return String(v == null ? '' : v).replace(/\u0000/g, '').slice(0, limit).trim();
}

function handleMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  if (!msg || typeof msg.t !== 'string') return;
  const me = members.get(conn.id);
  if (!me && !['hello', 'auth', 'ping', 'state'].includes(msg.t)) return conn.send({ t: 'error', message: 'Сначала войдите в аккаунт' });
  // Клиент может прислать состояние микрофона в тот же тик, что и вход — просто игнорируем.
  if (!me && msg.t === 'state') return;

  switch (msg.t) {
    case 'auth': return doAuth(conn, msg);
    case 'hello': return doAuth(conn, { ...msg, mode: 'guest' });

    case 'friend-add': {
      if (me.guest) return conn.send({ t: 'notice', message: 'Зарегистрируйтесь, чтобы добавлять друзей' });
      const login = cleanText(msg.login, 24).toLowerCase();
      const targetId = state.logins[login];
      if (!targetId) return conn.send({ t: 'notice', message: `Пользователь «${login}» не найден` });
      if (targetId === me.id) return conn.send({ t: 'notice', message: 'Нельзя добавить самого себя' });
      const f = friendship(me.id, targetId);
      if (f) return conn.send({ t: 'notice', message: f.status === 'accepted' ? 'Вы уже друзья' : 'Запрос уже отправлен' });
      state.friendships.push({ a: me.id, b: targetId, from: me.id, status: 'pending', ts: Date.now() });
      saveState();
      sendToUser(targetId, { t: 'friend-request', from: publicUser(userById(me.id)) });
      sendFriends(me.id); sendFriends(targetId);
      return conn.send({ t: 'notice', message: `Запрос отправлен пользователю ${login}` });
    }

    case 'friend-accept':
    case 'friend-decline':
    case 'friend-remove': {
      if (me.guest) return;
      const peerId = cleanText(msg.userId, 64);
      const f = friendship(me.id, peerId);
      if (!f) return;
      if (msg.t === 'friend-remove' || msg.t === 'friend-decline') {
        state.friendships = state.friendships.filter((x) => x !== f);
      } else {
        if (f.from === me.id || f.status !== 'pending') return;
        f.status = 'accepted';
      }
      saveState();
      sendFriends(me.id); sendFriends(peerId);
      conn.send({ t: 'dms', dms: dmListFor(me.id) });
      sendToUser(peerId, { t: 'dms', dms: dmListFor(peerId) });
      return;
    }

    case 'dm-open': {
      if (me.guest) return conn.send({ t: 'notice', message: 'Зарегистрируйтесь, чтобы писать в личные сообщения' });
      const peerId = cleanText(msg.userId, 64);
      if (!state.users[peerId]) return conn.send({ t: 'error', message: 'Пользователь не найден' });
      const f = friendship(me.id, peerId);
      if (!f || f.status !== 'accepted') return conn.send({ t: 'notice', message: 'Сначала добавьте пользователя в друзья' });
      let dm = dmChannelFor(me.id, peerId);
      if (!dm) {
        dm = { id: uid('dm-'), participants: [me.id, peerId], messages: [] };
        state.dms[dm.id] = dm;
        saveState();
      }
      const list = dmListFor(me.id);
      conn.send({ t: 'dm-opened', channel: list.find((d) => d.id === dm.id), dms: list });
      sendToUser(peerId, { t: 'dms', dms: dmListFor(peerId) });
      return;
    }

    case 'friends-refresh': {
      if (me.guest) return;
      sendFriends(me.id);
      conn.send({ t: 'dms', dms: dmListFor(me.id) });
      return;
    }

    case 'chat': {
      const text = cleanText(msg.text);
      if (!text) return;
      const t = now();
      if (t - me.lastChat < 250) return; // анти-спам
      me.lastChat = t;
      const channelId = cleanText(msg.channelId, 64);
      const guildChannel = state.guilds.flatMap((g) => g.channels).find((c) => c.id === channelId && c.type === 'text');
      const dm = guildChannel ? null : state.dms[channelId];
      if (!guildChannel && (!dm || !dm.participants.includes(me.id))) {
        return conn.send({ t: 'error', message: 'Канал не найден' });
      }
      const item = {
        id: uid('m-'),
        channelId,
        authorId: me.id,
        authorName: me.name,
        color: me.color,
        avatar: me.avatar,
        text,
        ts: Date.now(),
        attachment: msg.attachment && typeof msg.attachment === 'object'
          ? {
              url: cleanText(msg.attachment.url, 300),
              name: cleanText(msg.attachment.name, 160),
              size: Number(msg.attachment.size) || 0,
              type: cleanText(msg.attachment.type, 120),
            }
          : null,
      };
      const list = dm ? dm.messages : (state.messages[channelId] || (state.messages[channelId] = []));
      list.push(item);
      if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
      saveState();
      if (dm) {
        for (const pid of dm.participants) {
          sendToUser(pid, { t: 'chat', message: item });
          sendToUser(pid, { t: 'dms', dms: dmListFor(pid) });
        }
      } else {
        wsHub.broadcast({ t: 'chat', message: item });
      }
      return;
    }

    case 'typing': {
      const channelId = cleanText(msg.channelId, 64);
      const dm = state.dms[channelId];
      const payload = { t: 'typing', channelId, userId: me.id, name: me.name };
      if (dm) {
        for (const pid of dm.participants) if (pid !== me.id) sendToUser(pid, payload);
      } else {
        wsHub.broadcast(payload, (c) => c.id !== conn.id);
      }
      return;
    }

    case 'join-voice': {
      const channelId = cleanText(msg.channelId, 64);
      const channel = state.guilds.flatMap((g) => g.channels).find((c) => c.id === channelId && c.type === 'voice');
      if (!channel) return conn.send({ t: 'error', message: 'Голосовой канал не найден' });
      const previous = me.voiceChannelId;
      if (previous && previous !== channelId) {
        for (const c of wsHub.clients) {
          if (c.id !== conn.id) c.send({ t: 'signal', from: me.id, kind: 'bye', media: 'audio' });
          c.send({ t: 'signal', from: me.id, kind: 'bye', media: 'video' });
        }
      }
      me.voiceChannelId = channelId;
      if (previous && previous !== channelId) broadcastRoster(previous);
      broadcastRoster(channelId);
      broadcastPresence();
      return;
    }

    case 'leave-voice': {
      const previous = me.voiceChannelId;
      if (!previous) return;
      me.voiceChannelId = null;
      me.sharing = false;
      for (const c of wsHub.clients) {
        if (c.id === conn.id) continue;
        c.send({ t: 'signal', from: me.id, kind: 'bye', media: 'audio' });
        c.send({ t: 'signal', from: me.id, kind: 'bye', media: 'video' });
      }
      broadcastRoster(previous);
      broadcastPresence();
      return;
    }

    case 'signal': {
      const to = cleanText(msg.to, 64);
      const kind = cleanText(msg.kind, 20);
      if (!to || !['offer', 'answer', 'candidate', 'bye'].includes(kind)) return;
      const target = connById(to);
      if (!target) return;
      target.send({
        t: 'signal',
        from: me.id,
        kind,
        media: msg.media === 'video' ? 'video' : 'audio',
        sdp: msg.sdp,
        candidate: msg.candidate,
      });
      return;
    }

    case 'state': {
      const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
      for (const key of ['muted', 'deafened', 'sharing', 'camera']) {
        if (key in patch) me[key] = !!patch[key];
      }
      if ('name' in patch) me.name = cleanText(patch.name, 32) || me.name;
      if ('color' in patch && /^#[0-9a-f]{6}$/i.test(patch.color)) me.color = patch.color;
      if ('status' in patch && ['online', 'idle', 'dnd', 'invisible'].includes(patch.status)) me.status = patch.status;
      if ('game' in patch) me.game = cleanText(patch.game, 60);
      if (!me.guest) {
        const u = state.users[me.id];
        if (u) {
          if ('name' in patch) { u.name = me.name; u.avatar = initials(me.name); me.avatar = u.avatar; }
          if ('color' in patch) u.color = me.color;
          saveState();
        }
      }
      broadcastPresence();
      return;
    }

    case 'guild-create': {
      const name = cleanText(msg.name, 40) || 'Новый сервер';
      const gid = uid('g-');
      const g = {
        id: gid,
        name,
        icon: name.slice(0, 1).toUpperCase(),
        color: /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : COLORS[state.guilds.length % COLORS.length],
        categories: [
          { id: uid('cat-'), name: 'ТЕКСТОВЫЕ КАНАЛЫ' },
          { id: uid('cat-'), name: 'ГОЛОСОВЫЕ КАНАЛЫ' },
        ],
        channels: [],
      };
      g.channels.push({ id: uid('ch-'), guildId: gid, categoryId: g.categories[0].id, type: 'text', name: 'общий', topic: '' });
      g.channels.push({ id: uid('vc-'), guildId: gid, categoryId: g.categories[1].id, type: 'voice', name: 'Общая', topic: '' });
      state.guilds.push(g);
      broadcastGuilds();
      return;
    }

    case 'channel-create': {
      const guild = state.guilds.find((g) => g.id === cleanText(msg.guildId, 64));
      if (!guild) return;
      const type = msg.type === 'voice' ? 'voice' : 'text';
      const name = cleanText(msg.name, 40).replace(/\s+/g, '-').toLowerCase();
      if (!name) return;
      const cat = guild.categories.find((c) => c.id === msg.categoryId) || guild.categories[type === 'voice' ? 1 : 0];
      const ch = {
        id: uid(type === 'voice' ? 'vc-' : 'ch-'),
        guildId: guild.id,
        categoryId: cat ? cat.id : '',
        type,
        name,
        topic: cleanText(msg.topic, 160),
      };
      guild.channels.push(ch);
      state.messages[ch.id] = [];
      broadcastGuilds();
      return;
    }

    case 'channel-delete': {
      const id = cleanText(msg.channelId, 64);
      const guild = state.guilds.find((g) => g.channels.some((c) => c.id === id));
      if (!guild || guild.channels.length <= 1) return;
      guild.channels = guild.channels.filter((c) => c.id !== id);
      delete state.messages[id];
      for (const m of members.values()) if (m.voiceChannelId === id) m.voiceChannelId = null;
      broadcastGuilds();
      broadcastPresence();
      return;
    }

    case 'ping':
      return conn.send({ t: 'pong', ts: Date.now() });

    default:
      return;
  }
}

/* ------------------------------------------------------------------ */

const requestHandler = (req, res) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (_) { res.writeHead(400); res.end(); return; }

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, name: CFG.name, version: VERSION, clients: members.size, uptime: process.uptime() });
  }
  if (pathname === '/api/config') {
    return sendJson(res, 200, {
      name: CFG.name,
      version: VERSION,
      iceServers: iceServers(),
      maxUpload: MAX_UPLOAD,
      lan: lanAddresses(),
      port: CFG.port,
      publicUrl: CFG.publicUrl,
      installer: publicRelease(installerInfo()),
      portable: publicRelease(portableInfo()),
      accounts: true,
    });
  }
  if (pathname.startsWith('/download/')) {
    let file;
    try { file = path.basename(decodeURIComponent(pathname.slice('/download/'.length))); }
    catch (_) { res.writeHead(400); res.end(); return; }
    const entry = [installerInfo(), portableInfo()].find((e) => e && e.name === file);
    if (!entry || !entry.path.startsWith(entry.dir + path.sep)) {
      res.writeHead(404); res.end('Файл не найден'); return;
    }
    const st = fs.statSync(entry.path);
    res.writeHead(200, {
      'Content-Type': /\.zip$/i.test(file) ? 'application/zip' : 'application/vnd.microsoft.portable-executable',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    });
    return fs.createReadStream(entry.path).pipe(res);
  }
  if (pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res);
  if (pathname.startsWith('/uploads/')) return serveUpload(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  return serveStatic(req, res, pathname);
};

let server;
if (CFG.cert && CFG.key) {
  server = https.createServer({ cert: fs.readFileSync(CFG.cert), key: fs.readFileSync(CFG.key) }, requestHandler);
} else {
  server = http.createServer(requestHandler);
}

const wsHub = attachWebSocket(server, (conn) => {
  conn.on('message', (data, isBinary) => {
    if (isBinary) return;
    try { handleMessage(conn, data); }
    catch (err) { console.error('[signal]', err); }
  });
  conn.on('close', () => {
    const m = members.get(conn.id);
    if (!m) return;
    members.delete(conn.id);
    const channelId = m.voiceChannelId;
    for (const c of wsHub.clients) {
      if (c.id === conn.id) continue;
      c.send({ t: 'signal', from: m.id, kind: 'bye', media: 'audio' });
      c.send({ t: 'signal', from: m.id, kind: 'bye', media: 'video' });
    }
    if (channelId) broadcastRoster(channelId);
    broadcastPresence();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Ярлык запускает сервер при каждом открытии клиента — это нормально.
    console.log(`[raut] порт ${CFG.port} уже занят, считаем сервер запущенным`);
    if (CFG.open) openClientWindow();
    process.exit(0);
  }
  console.error('[raut] ошибка сервера:', err);
  process.exit(1);
});

(async () => {
  await loadState();
  if (CFG.demo) seedDemoUsers();
  await fsp.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
  const proto = CFG.cert && CFG.key ? 'https' : 'http';
  server.listen(CFG.port, CFG.host, () => {
    console.log(`[raut] ${CFG.name} v${VERSION}: ${proto}://${CFG.host}:${CFG.port}`);
    for (const a of lanAddresses()) console.log(`[raut]   LAN: ${proto}://${a.address}:${CFG.port}`);
    if (!CFG.turnUrl) console.log('[raut] TURN не задан: для связи через интернет укажите RAUT_TURN_URL (см. README)');
    if (CFG.open) setTimeout(openClientWindow, 350);
  });
})();

process.on('SIGINT', () => { wsHub.closeAll(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { wsHub.closeAll(); server.close(() => process.exit(0)); });
