import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WsServer } from './ws.js';
import { Store } from './store.js';
import {
  RateLimiter,
  clamp,
  clientIp,
  inviteCode,
  nextId,
  now,
  parseJsonBody,
  readBodyBuffer,
  shortId,
  slugifyName,
  str,
  token,
} from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', 'web');
const APP_VERSION = '0.2.0';
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ATTACHMENT = 32 * 1024 * 1024;

const MIME_ALLOW = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/wav',
  'application/pdf', 'application/zip', 'text/plain', 'application/octet-stream',
]);

const SAFE_NAME = /^[^<>:"/\\|?*\u0000-\u001f]{1,120}$/;

/* ------------------------------------------------------------------ app */

export function createApp({ dataDir = path.resolve(process.cwd(), 'data'), trustProxy = true, rateLimitScale = 1 } = {}) {
  const store = new Store(path.join(dataDir, 'raut.json'));
  const db = store.load();

  const ws = new WsServer({ path: '/ws' });
  const presence = new Map(); // userId -> {connections, status, lastSeen, state:{}}
  const typers = new Map(); // "channelId:userId" -> timeout

  const scaled = (limit) => Math.max(1, Math.round(limit * rateLimitScale));
  const limiters = {
    register: new RateLimiter(scaled(20), 10 * 60 * 1000),
    login: new RateLimiter(scaled(20), 5 * 60 * 1000),
    message: new RateLimiter(scaled(15), 10 * 1000),
    upload: new RateLimiter(scaled(30), 60 * 1000),
    invite: new RateLimiter(scaled(15), 60 * 1000),
  };

  /* ---------------------------------------------------------------- auth */

  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return { salt, hash };
  }

  function verifyPassword(password, user) {
    try {
      const { hash } = hashPassword(password, user.passwordSalt);
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
    } catch {
      return false;
    }
  }

  const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

  function createSession(user, meta = {}) {
    const raw = token();
    db.sessions[hashToken(raw)] = {
      userId: user.id,
      createdAt: now(),
      lastSeen: now(),
      ip: meta.ip || null,
      device: str(meta.device, 64),
    };
    store.save();
    return raw;
  }

  function userFromToken(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const session = db.sessions[hashToken(raw)];
    if (!session) return null;
    const user = db.users[session.userId];
    if (!user) return null;
    session.lastSeen = now();
    if (now() - session.createdAt > 1000 * 60 * 60 * 24 * 120) {
      delete db.sessions[hashToken(raw)];
      store.save();
      return null;
    }
    return user;
  }

  function bearer(req) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7).trim();
    return null;
  }

  /* -------------------------------------------------------------- shapes */

  const publicUser = (u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    publicKey: u.publicKey || null,
    createdAt: u.createdAt,
    bot: !!u.bot,
  });

  function memberIds(server) {
    return Object.keys(server.members || {});
  }

  function isMember(server, userId) {
    return !!server?.members?.[userId];
  }

  function isOwner(server, userId) {
    return server?.ownerId === userId;
  }

  function serverShape(server, userId) {
    const channels = Object.values(db.channels)
      .filter((c) => c.serverId === server.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.createdAt - b.createdAt)
      .map((c) => channelShape(c, userId));
    return {
      id: server.id,
      name: server.name,
      icon: server.icon || null,
      ownerId: server.ownerId,
      role: isOwner(server, userId) ? 'owner' : 'member',
      inviteCode: isMember(server, userId) ? server.inviteCode : undefined,
      createdAt: server.createdAt,
      memberCount: memberIds(server).length,
      channels,
    };
  }

  function channelShape(channel, userId) {
    return {
      id: channel.id,
      serverId: channel.serverId || null,
      name: channel.name,
      topic: channel.topic || '',
      type: channel.type,
      position: channel.position ?? 0,
      kind: channel.kind || 'text',
      hasKey: !!db.channelKeys[channel.id],
      lastMessageAt: channel.lastMessageAt || channel.createdAt,
      unread: unreadCount(channel.id, userId),
    };
  }

  function unreadCount(channelId, userId) {
    const lastRead = db.readState[userId]?.[channelId] || '';
    const msgs = db.messages[channelId] || [];
    let n = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].id <= lastRead) break;
      if (msgs[i].authorId !== userId) n++;
      if (n > 999) break;
    }
    return n;
  }

  function dmPartner(channel, userId) {
    const other = (channel.members || []).find((m) => m !== userId);
    return other ? db.users[other] : null;
  }

  function dmShape(channel, userId) {
    const partner = dmPartner(channel, userId);
    const msgs = db.messages[channel.id] || [];
    const last = msgs[msgs.length - 1];
    return {
      channelId: channel.id,
      user: partner ? publicUser(partner) : null,
      lastMessageAt: last?.createdAt || channel.createdAt,
      unread: unreadCount(channel.id, userId),
    };
  }

  function findDmChannel(a, b) {
    return Object.values(db.channels).find(
      (c) => c.kind === 'dm' && c.members?.length === 2 && c.members.includes(a) && c.members.includes(b),
    );
  }

  function presenceShape(userId) {
    const p = presence.get(userId);
    return {
      userId,
      status: p && p.connections > 0 ? p.status || 'online' : 'offline',
      lastSeen: p?.lastSeen || null,
    };
  }

  /** Публичная карточка без отпечатка присутствия (для поиска незнакомцев). */
  const publicCard = (u) => publicUser(u);

  /** Есть ли у двух людей общий сервер или диалог. */
  function hasCommonContext(a, b) {
    if (a === b) return true;
    const ch = findDmChannel(a, b);
    if (ch) return true;
    for (const server of Object.values(db.servers)) {
      if (isMember(server, a) && isMember(server, b)) return true;
    }
    return false;
  }

  /** Кому видны обновления присутствия пользователя. */
  function watchersOf(userId) {
    const ids = new Set();
    for (const server of Object.values(db.servers)) {
      if (!isMember(server, userId)) continue;
      for (const other of memberIds(server)) ids.add(other);
    }
    for (const channel of Object.values(db.channels)) {
      if (channel.kind === 'dm' && channel.members?.includes(userId)) {
        for (const m of channel.members) ids.add(m);
      }
    }
    ids.delete(userId);
    return ids;
  }

  function channelsOfUserServers(userId) {
    const ids = [];
    for (const server of Object.values(db.servers)) {
      if (!isMember(server, userId)) continue;
      for (const c of Object.values(db.channels)) if (c.serverId === server.id) ids.push(c.id);
    }
    return ids;
  }

  function dmChannelsOf(userId) {
    return Object.values(db.channels).filter((c) => c.kind === 'dm' && c.members?.includes(userId)).map((c) => c.id);
  }

  /* ------------------------------------------------------------ realtime */

  function sendToUser(userId, payload) {
    return ws.broadcast(`user:${userId}`, payload);
  }

  function emitPresence(userId) {
    const payload = { t: 'presence', ...presenceShape(userId) };
    const rooms = [`user:${userId}`, ...[...watchersOf(userId)].map((id) => `user:${id}`)];
    ws.broadcastMany(rooms, payload);
  }

  function channelMembers(channel) {
    if (channel.kind === 'dm') return [...(channel.members || [])];
    const server = db.servers[channel.serverId];
    return server ? memberIds(server) : [];
  }

  function channelRoom(channel) {
    return `channel:${channel.id}`;
  }

  /** События голосового канала видят и участники звонка, и все, кто открыл канал. */
  function broadcastVoice(channel, payload, opts) {
    ws.broadcast(`voice:${channel.id}`, payload, opts);
    ws.broadcast(channelRoom(channel), payload, opts);
  }

  function newMessage({ channel, authorId, payload, kind = 'text', attachment = null, system = null }) {
    const msg = {
      id: nextId(),
      channelId: channel.id,
      authorId,
      kind,
      payload: payload || null,
      attachment: attachment || null,
      system: system || null,
      reactions: {}, // emoji -> [userId], как в Discord
      createdAt: now(),
    };
    (db.messages[channel.id] ||= []).push(msg);
    if (db.messages[channel.id].length > 20000) {
      db.messages[channel.id] = db.messages[channel.id].slice(-20000);
    }
    channel.lastMessageAt = msg.createdAt;
    store.save();
    return msg;
  }

  function userRoomIdsForChannel(channel) {
    if (channel.kind === 'dm') return (channel.members || []).map((m) => `user:${m}`);
    return [channelRoom(channel), `server:${channel.serverId}`];
  }

  /* --------------------------------------------------------- ws handlers */

  ws.on('connection', (conn) => {
    conn.on('message', (msg) => {
      try {
        handleWs(conn, msg);
      } catch (err) {
        console.error('[ws]', err.message);
        conn.send({ t: 'error', message: 'server error' });
      }
    });
  });

  ws.on('connection:close', (conn) => {
    const user = conn.user;
    if (!user) return;
    const p = presence.get(user.id);
    if (p) {
      p.connections = Math.max(0, p.connections - 1);
      p.lastSeen = now();
      if (!p.connections) p.status = 'offline';
    }
    emitPresence(user.id);
    // сообщаем голосовым каналам, что человек отключился
    for (const room of [...conn.rooms]) {
      if (room.startsWith('voice:')) {
        const channelId = room.slice(6);
        const ch = db.channels[channelId];
        const payload = { t: 'rtc:peer-leave', channelId, userId: user.id, connId: conn.id };
        ws.broadcast(room, payload);
        if (ch) ws.broadcast(channelRoom(ch), payload);
        deleteVoiceState(channelId, user.id, conn.id);
      }
    }
  });

  function authenticateWs(conn, helloToken) {
    const t = helloToken || conn.query?.get('token');
    const user = userFromToken(t);
    if (!user) {
      conn.send({ t: 'auth:fail' });
      conn.close(4001, 'auth failed');
      return null;
    }
    conn.user = user;
    const prev = presence.get(user.id);
    const p = prev || { connections: 0, status: 'online', lastSeen: now(), states: {} };
    p.connections += 1;
    if (p.status === 'offline' || p.status === 'invisible') p.status = 'online';
    p.lastSeen = now();
    presence.set(user.id, p);

    conn.data.servers = Object.values(db.servers).filter((s) => isMember(s, user.id)).map((s) => s.id);
    ws.join(conn, `user:${user.id}`);
    for (const s of conn.data.servers) ws.join(conn, `server:${s}`);
    for (const c of [...channelsOfUserServers(user.id), ...dmChannelsOf(user.id)]) {
      ws.join(conn, `channel:${c}`);
    }

    conn.send({
      t: 'ready',
      you: publicUser(user),
      presence: [
        ...[...watchersOf(user.id)].map((id) => presenceShape(id)),
        presenceShape(user.id),
      ],
    });
    emitPresence(user.id);
    return user;
  }

  function handleWs(conn, msg) {
    const type = String(msg.t || '');
    if (type === 'hello') {
      if (!conn.user) authenticateWs(conn, typeof msg.token === 'string' ? msg.token : null);
      return;
    }
    const user = conn.user;
    if (!user) {
      conn.send({ t: 'auth:required' });
      return;
    }
    switch (type) {
      case 'ping':
        conn.send({ t: 'pong', ts: msg.ts });
        return;

      case 'join': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        if (channel.kind !== 'dm' && !isMember(db.servers[channel.serverId], user.id)) return;
        if (channel.kind === 'dm' && !channel.members.includes(user.id)) return;
        ws.join(conn, channelRoom(channel));
        return;
      }

      case 'leave': {
        const channel = db.channels[msg.channelId];
        if (channel) ws.leave(conn, channelRoom(channel));
        return;
      }

      case 'msg': {
        if (!limiters.message.hit(user.id)) {
          conn.send({ t: 'error', message: 'слишком часто, подождите немного' });
          return;
        }
        const channel = db.channels[msg.channelId];
        if (!channel || channel.type !== 'text') return;
        if (channel.kind === 'dm') {
          if (!channel.members.includes(user.id)) return;
        } else if (!isMember(db.servers[channel.serverId], user.id)) return;
        if (!msg.payload || typeof msg.payload !== 'object' || !msg.payload.c) return;
        if (Buffer.byteLength(JSON.stringify(msg.payload)) > MAX_MESSAGE_BYTES) {
          conn.send({ t: 'error', message: 'сообщение слишком большое' });
          return;
        }
        const message = newMessage({
          channel,
          authorId: user.id,
          payload: msg.payload,
          kind: msg.kind === 'file' ? 'file' : 'text',
          attachment: sanitizeAttachment(msg.attachment, user.id),
        });
        const payload = { t: 'msg', channelId: channel.id, message, clientTag: msg.clientTag || null };
        ws.broadcast(channelRoom(channel), payload);
        if (channel.kind === 'dm') {
          // у собеседника может быть закрыт этот канал — шлём точечно
          for (const m of channel.members) sendToUser(m, payload);
        } else {
          ws.broadcast(`server:${channel.serverId}`, {
            t: 'channel:activity',
            channelId: channel.id,
            lastMessageAt: message.createdAt,
          });
        }
        if (channel.kind === 'dm') {
          for (const m of channel.members) {
            sendToUser(m, { t: 'dm:activity', channelId: channel.id, lastMessageAt: message.createdAt });
          }
        }
        return;
      }

      case 'msg:delete': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        const list = db.messages[channel.id] || [];
        const idx = list.findIndex((m) => m.id === msg.messageId);
        if (idx < 0) return;
        const target = list[idx];
        const server = channel.serverId ? db.servers[channel.serverId] : null;
        const canDelete = target.authorId === user.id || (server && isOwner(server, user.id));
        if (!canDelete) {
          conn.send({ t: 'error', message: 'нет прав удалить сообщение' });
          return;
        }
        list.splice(idx, 1);
        store.save();
        const payload = { t: 'msg:delete', channelId: channel.id, messageId: target.id };
        ws.broadcast(channelRoom(channel), payload);
        if (channel.kind === 'dm') for (const m of channel.members) sendToUser(m, payload);
        return;
      }

      case 'typing': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        const key = `${channel.id}:${user.id}`;
        ws.broadcast(channelRoom(channel), {
          t: 'typing',
          channelId: channel.id,
          userId: user.id,
          displayName: user.displayName,
          until: now() + 5000,
        }, { except: conn });
        clearTimeout(typers.get(key));
        const timer = setTimeout(() => typers.delete(key), 6000);
        timer.unref?.();
        typers.set(key, timer);
        return;
      }

      case 'read': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        (db.readState[user.id] ||= {})[channel.id] = str(msg.messageId, 32);
        store.save();
        sendToUser(user.id, { t: 'read:ok', channelId: channel.id, messageId: msg.messageId });
        return;
      }

      case 'presence:set': {
        const p = presence.get(user.id);
        const status = ['online', 'idle', 'dnd', 'invisible'].includes(msg.status) ? msg.status : 'online';
        if (p) p.status = status;
        emitPresence(user.id);
        return;
      }

      /* -------------------------------------------------------- WebRTC */

      case 'rtc:join': {
        const channel = db.channels[msg.channelId];
        if (!channel || channel.type !== 'voice') return;
        if (channel.kind !== 'dm' && !isMember(db.servers[channel.serverId], user.id)) return;
        const room = `voice:${channel.id}`;
        ws.join(conn, room);
        ws.join(conn, channelRoom(channel));
        const peers = [];
        const set = ws.rooms.get(room);
        if (set) {
          for (const other of set) {
            if (other === conn || !other.user) continue;
            peers.push({
              userId: other.user.id,
              connId: other.id,
              displayName: other.user.displayName,
              voice: other.voiceState || { mute: false, deaf: false, video: false, speaking: false },
            });
          }
        }
        conn.send({ t: 'rtc:peers', channelId: channel.id, peers });
        conn.send({ t: 'rtc:joined', channelId: channel.id, selfConnId: conn.id });
        broadcastVoice(channel, {
          t: 'rtc:peer-join',
          channelId: channel.id,
          peer: {
            userId: user.id,
            connId: conn.id,
            displayName: user.displayName,
            voice: conn.voiceState || { mute: false, deaf: false, video: false, speaking: false },
          },
        }, { except: conn });
        return;
      }

      case 'rtc:signal': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        const room = `voice:${channel.id}`;
        if (!conn.rooms.has(room)) return;
        const set = ws.rooms.get(room);
        if (!set) return;
        const target = msg.to === 'all' ? null : [...set].find((c) => c.id === msg.to);
        if (!target) {
          if (msg.to !== 'all') return;
          ws.broadcast(room, { t: 'rtc:signal', channelId: channel.id, from: conn.id, fromUser: user.id, data: msg.data }, { except: conn });
          return;
        }
        target.send({ t: 'rtc:signal', channelId: channel.id, from: conn.id, fromUser: user.id, data: msg.data });
        return;
      }

      case 'rtc:leave': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        const room = `voice:${channel.id}`;
        ws.leave(conn, room);
        broadcastVoice(channel, { t: 'rtc:peer-leave', channelId: channel.id, userId: user.id, connId: conn.id });
        deleteVoiceState(channel.id, user.id, conn.id);
        return;
      }

      case 'voice:state': {
        const channel = db.channels[msg.channelId];
        if (!channel) return;
        const state = {
          mute: !!msg.mute,
          deaf: !!msg.deaf,
          video: !!msg.video,
          speaking: !!msg.speaking,
        };
        conn.voiceState = state;
        const p = presence.get(user.id);
        if (p) (p.states[channel.id] ||= {})[conn.id] = state;
        broadcastVoice(channel, {
          t: 'voice:state',
          channelId: channel.id,
          userId: user.id,
          connId: conn.id,
          displayName: user.displayName,
          ...state,
        });
        return;
      }

      case 'keys:request': {
        const channel = db.channels[msg.channelId];
        if (!channel || channel.kind === 'dm') return;
        const server = db.servers[channel.serverId];
        if (!server) return;
        const keys = db.channelKeys[channel.id];
        if (!keys || !keys.adminPub) return;
        sendToUser(server.ownerId, { t: 'keys:sync', channelId: channel.id, userId: user.id });
        return;
      }

      case 'rtc:joined-dm': {
        // звонок в личке: собеседнику нужно уведомление (если у него не открыт канал)
        const channel = db.channels[msg.channelId];
        if (!channel || channel.kind !== 'dm') return;
        for (const m of channel.members) {
          if (m === user.id) continue;
          sendToUser(m, {
            t: 'rtc:invite',
            channelId: channel.id,
            from: publicUser(user),
            video: !!msg.video,
            channelName: 'звонок в личке',
          });
        }
        return;
      }

      case 'rtc:decline': {
        const channel = db.channels[msg.channelId];
        if (!channel || channel.kind !== 'dm') return;
        for (const m of channel.members) {
          if (m === user.id) continue;
          sendToUser(m, { t: 'rtc:decline', userId: user.id, displayName: user.displayName, channelId: channel.id });
        }
        return;
      }

      default:
        return;
    }
  }

  function deleteVoiceState(channelId, userId, connId) {
    const p = presence.get(userId);
    if (p?.states?.[channelId]) delete p.states[channelId][connId];
    const ch = db.channels[channelId];
    const payload = { t: 'voice:state', channelId, userId, connId, left: true };
    if (ch) broadcastVoice(ch, payload);
    else ws.broadcast(`voice:${channelId}`, payload);
  }

  /* ------------------------------------------------------------- static */

  const staticTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.txt': 'text/plain; charset=utf-8',
  };

  const BRAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b98cff"/><stop offset="0.55" stop-color="#8a55f0"/><stop offset="1" stop-color="#5b2bbf"/>
    </linearGradient></defs>
    <rect width="128" height="128" rx="30" fill="url(#g)"/>
    <path d="M38 92V36h20c13 0 21 6.6 21 17.4 0 8.2-4.9 13.6-12.8 15.8L83 92H68L57 71h-7v21H38zm12-31h7.4c6 0 9.4-2.7 9.4-7.2s-3.4-7.2-9.4-7.2H50V61z" fill="#fff"/>
    <circle cx="88" cy="88" r="7" fill="#59e3c8"/>
  </svg>`;

  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'ALLOWALL', // клиент может открываться во встроенном окне
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src * ws: wss: data: blob:; font-src 'self' data:; frame-ancestors *",
  };

  function serveStatic(req, res, pathname) {
    if (pathname === '/icon.svg') {
      const data = Buffer.from(BRAND_ICON, 'utf8');
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'image/svg+xml', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
      return res.end(data);
    }
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.includes('\u0000')) {
      res.writeHead(400).end('bad path');
      return;
    }
    const filePath = path.join(WEB_DIR, rel);
    if (!filePath.startsWith(WEB_DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (!err && stats.isFile()) return sendFile(res, filePath, stats);
      if (err || !stats.isFile()) {
        // SPA fallback
        const index = path.join(WEB_DIR, 'index.html');
        fs.stat(index, (e2, s2) => {
          if (e2) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Raut: клиент не собран (web/index.html не найден)');
            return;
          }
          sendFile(res, index, s2);
        });
      }
    });
  }

  function sendFile(res, filePath, stats) {
    const ext = path.extname(filePath).toLowerCase();
    const type = staticTypes[ext] || 'application/octet-stream';
    const etag = `W/"${stats.size}-${Math.floor(stats.mtimeMs)}"`;
    const cache = /\/assets\//.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': type,
      'Content-Length': stats.size,
      'Cache-Control': cache,
      ETag: etag,
    });
    fs.createReadStream(filePath).pipe(res);
  }

  /* ------------------------------------------------------------ helpers */

  function sanitizeAttachment(a, ownerId) {
    if (!a || typeof a !== 'object') return null;
    const file = db.meta.__files?.[a.id];
    if (!file || file.ownerId !== ownerId) return null;
    if (file.channelId) return null;
    file.channelId = a.channelId || null;
    store.save();
    return {
      id: file.id,
      name: str(a.name, 120) || file.name,
      size: file.size,
      mime: file.mime,
      // iv нужен клиенту, чтобы расшифровать файл: без него вложение
      // скачивается, но не открывается («Файл недоступен»)
      iv: file.iv || '',
      url: `/api/attachments/${file.id}`,
    };
  }

  /** Реакции в вид, удобный клиенту: [{ emoji, users: [id...] }] */
  function reactionsFor(msg) {
    const map = msg.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
    return Object.entries(map)
      .filter(([, users]) => Array.isArray(users) && users.length)
      .map(([emoji, users]) => ({ emoji, users: users.slice(0, 200), count: users.length }));
  }

  function publicMessage(msg) {
    return { ...msg, reactions: reactionsFor(msg) };
  }

  function json(res, status, body) {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
      ...securityHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  }

  function fail(res, status, message) {
    json(res, status, { error: message });
  }

  async function requireUser(req, res) {
    const user = userFromToken(bearer(req));
    if (!user) {
      fail(res, 401, 'нужно войти');
      return null;
    }
    return user;
  }

  function wsUrlFor(req) {
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    return `${proto === 'https' ? 'wss' : 'ws'}://${host}/ws`;
  }

  /* ---------------------------------------------------------------- API */

  async function handleApi(req, res, pathname) {
    const method = req.method.toUpperCase();
    const ip = clientIp(req);
    const url = new URL(req.url, 'http://localhost');
    const body = method === 'GET' || method === 'DELETE' ? {} : await parseJsonBody(req);

    /* ---- служебное */
    if (pathname === '/api/health') {
      return json(res, 200, {
        name: 'Raut',
        version: APP_VERSION,
        uptime: Math.round(process.uptime()),
        users: Object.keys(db.users).length,
        servers: Object.keys(db.servers).length,
        online: [...presence.values()].filter((p) => p.connections > 0).length,
        ws: wsUrlFor(req),
      });
    }

    if (pathname === '/api/config') {
      const user = userFromToken(bearer(req));
      const open = Object.keys(db.users).length === 0;
      return json(res, 200, {
        name: 'Raut',
        version: APP_VERSION,
        registrationOpen: open || db.meta.registrationOpen !== false,
        firstRun: open,
        ws: wsUrlFor(req),
        limits: { attachment: MAX_ATTACHMENT, message: MAX_MESSAGE_BYTES },
        you: user ? publicUser(user) : null,
      });
    }

    /* ---- регистрация / вход */
    if (pathname === '/api/register' && method === 'POST') {
      if (!limiters.register.hit(ip)) return fail(res, 429, 'слишком много попыток, попробуйте позже');
      if (db.meta.registrationOpen === false) return fail(res, 403, 'регистрация закрыта');
      const username = String(body.username || '').trim().toLowerCase();
      const displayName = str(body.displayName, 32) || String(body.username || '').trim();
      const password = String(body.password || '');
      const publicKey = str(body.publicKey, 200);
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
        return fail(res, 400, 'имя пользователя: 3–24 символа, латиница, цифры, _ . -');
      }
      if (password.length < 8) return fail(res, 400, 'пароль должен быть не короче 8 символов');
      if (password.length > 200) return fail(res, 400, 'слишком длинный пароль');
      if (!publicKey) return fail(res, 400, 'не передан ключ устройства');
      if (Object.values(db.users).some((u) => u.username === username)) {
        return fail(res, 409, 'такое имя уже занято');
      }
      const { salt, hash } = hashPassword(password);
      const user = {
        id: nextId(),
        username,
        displayName,
        passwordSalt: salt,
        passwordHash: hash,
        publicKey,
        avatarColor: pickColor(username),
        createdAt: now(),
        lastSeen: now(),
        bot: false,
      };
      db.users[user.id] = user;
      store.save();
      const t = createSession(user, { ip, device: str(body.device, 64) });
      return json(res, 200, {
        token: t,
        user: publicUser(user),
        ws: wsUrlFor(req),
        servers: [],
        dms: [],
      });
    }

    if (pathname === '/api/login' && method === 'POST') {
      if (!limiters.login.hit(ip)) return fail(res, 429, 'слишком много попыток, подождите пару минут');
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = Object.values(db.users).find((u) => u.username === username);
      if (!user || !verifyPassword(password, user)) return fail(res, 401, 'неверное имя или пароль');
      user.lastSeen = now();
      const t = createSession(user, { ip, device: str(body.device, 64) });
      return json(res, 200, { token: t, ...bootstrap(user), ws: wsUrlFor(req) });
    }

    if (pathname === '/api/logout' && method === 'POST') {
      const t = bearer(req);
      if (t) {
        delete db.sessions[hashToken(t)];
        store.save();
      }
      return json(res, 200, { ok: true });
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (pathname === '/api/me' && method === 'GET') {
      return json(res, 200, { user: publicUser(user), ...bootstrap(user), ws: wsUrlFor(req) });
    }

    if (pathname === '/api/me' && method === 'PATCH') {
      if (body.displayName !== undefined) {
        const name = str(body.displayName, 32);
        if (!name) return fail(res, 400, 'имя не может быть пустым');
        user.displayName = name;
      }
      if (body.publicKey !== undefined) user.publicKey = str(body.publicKey, 200) || user.publicKey;
      if (body.avatarColor) user.avatarColor = str(body.avatarColor, 16) || user.avatarColor;
      store.save();
      for (const watcher of watchersOf(user.id)) sendToUser(watcher, { t: 'user:update', user: publicUser(user) });
      return json(res, 200, { user: publicUser(user) });
    }

    if (pathname === '/api/me/password' && method === 'POST') {
      if (!verifyPassword(String(body.current || ''), user)) return fail(res, 403, 'текущий пароль неверен');
      const next = String(body.next || '');
      if (next.length < 8) return fail(res, 400, 'новый пароль короче 8 символов');
      const { salt, hash } = hashPassword(next);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      // выкидываем остальные сессии
      for (const [k, s] of Object.entries(db.sessions)) if (s.userId === user.id) delete db.sessions[k];
      store.save();
      const t = createSession(user, { ip, device: 'password-change' });
      return json(res, 200, { token: t });
    }

    /* ---- пользователи */
    const userMatch = pathname.match(/^\/api\/users\/([A-Za-z0-9]+)$/);
    if (userMatch && method === 'GET') {
      const target = db.users[userMatch[1]];
      if (!target) return fail(res, 404, 'пользователь не найден');
      return json(res, 200, { user: publicUser(target), presence: presenceShape(target.id) });
    }

    const userSearch = pathname === '/api/users';
    if (userSearch && method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2) return json(res, 200, { users: [] });
      const found = Object.values(db.users)
        .filter((u) => u.id !== user.id && (u.username.includes(q) || u.displayName.toLowerCase().includes(q)))
        .slice(0, 10)
        .map((u) => ({ ...publicCard(u), known: hasCommonContext(user.id, u.id) }));
      return json(res, 200, { users: found });
    }

    /* ---- серверы */
    if (pathname === '/api/servers' && method === 'POST') {
      const name = str(body.name, 48);
      if (name.length < 2) return fail(res, 400, 'название сервера — минимум 2 символа');
      const server = {
        id: nextId(),
        name,
        icon: str(body.icon, 300000) || null,
        ownerId: user.id,
        inviteCode: inviteCode(),
        createdAt: now(),
        members: {
          [user.id]: { joinedAt: now(), role: 'owner' },
        },
      };
      db.servers[server.id] = server;
      const general = createChannel(server, { name: 'общий', type: 'text' });
      createChannel(server, { name: 'Голосовой', type: 'voice' });
      store.save();
      systemMessage(general, user.id, `${user.displayName} ${verbFor(user.displayName, 'создал', 'создала', 'создали')} сервер «${name}»`);
      return json(res, 200, { server: serverShape(server, user.id) });
    }

    if (pathname === '/api/servers/join' && method === 'POST') {
      if (!limiters.invite.hit(user.id)) return fail(res, 429, 'слишком много попыток вступить');
      const code = String(body.code || '').trim().toLowerCase().replace(/^.*\/invite\//, '');
      const server = Object.values(db.servers).find((s) => s.inviteCode === code);
      if (!server) return fail(res, 404, 'приглашение не найдено или устарело');
      if (!isMember(server, user.id)) {
        server.members[user.id] = { joinedAt: now(), role: 'member' };
        store.save();
        for (const c of Object.values(db.channels)) {
          if (c.serverId !== server.id) continue;
          if (c.type === 'text') {
            const sys = systemMessage(c, user.id, `${user.displayName} ${verbFor(user.displayName, 'присоединился', 'присоединилась', 'присоединились')} к серверу`);
            broadcastSystem(c, sys);
          }
        }
        for (const m of memberIds(server)) {
          sendToUser(m, { t: 'server:member-join', serverId: server.id, user: publicUser(user) });
          sendToUser(m, { t: 'server:update', server: serverShape(server, m) });
        }
        // ключ канала перезавернёт клиент владельца (E2E): просим его об этом
        for (const c of Object.values(db.channels)) {
          if (c.serverId === server.id && c.type === 'text') {
            sendToUser(server.ownerId, { t: 'keys:sync', channelId: c.id, userId: user.id });
          }
        }
      }
      return json(res, 200, { server: serverShape(server, user.id) });
    }

    const serverMatch = pathname.match(/^\/api\/servers\/([A-Za-z0-9]+)(\/[a-z]+)?$/);
    if (serverMatch) {
      const server = db.servers[serverMatch[1]];
      if (!server) return fail(res, 404, 'сервер не найден');
      const sub = serverMatch[2] || '';
      if (!isMember(server, user.id)) return fail(res, 403, 'вы не участник этого сервера');

      if (!sub && method === 'GET') return json(res, 200, { server: serverShape(server, user.id) });

      if (!sub && method === 'PATCH') {
        if (!isOwner(server, user.id)) return fail(res, 403, 'только владелец может менять сервер');
        if (body.name !== undefined) {
          const name = str(body.name, 48);
          if (name.length < 2) return fail(res, 400, 'слишком короткое название');
          server.name = name;
        }
        if (body.icon !== undefined) server.icon = str(body.icon, 300000) || null;
        store.save();
        for (const m of memberIds(server)) sendToUser(m, { t: 'server:update', server: serverShape(server, m) });
        return json(res, 200, { server: serverShape(server, user.id) });
      }

      if (!sub && method === 'DELETE') {
        if (!isOwner(server, user.id)) return fail(res, 403, 'удалить сервер может только владелец');
        for (const m of memberIds(server)) {
          sendToUser(m, { t: 'server:deleted', serverId: server.id });
          ws.broadcast(`server:${server.id}`, { t: 'server:deleted', serverId: server.id });
        }
        for (const c of Object.values(db.channels)) {
          if (c.serverId !== server.id) continue;
          delete db.channels[c.id];
          delete db.messages[c.id];
          delete db.channelKeys[c.id];
        }
        delete db.servers[server.id];
        store.save();
        return json(res, 200, { ok: true });
      }

      if (sub === '/leave' && method === 'POST') {
        if (isOwner(server, user.id)) return fail(res, 400, 'владелец не может выйти — удалите сервер');
        delete server.members[user.id];
        store.save();
        sendToUser(user.id, { t: 'server:deleted', serverId: server.id });
        for (const m of memberIds(server)) sendToUser(m, { t: 'server:update', server: serverShape(server, m) });
        return json(res, 200, { ok: true });
      }

      if (sub === '/kick' && method === 'POST') {
        if (!isOwner(server, user.id)) return fail(res, 403, 'только владелец может исключать');
        const targetId = String(body.userId || '');
        if (targetId === server.ownerId) return fail(res, 400, 'владельца исключить нельзя');
        if (!isMember(server, targetId)) return fail(res, 404, 'такого участника нет');
        delete server.members[targetId];
        store.save();
        sendToUser(targetId, { t: 'server:deleted', serverId: server.id });
        for (const m of memberIds(server)) sendToUser(m, { t: 'server:update', server: serverShape(server, m) });
        return json(res, 200, { ok: true });
      }

      if (sub === '/members' && method === 'GET') {
        const members = memberIds(server).map((id) => {
          const u = db.users[id];
          return u
            ? {
                ...publicUser(u),
                role: id === server.ownerId ? 'owner' : 'member',
                presence: presenceShape(id),
                joinedAt: server.members[id].joinedAt,
              }
            : null;
        }).filter(Boolean);
        return json(res, 200, { members });
      }

      if (sub === '/invites' && method === 'POST') {
        if (!isOwner(server, user.id)) return fail(res, 403, 'только владелец может создавать приглашения');
        server.inviteCode = inviteCode();
        store.save();
        return json(res, 200, { code: server.inviteCode });
      }

      if (sub === '/channels' && method === 'POST') {
        if (!isOwner(server, user.id) && !server.members[user.id]?.canManage) {
          return fail(res, 403, 'создавать каналы может владелец');
        }
        const type = body.type === 'voice' ? 'voice' : 'text';
        const channel = createChannel(server, {
          name: str(body.name, 32) || (type === 'voice' ? 'Голосовой' : 'новый-канал'),
          type,
          topic: str(body.topic, 200),
        });
        store.save();
        for (const m of memberIds(server)) {
          sendToUser(m, { t: 'channel:created', serverId: server.id, channel: channelShape(channel, m) });
        }
        return json(res, 200, { channel: channelShape(channel, user.id) });
      }
    }

      // реакция на сообщение: POST /api/channels/:id/messages/:msgId/react { emoji }
      const reactMatch = pathname.match(/^\/api\/channels\/([A-Za-z0-9_-]+)\/messages\/([A-Za-z0-9_-]+)\/react$/);
      if (reactMatch && method === 'POST') {
        const target = db.channels[reactMatch[1]];
        if (!target) return fail(res, 404, 'канал не найден');
        if (target.kind === 'dm') {
          if (!target.members.includes(user.id)) return fail(res, 403, 'это не ваш диалог');
        } else if (!isMember(db.servers[target.serverId], user.id)) {
          return fail(res, 403, 'вы не участник сервера');
        }
        const emoji = str(body.emoji, 16);
        if (!emoji) return fail(res, 400, 'нет эмодзи');
        const msg = (db.messages[target.id] || []).find((m) => m.id === reactMatch[2]);
        if (!msg) return fail(res, 404, 'сообщение не найдено');
        msg.reactions ||= {};
        const users = (msg.reactions[emoji] ||= []);
        const i = users.indexOf(user.id);
        if (i >= 0) users.splice(i, 1);
        else users.push(user.id);
        if (!users.length) delete msg.reactions[emoji];
        store.save();
        const out = { t: 'msg:reactions', channelId: target.id, messageId: msg.id, reactions: reactionsFor(msg) };
        ws.broadcast(channelRoom(target), out);
        if (target.kind === 'dm') for (const m of target.members) sendToUser(m, out);
        return json(res, 200, { reactions: reactionsFor(msg) });
      }

    /* ---- каналы */
    const channelMatch = pathname.match(
      /^\/api\/channels\/([A-Za-z0-9]+)(?:\/(messages|keys|read|typing|call|members))?$/,
    );
    if (channelMatch) {
      const channel = db.channels[channelMatch[1]];
      if (!channel) return fail(res, 404, 'канал не найден');
      const sub = channelMatch[2] || '';

      if (channel.kind === 'dm') {
        if (!channel.members.includes(user.id)) return fail(res, 403, 'это не ваш диалог');
      } else {
        if (!isMember(db.servers[channel.serverId], user.id)) return fail(res, 403, 'вы не участник сервера');
      }

      if (sub === 'messages' && method === 'GET') {
        const limit = clamp(Number(url.searchParams.get('limit')) || 50, 1, 100);
        const before = url.searchParams.get('before');
        const after = url.searchParams.get('after');
        let list = db.messages[channel.id] || [];
        if (before) list = list.filter((m) => m.id < before);
        if (after) list = list.filter((m) => m.id > after);
        list = list.slice(-limit);
        const authors = {};
        for (const m of list) {
          if (!authors[m.authorId]) {
            const u = db.users[m.authorId];
            if (u) authors[m.authorId] = publicUser(u);
          }
        }
        return json(res, 200, { messages: list.map(publicMessage), authors, hasMore: list.length === limit });
      }

      if (sub === 'messages' && method === 'POST') {
        if (!limiters.message.hit(user.id)) return fail(res, 429, 'не так быстро');
        if (channel.type !== 'text') return fail(res, 400, 'в голосовой канал нельзя писать');
        const payload = body.payload;
        if (!payload || typeof payload !== 'object' || !payload.c) return fail(res, 400, 'нет шифротекста');
        if (Buffer.byteLength(JSON.stringify(payload)) > MAX_MESSAGE_BYTES) return fail(res, 400, 'слишком большое сообщение');
        const message = newMessage({
          channel,
          authorId: user.id,
          payload,
          kind: body.kind === 'file' ? 'file' : 'text',
          attachment: sanitizeAttachment(body.attachment, user.id),
        });
        const out = { t: 'msg', channelId: channel.id, message: publicMessage(message) };
        ws.broadcast(channelRoom(channel), out);
        if (channel.kind === 'dm') for (const m of channel.members) sendToUser(m, out);
        return json(res, 200, { message });
      }

      if (sub === 'messages' && method === 'DELETE') {
        // очистка истории (владелец сервера или участник личного диалога)
        const isDm = channel.kind === 'dm';
        const isSrvOwner = !isDm && isOwner(db.servers[channel.serverId], user.id);
        if (!isDm && !isSrvOwner) return fail(res, 403, 'очистить историю может владелец сервера');
        db.messages[channel.id] = [];
        store.save();
        const out = { t: 'channel:cleared', channelId: channel.id };
        ws.broadcast(channelRoom(channel), out);
        if (isDm) for (const m of channel.members) sendToUser(m, out);
        return json(res, 200, { ok: true });
      }

      if (sub === 'keys' && method === 'GET') {
        const keys = db.channelKeys[channel.id] || { adminPub: null, keys: {} };
        return json(res, 200, {
          channelId: channel.id,
          myEnvelope: keys.keys[user.id] || null,
          memberIds: channelMembers(channel),
          adminPub: keys.adminPub,
          adminId: channel.kind === 'dm' ? null : db.servers[channel.serverId]?.ownerId || null,
          updatedAt: keys.updatedAt || null,
        });
      }

      if (sub === 'keys' && method === 'PUT') {
        const keys = (db.channelKeys[channel.id] ||= { adminPub: null, keys: {} });
        const isDm = channel.kind === 'dm';
        const server = isDm ? null : db.servers[channel.serverId];
        const allowed = isDm || !server || server.ownerId === user.id;
        if (!allowed) {
          return fail(res, 403, 'ключи канала может обновлять владелец сервера');
        }
        if (body.adminPub) keys.adminPub = str(body.adminPub, 200);
        if (body.keys && typeof body.keys === 'object') {
          const memberSet = new Set(channelMembers(channel));
          for (const [targetId, envelope] of Object.entries(body.keys)) {
            if (!memberSet.has(targetId)) continue;
            if (!envelope || typeof envelope !== 'object' || !envelope.e || !envelope.i || !envelope.c) continue;
            keys.keys[targetId] = {
              e: str(envelope.e, 300),
              i: str(envelope.i, 64),
              c: str(envelope.c, 300),
            };
          }
        }
        keys.updatedAt = now();
        store.save();
        for (const m of channelMembers(channel)) sendToUser(m, { t: 'keys:update', channelId: channel.id });
        return json(res, 200, { ok: true, members: Object.keys(keys.keys) });
      }

      if (sub === 'read' && method === 'POST') {
        (db.readState[user.id] ||= {})[channel.id] = str(body.messageId, 32);
        store.save();
        return json(res, 200, { ok: true, unread: 0 });
      }

      if (sub === 'typing' && method === 'POST') {
        ws.broadcast(channelRoom(channel), {
          t: 'typing',
          channelId: channel.id,
          userId: user.id,
          displayName: user.displayName,
          until: now() + 5000,
        });
        return json(res, 200, { ok: true });
      }

      if (sub === 'members' && method === 'GET') {
        const members = channelMembers(channel).map((id) => {
          const u = db.users[id];
          return u ? { ...publicUser(u), presence: presenceShape(id) } : null;
        }).filter(Boolean);
        return json(res, 200, { members });
      }

      if (sub === 'call' && method === 'POST') {
        if (channel.type !== 'voice') return fail(res, 400, 'это не голосовой канал');
        const payload = {
          t: 'rtc:invite',
          channelId: channel.id,
          from: publicUser(user),
          serverId: channel.serverId || null,
          channelName: channel.name,
        };
        const targets = channel.kind === 'dm' ? channel.members.filter((m) => m !== user.id) : [];
        let n = 0;
        for (const target of targets) n += sendToUser(target, payload);
        return json(res, 200, { ok: true, notified: n });
      }

      if (!sub && method === 'PATCH') {
        const server = channel.serverId ? db.servers[channel.serverId] : null;
        if (server && !isOwner(server, user.id)) return fail(res, 403, 'переименовывать каналы может владелец');
        if (body.name !== undefined) {
          const name = str(body.name, 32);
          if (!name) return fail(res, 400, 'название не может быть пустым');
          channel.name = name;
        }
        if (body.topic !== undefined) channel.topic = str(body.topic, 200);
        if (body.position !== undefined) channel.position = clamp(Number(body.position) || 0, 0, 999);
        store.save();
        if (server) {
          for (const m of memberIds(server)) sendToUser(m, { t: 'channel:update', channel: channelShape(channel, m) });
        }
        return json(res, 200, { channel: channelShape(channel, user.id) });
      }

      if (!sub && method === 'DELETE') {
        const server = channel.serverId ? db.servers[channel.serverId] : null;
        if (!server || !isOwner(server, user.id)) return fail(res, 403, 'удалять каналы может владелец');
        delete db.channels[channel.id];
        delete db.messages[channel.id];
        delete db.channelKeys[channel.id];
        store.save();
        for (const m of memberIds(server)) sendToUser(m, { t: 'channel:deleted', serverId: server.id, channelId: channel.id });
        return json(res, 200, { ok: true });
      }
    }

    /* ---- личные сообщения */
    const dmMatch = pathname.match(/^\/api\/dm\/([A-Za-z0-9]+)$/);
    if (dmMatch && method === 'POST') {
      const other = db.users[dmMatch[1]];
      if (!other) return fail(res, 404, 'пользователь не найден');
      if (other.id === user.id) return fail(res, 400, 'с собой переписываться не нужно');
      let channel = findDmChannel(user.id, other.id);
      if (!channel) {
        channel = {
          id: nextId(),
          kind: 'dm',
          type: 'text',
          members: [user.id, other.id],
          name: 'личные',
          createdAt: now(),
          lastMessageAt: now(),
        };
        db.channels[channel.id] = channel;
        store.save();
        for (const m of channel.members) {
          const p = db.users[m];
          sendToUser(m, { t: 'dm:created', dm: dmShape(channel, m), user: publicUser(p) });
        }
      }
      return json(res, 200, { channel: channelShape(channel, user.id), dm: dmShape(channel, user.id), other: publicUser(other) });
    }

    /* ---- вложения (клиент шифрует до отправки) */
    if (pathname === '/api/upload' && method === 'POST') {
      if (!limiters.upload.hit(user.id)) return fail(res, 429, 'слишком много загрузок');
      const data = String(body.data || '');
      if (!data) return fail(res, 400, 'нет данных');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length) return fail(res, 400, 'пустой файл');
      if (bytes.length > MAX_ATTACHMENT) return fail(res, 413, 'файл больше 32 МБ');
      const fileId = shortId(12);
      const dir = path.join(dataDir, 'files');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileId), bytes);
      (db.meta.__files ||= {})[fileId] = {
        id: fileId,
        ownerId: user.id,
        size: bytes.length,
        name: SAFE_NAME.test(String(body.name || '')) ? str(body.name, 120) : 'файл',
        mime: MIME_ALLOW.has(body.mime) ? body.mime : 'application/octet-stream',
        iv: str(body.iv, 64),
        createdAt: now(),
        channelId: null,
      };
      store.save();
      return json(res, 200, {
        id: fileId,
        url: `/api/attachments/${fileId}`,
        size: bytes.length,
        iv: str(body.iv, 64),
      });
    }

    const fileMatch = pathname.match(/^\/api\/attachments\/([A-Za-z0-9_-]+)$/);
    if (fileMatch && method === 'GET') {
      const meta = db.meta.__files?.[fileMatch[1]];
      if (!meta) return fail(res, 404, 'файл не найден');
      if (meta.channelId) {
        const channel = db.channels[meta.channelId];
        if (!channel) return fail(res, 404, 'файл недоступен');
        const hasAccess =
          channel.kind === 'dm' ? channel.members.includes(user.id) : isMember(db.servers[channel.serverId], user.id);
        if (!hasAccess) return fail(res, 403, 'нет доступа к файлу');
      } else if (meta.ownerId !== user.id) {
        return fail(res, 403, 'нет доступа к файлу');
      }
      const filePath = path.join(dataDir, 'files', meta.id);
      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        return fail(res, 404, 'файл потерян');
      }
      res.writeHead(200, {
        ...securityHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size,
        'Content-Disposition': `attachment; filename="raut-${meta.id}.bin"`,
        'Cache-Control': 'private, max-age=3600',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    return fail(res, 404, 'неизвестный метод API');
  }

  function createChannel(server, { name, type, topic = '' }) {
    const base = slugifyName(name) || 'канал';
    const channel = {
      id: nextId(),
      serverId: server.id,
      name: base || name,
      topic,
      type,
      position: Object.values(db.channels).filter((c) => c.serverId === server.id).length,
      createdAt: now(),
      lastMessageAt: now(),
      kind: 'text',
    };
    db.channels[channel.id] = channel;
    return channel;
  }

  function systemMessage(channel, authorId, text) {
    const msg = {
      id: nextId(),
      channelId: channel.id,
      authorId,
      kind: 'system',
      payload: null,
      system: text,
      createdAt: now(),
    };
    (db.messages[channel.id] ||= []).push(msg);
    channel.lastMessageAt = msg.createdAt;
    store.save();
    return msg;
  }

  function broadcastSystem(channel, msg) {
    ws.broadcast(channelRoom(channel), { t: 'msg', channelId: channel.id, message: msg });
  }

  function bootstrap(user) {
    const servers = Object.values(db.servers)
      .filter((s) => isMember(s, user.id))
      .map((s) => serverShape(s, user.id))
      .sort((a, b) => a.createdAt - b.createdAt);
    const dms = Object.values(db.channels)
      .filter((c) => c.kind === 'dm' && c.members.includes(user.id))
      .map((c) => dmShape(c, user.id))
      .sort((a, b) => a.lastMessageAt - b.lastMessageAt);
    const presenceList = new Set();
    for (const s of Object.values(db.servers)) {
      if (!isMember(s, user.id)) continue;
      for (const m of memberIds(s)) if (m !== user.id) presenceList.add(m);
    }
    for (const c of Object.values(db.channels)) {
      if (c.kind === 'dm' && c.members.includes(user.id)) {
        for (const m of c.members) if (m !== user.id) presenceList.add(m);
      }
    }
    return {
      servers,
      dms,
      presence: [...presenceList].map((id) => presenceShape(id)),
      unreadTotal: [...servers.flatMap((s) => s.channels), ...dms].reduce((n, c) => n + (c.unread || 0), 0),
    };
  }

  /* ---------------------------------------------------------- HTTP entry */

  async function handler(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...securityHeaders,
          'Access-Control-Allow-Origin': req.headers.origin || '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Max-Age': '86400',
        });
        return res.end();
      }
      if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      return serveStatic(req, res, pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[http]', err);
      if (!res.headersSent) fail(res, status, status >= 500 ? 'внутренняя ошибка сервера' : err.message);
      else res.end();
    }
  }

  function attach(httpServer) {
    httpServer.on('upgrade', (req, socket, head) => {
      // Никаких origin-проверок: клиент живёт в Electron и в iframe предпросмотра.
      ws.handleUpgrade(req, socket, head);
    });
    httpServer.on('request', handler);
  }

  function close() {
    store.flush();
    ws.close();
    try {
      for (const f of fs.readdirSync(dataDir)) void f;
    } catch { /* ignore */ }
  }

  return { store, db, ws, handler, attach, close, presence };
}

/**
 * Русский род по имени: «Алиса создала», «Боб создал», «Женя создал(а)».
 * Без словаря: смотрим окончание имени, для неоднозначных — нейтрально.
 */
function genderOf(name = '') {
  const n = String(name).trim().toLowerCase();
  if (!n) return 'm';
  const unisex = ['саша', 'женя', 'валя', 'шура', 'слава', 'никита', 'илья', 'кузьма', 'фома', 'лёва', 'лева', 'миша', 'паша', 'гоша', 'дима', 'сева', 'вова'];
  if (unisex.includes(n)) return 'n';
  if (/(а|я|ия|ья)$/.test(n) && !/(илья|кузьма|фома|никита|савва|данила)$/.test(n)) return 'f';
  if (/(ий|ый|ой)$/.test(n)) return 'm';
  if (/(а|я)$/.test(n)) return 'f';
  return 'm';
}

function verbFor(name, m, f, n) {
  const g = genderOf(name);
  if (g === 'f') return f;
  if (g === 'n') return n || `${m}(а)`;
  return m;
}

function pickColor(seed) {
  const palette = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
