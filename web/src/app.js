/** Raut — ядро клиента. */

import * as apiMod from './api.js';
import {
  b64ToBytes,
  bytesToB64,
  decryptBytes,
  decryptText,
  deriveDMKey,
  encryptBytes,
  encryptText,
  fingerprint,
  generateIdentity,
  randomId,
  unwrapKey,
  wrapKeyFor,
} from './crypto.js';
import { audio, formatBytes, formatDuration } from './audio.js';
import { Mesh } from './rtc.js';
import { icon, hydrateIcons } from './icons.js';
import {
  avatar,
  clock,
  confirmDialog,
  contextMenu,
  debounce,
  escapeAttr,
  escapeHtml,
  formatMessage,
  modal,
  promptDialog,
  relTime,
  throttle,
  toast,
} from './ui.js';
import { authView, mainView, membersView, messagesView, railView, sidebarView, typingView, voiceView } from './views.js';
import {
  openChannelMenu,
  openCreateServer,
  openEmojiPicker,
  openFindUser,
  openIncomingCall,
  openJoinInvite,
  openPalette,
  openServerSettings,
  openSettings,
  openUserCard,
} from './panels.js';

const VERSION = '0.1.0';
const { store, KEYS } = apiMod;

/* ------------------------------------------------------------------ state */

const S = {
  version: VERSION,
  settings: {
    denoise: 'gtcrn',
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true,
    monitor: false,
    inputVolume: 1,
    outputVolume: 1,
    micDeviceId: '',
    sound: true,
    badge: true,
    compact: false,
    accent: '#a273ff',
    membersOpen: false,
  },
  identity: null,
  token: null,
  me: null,
  servers: [],
  dms: [],
  presence: {},
  members: {},
  memberIndex: {},
  authors: {},
  channels: {},
  keys: {},
  keyErrors: {},
  unread: {},
  typing: {},
  view: { type: 'home', id: null, serverId: null },
  connection: 'offline',
  membersOpen: false,
  mobileSide: false,
  voice: freshVoice(),
  voiceMembers: {},
  devices: [],
  authBusy: false,
  firstRun: false,
  serverLabel: '',
  desktop: null,
  dmCalls: {},
};

function freshVoice() {
  return {
    channelId: null,
    channelName: null,
    joined: false,
    muted: false,
    deafened: false,
    cameraOn: false,
    screenOn: false,
    speaking: false,
    participants: new Map(),
    startedAt: 0,
    dm: false,
    selfConnId: null,
    peers: new Map(),
    media: new Map(),
    localStream: null,
    cameraStream: null,
    screenStream: null,
    connectErrors: 0,
  };
}

/* -------------------------------------------------------------- bootstrap */

const app = {
  S,
  audio,
  api: apiMod,
  cryptoModule: { fingerprint, wrapKeyFor, unwrapKey, deriveDMKey, encryptText, decryptText, encryptBytes, decryptBytes, generateIdentity },
  realtime: null,
  mesh: null,
  settingsTimer: null,
};

window.Raut = app; // для отладки и для упаковщика

function loadLocal() {
  const saved = store.get(KEYS.settings);
  if (saved && typeof saved === 'object') S.settings = { ...S.settings, ...saved };
  S.identity = store.get(KEYS.identity);
  S.token = store.get(KEYS.token);
  S.membersOpen = !!S.settings.membersOpen;
  applyLook();
}

function applyLook() {
  if (S.settings.accent) document.documentElement.style.setProperty('--accent', S.settings.accent);
  document.body.classList.toggle('compact', !!S.settings.compact);
}

app.saveSetting = function saveSetting(key, value) {
  S.settings[key] = value;
  if (key === 'membersOpen') S.membersOpen = value;
  store.set(KEYS.settings, S.settings);
};

app.setToken = function setToken(t) {
  S.token = t;
  if (t) store.set(KEYS.token, t);
  else store.del(KEYS.token);
};

async function ensureIdentity() {
  if (S.identity?.priv && S.identity?.pub) return S.identity;
  // ключи могли остаться в IndexedDB (localStorage почистили)
  const backup = await apiMod.idb.get('identity').catch(() => null);
  if (backup?.priv && backup?.pub) {
    S.identity = backup;
    store.set(KEYS.identity, backup);
    return S.identity;
  }
  S.identity = await generateIdentity();
  store.set(KEYS.identity, S.identity);
  apiMod.idb.set('identity', S.identity).catch(() => {});
  return S.identity;
}

function registerIdentityKey() {
  // Публичный ключ устройства на сервере: нужен другим, чтобы заворачивать ключи каналов.
  if (!S.me || !S.identity) return;
  if (S.me.publicKey === S.identity.pub) return;
  apiMod.patch('/api/me', { publicKey: S.identity.pub }).then((r) => {
    S.me = { ...S.me, ...r.user };
  }).catch(() => {});
}

async function boot() {
  loadLocal();
  S.serverLabel = apiMod.getServerUrl().replace(/^https?:\/\//, '');
  S.desktop = window.rautDesktop || null;
  if (S.desktop) {
    try {
      const info = await S.desktop.info();
      S.desktopData = info;
      S.desktop.version = info.version;
    } catch { /* ignore */ }
    S.desktop.on?.('open-settings', () => openSettings(app));
    S.desktop.on?.('context', (ctx) => {
      S.desktopData = { ...(S.desktopData || {}), ...ctx };
    });
  }

  try {
    const cfg = await apiMod.get('/api/config');
    S.firstRun = !!cfg.firstRun;
    S.version = cfg.version || VERSION;
    S.registrationOpen = cfg.registrationOpen !== false;
    S.serverLabel = apiMod.getServerUrl().replace(/^https?:\/\//, '');
  } catch (err) {
    // сервер недоступен — покажем экран с выбором адреса
    renderAuth('login', 'Сервер недоступен: ' + err.message);
    if (S.token) S.token = null;
    return;
  }

  if (S.token) {
    try {
      await ensureIdentity();
      const me = await apiMod.get('/api/me');
      S.me = me.user;
      absorbBootstrap(me);
      registerIdentityKey();
      startRealtime();
      afterLogin();
      return;
    } catch (err) {
      if (err.status === 401) {
        S.token = null;
        store.del(KEYS.token);
      } else {
        renderAuth('login', err.message);
        return;
      }
    }
  }
  renderAuth('login', '');
}

function absorbBootstrap(payload) {
  if (payload.servers) S.servers = payload.servers;
  if (payload.dms) S.dms = payload.dms;
  if (payload.presence) {
    for (const p of payload.presence) S.presence[p.userId] = { status: p.status, lastSeen: p.lastSeen };
  }
  for (const s of S.servers) {
    for (const c of s.channels) {
      S.unread[c.id] = c.unread || 0;
      S.voiceMembers[c.id] ||= new Set();
    }
  }
  for (const d of S.dms) S.unread[d.channelId] = d.unread || 0;
  updateTitle();
}

/* --------------------------------------------------------------- render */

const appEl = () => document.getElementById('app');

function renderAuth(mode = 'login', err = '') {
  appEl().innerHTML = authView({ ...S, serverLabel: S.serverLabel }, mode, err);
  const form = appEl().querySelector('[data-auth-form]');
  appEl().querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => renderAuth(b.dataset.mode, '');
  });
  appEl().querySelector('[data-change-server]')?.addEventListener('click', () => changeServerDialog());
  form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitAuth(mode, form);
  });
  const pwd = form?.querySelector('input[name="password"]');
  const pwd2 = form?.querySelector('input[name="password2"]');
  if (pwd && mode === 'register') {
    pwd.addEventListener('input', () => {
      const hint = form.querySelector('[data-strength]');
      const v = pwd.value;
      let score = 0;
      if (v.length >= 8) score++;
      if (v.length >= 12) score++;
      if (/[A-ZА-Я]/.test(v) && /[a-zа-я]/.test(v)) score++;
      if (/\d/.test(v)) score++;
      if (/[^\w\s]/.test(v)) score++;
      const labels = ['слишком короткий', 'слабый', 'нормальный', 'хороший', 'надёжный', 'отличный'];
      hint.textContent = `Надёжность: ${labels[Math.min(score, 5)]}`;
      hint.className = 'hint ' + (score >= 3 ? 'good' : v.length ? 'bad' : '');
    });
    pwd2?.addEventListener('input', () => {
      const hint = form.querySelector('[data-match]');
      if (!pwd2.value) {
        hint.textContent = '';
        return;
      }
      const ok = pwd2.value === pwd.value;
      hint.textContent = ok ? 'Пароли совпадают' : 'Пароли не совпадают';
      hint.className = 'hint ' + (ok ? 'good' : 'bad');
    });
  }
}

function changeServerDialog() {
  modal({
    title: 'Адрес сервера Raut',
    lead: 'Введите адрес вашего сервера. Его запускает любой участник — данные хранятся там.',
    body: `
      <div class="field"><label>Адрес</label>
        <input name="server" value="${escapeAttr(apiMod.getServerUrl())}" placeholder="http://localhost:8787" /></div>
      <div class="hint">Примеры: <span class="mono-box" style="display:inline-block;padding:2px 6px">http://192.168.1.10:8787</span>
        <span class="mono-box" style="display:inline-block;padding:2px 6px">https://raut.example.com</span></div>`,
    actions: `<button class="btn ghost" data-close>Отмена</button><button class="btn" data-ok>Подключиться</button>`,
    onMount(el, close) {
      const input = el.querySelector('input');
      el.querySelector('[data-ok]').onclick = async () => {
        apiMod.setServerUrl(input.value.trim());
        S.serverLabel = apiMod.getServerUrl().replace(/^https?:\/\//, '');
        close();
        try {
          await apiMod.get('/api/config');
          toast('Сервер отвечает', 'ok');
          location.reload();
        } catch (err) {
          toast('Сервер не отвечает: ' + err.message, 'err', 5000);
          renderAuth('login', '');
        }
      };
      input.addEventListener('keydown', (ev) => ev.key === 'Enter' && el.querySelector('[data-ok]').click());
    },
  });
}

async function submitAuth(mode, form) {
  const data = Object.fromEntries(new FormData(form).entries());
  S.authBusy = true;
  renderAuth(mode, '');
  try {
    await ensureIdentity();
    let res;
    if (mode === 'register') {
      if (data.password !== data.password2) throw new Error('Пароли не совпадают');
      if (!data.username?.trim()) throw new Error('Введите имя пользователя');
      res = await apiMod.post('/api/register', {
        username: data.username.trim(),
        displayName: data.displayName?.trim() || data.username.trim(),
        password: data.password,
        publicKey: S.identity.pub,
        device: deviceLabel(),
      });
    } else {
      res = await apiMod.post('/api/login', {
        username: data.username?.trim(),
        password: data.password,
        device: deviceLabel(),
      });
    }
    app.setToken(res.token);
    S.me = res.user;
    absorbBootstrap(res);
    startRealtime();
    afterLogin();
    toast(mode === 'register' ? 'Добро пожаловать в Raut!' : 'С возвращением!', 'ok');
  } catch (err) {
    S.authBusy = false;
    renderAuth(mode, err.message);
  }
}

function deviceLabel() {
  const p = S.desktop?.platform || navigator.platform || '';
  return p.slice(0, 40);
}

function afterLogin() {
  S.authBusy = false;
  S.view = { type: 'home', id: null, serverId: null };
  paint('all');
  ensureIdentity().then(() => {
    registerIdentityKey();
    hydrateAllServerKeys();
  });
  audio.settings = { ...audio.settings, ...S.settings };
  audio.speakingCb = (speaking) => {
    S.voice.speaking = speaking;
    if (S.voice.joined) {
      sendVoiceState();
      document.querySelectorAll('[data-peer="self"]').forEach((t) => t.classList.toggle('speaking', speaking));
      const av = document.querySelector('.video-tile.self-tile .avatar');
      if (av) av.classList.toggle('speaking', speaking);
    }
  };
  audio.onDeviceLost = () => toast('Микрофон отключился — проверьте устройство', 'err', 5000);
  loadDevices();
  if (S.settings.sound) {
    // разблокировка аудио-контекста первым жестом
    const unlock = () => {
      audio.ensureContext().then(() => {
        document.removeEventListener('pointerdown', unlock);
      });
    };
    document.addEventListener('pointerdown', unlock);
  }
  if (S.desktop?.setTrayState) S.desktop.setTrayState({ unread: 0 });
}

function startRealtime() {
  app.realtime?.close();
  app.realtime = new apiMod.Realtime({
    onStatus(status) {
      S.connection = status;
      const dot = document.querySelector('[data-conn]');
      if (dot) dot.dataset.conn = status;
      if (status === 'online' || status === 'ready') refreshUnreadTitle();
      paint('status');
    },
    onEvent: handleWsEvent,
  });
  app.realtime.connect();
}

/* ---------------------------------------------------------------- paint */

let paintQueued = false;
function paint(what = 'all') {
  if (paintQueued) {
    S._paintAll = true;
    return;
  }
  paintQueued = true;
  queueMicrotask(() => {
    paintQueued = false;
    try {
      paintNow(what);
    } catch (err) {
      console.error('[paint]', err);
    }
  });
}

/** На узком экране панель каналов — выдвижная: класс на каркасе. */
function applyMobileSide() {
  const frame = appEl().querySelector('.frame');
  if (frame) frame.classList.toggle('mobile-side-open', !!S.mobileSide);
}

function paintNow(what) {
  if (!S.me) return;
  const shell = appEl().querySelector('.frame');
  if (!shell) renderShell();
  else {
    if (what === 'all' || what === 'side' || what === 'status') renderSide();
    if (what === 'all') renderMainFull();
    else if (what === 'messages') renderMessagesOnly();
    else if (what === 'typing') renderTypingOnly();
    else if (what === 'members') renderMainFull();
    else if (what === 'voice') renderVoiceOnly();
  }
}

function renderShell() {
  appEl().innerHTML = `
    <div class="frame">
      ${railView(S)}
      ${sidebarView(S)}
      <div class="scrim" data-act="close-side"></div>
      <div data-main-slot style="display:contents"></div>
    </div>`;
  bindGlobal();
  renderMainFull();
}

function renderSide() {
  const rail = appEl().querySelector('.rail');
  if (rail) rail.outerHTML = railView(S);
  const side = appEl().querySelector('.side');
  if (side) side.outerHTML = sidebarView(S);
}

function mainHost() {
  const frame = appEl().querySelector('.frame');
  let slot = frame?.querySelector('[data-main-slot]');
  if (!slot && frame) {
    slot = document.createElement('div');
    slot.dataset.mainSlot = '';
    slot.style.display = 'contents';
    frame.appendChild(slot);
  }
  return slot;
}

function membersHost() {
  return appEl().querySelector('.members');
}

let lastRendered = { channelId: null, version: 0 };

function renderMainFull() {
  const v = S.view;
  const withMembers = (v.type === 'channel' || v.type === 'voice') && S.membersOpen;
  const frame = appEl().querySelector('.frame');
  if (frame) {
    frame.className = 'frame' + (withMembers ? ' with-members' : '');
  }
  let html;
  if (v.type === 'channel' || v.type === 'dm') html = mainView(S);
  else if (v.type === 'voice') html = voiceView(S);
  else html = mainView(S);
  const slot = mainHost();
  if (!slot) return;
  slot.innerHTML = html;
  if (withMembers) {
    appEl().querySelector('.members')?.remove();
    slot.insertAdjacentHTML('beforeend', membersView(S));
  } else {
    appEl().querySelector('.members')?.remove();
  }
  lastRendered = { channelId: v.id, version: channelVersion(v.id) };
  applyMobileSide();
  afterMainRender();
}

function renderMessagesOnly() {
  const box = appEl().querySelector('.messages');
  if (!box) {
    renderMainFull();
    return;
  }
  const id = S.view.id;
  if (id === 'voice') return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prevScroll = box.scrollTop;
  box.innerHTML = messagesView(S, id, channelNameFor(id));
  lastRendered = { channelId: id, version: channelVersion(id) };
  if (nearBottom) box.scrollTop = box.scrollHeight;
  else box.scrollTop = prevScroll;
  hydrateAttachments();
  if (S.view.type === 'dm' || S.view.type === 'channel') {
    hydrateIcons(box);
  }
}

function renderTypingOnly() {
  const el = appEl().querySelector(`[data-typing="${S.view.id}"]`);
  if (el) el.innerHTML = typingView(S, S.view.id);
}

function renderVoiceOnly() {
  if (S.view.type !== 'voice') return;
  const slot = mainHost();
  if (!slot) return;
  const withMembers = S.membersOpen;
  const frame = appEl().querySelector('.frame');
  if (frame) frame.className = 'frame' + (withMembers ? ' with-members' : '');
  slot.innerHTML = voiceView(S) + (withMembers ? membersView(S) : '');
  afterMainRender();
}

function afterMainRender() {
  hydrateIcons(appEl());
  wireComposers();
  hydrateAttachments();
  const box = appEl().querySelector('.messages');
  if (box) box.scrollTop = box.scrollHeight;
  if (S.view.type === 'voice') restoreVoiceMedia();
  const selfVideo = appEl().querySelector('[data-self-video]');
  if (selfVideo && S.voice.cameraStream) selfVideo.srcObject = S.voice.cameraStream;
}

function channelNameFor(id) {
  for (const s of S.servers) {
    const c = s.channels.find((x) => x.id === id);
    if (c) return c.name;
  }
  const dm = S.dms.find((d) => d.channelId === id);
  return dm?.user?.displayName || 'канал';
}

function channelVersion(id) {
  const box = S.channels[id];
  return box ? box.messages.length + (box.dirty || 0) : 0;
}

/* --------------------------------------------------------------- events */

let boundGlobals = false;

function bindGlobal() {
  if (boundGlobals) return;
  boundGlobals = true;

  appEl().addEventListener('click', (ev) => {
    // клик по затемнению (::after) — закрываем мобильную панель
    if (S.mobileSide && ev.target === appEl().querySelector('.frame')) {
      S.mobileSide = false;
      applyMobileSide();
      return;
    }
    const target = ev.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const id = target.dataset.id;
    switch (act) {
      case 'home':
      case 'open-home':
        openHome();
        break;
      case 'server':
        openServer(id);
        break;
      case 'create-server':
        openCreateServer(app);
        break;
      case 'join-invite':
        openJoinInvite(app);
        break;
      case 'settings':
        openSettings(app);
        break;
      case 'server-menu':
        if (S.view.serverId) openServerSettings(app);
        break;
      case 'server-settings':
        openServerSettings(app);
        break;
      case 'open-channel':
      case 'open-voice':
      case 'open-text': {
        const serverId = target.dataset.server || S.view.serverId || null;
        const type = act === 'open-voice' ? 'voice' : 'channel';
        openChannel(type, id, serverId);
        break;
      }
      case 'open-dm':
        openChannel('dm', id, null, target.dataset.user);
        break;
      case 'find-user':
        openFindUser(app);
        break;
      case 'create-channel':
        createChannelDialog(target.dataset.kind || 'text');
        break;
      case 'copy-invite':
        navigator.clipboard.writeText(target.dataset.code || '').catch(() => {});
        toast('Код приглашения скопирован', 'ok', 1600);
        break;
      case 'share-invite':
        shareInvite();
        break;
      case 'toggle-mute':
        app.toggleMute();
        break;
      case 'toggle-deafen':
        app.toggleDeafen();
        break;
      case 'toggle-side':
        S.mobileSide = !S.mobileSide;
        applyMobileSide();
        break;
      case 'close-side':
        S.mobileSide = false;
        applyMobileSide();
        break;
      case 'toggle-members':
        S.membersOpen = !S.membersOpen;
        S.settings.membersOpen = S.membersOpen;
        store.set(KEYS.settings, S.settings);
        renderMainFull();
        break;
      case 'self-card':
        openUserCard(app, S.me.id);
        break;
      case 'user-card':
        openUserCard(app, id);
        break;
      case 'channel-menu':
        openChannelMenu(app, id);
        break;
      case 'send':
        submitMessage(id);
        break;
      case 'attach':
        pickFileFor(id);
        break;
      case 'emoji':
        openEmojiPicker(target, (e) => insertAtCursor(id, e));
        break;
      case 'copy-msg':
        copyMessage(id);
        break;
      case 'delete-msg':
        deleteMessage(id);
        break;
      case 'load-more':
        loadMessages(id, { older: true });
        break;
      case 'join-voice':
        joinVoice(S.view.id, { serverId: S.view.serverId });
        break;
      case 'hangup':
        leaveVoice();
        break;
      case 'toggle-camera':
        toggleCamera();
        break;
      case 'toggle-screen':
        toggleScreen();
        break;
      case 'dm-call':
        startDmCall(target.hasAttribute('data-video'));
        break;
      case 'lightbox':
        openLightbox(target.dataset.src);
        break;
      case 'change-server':
        changeServerDialog();
        break;
      default:
        break;
    }
  });

  appEl().addEventListener('keydown', (ev) => {
    const ta = ev.target.closest('[data-input]');
    if (!ta) return;
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      submitMessage(ta.dataset.input);
    }
  });

  appEl().addEventListener('input', (ev) => {
    const ta = ev.target.closest('[data-input]');
    if (!ta) return;
    autoGrow(ta);
    sendTyping(ta.dataset.input);
  });

  appEl().addEventListener('contextmenu', (ev) => {
    const item = ev.target.closest('[data-act="server"]');
    if (item) {
      ev.preventDefault();
      contextMenu(
        [
          { icon: 'settings', label: 'Настройки сервера', onClick: () => { S.view.serverId = item.dataset.id; openServerSettings(app); } },
          { icon: 'link', label: 'Скопировать приглашение', onClick: async () => { const server = S.servers.find((x) => x.id === item.dataset.id); await navigator.clipboard.writeText(server?.inviteCode || '').catch(() => {}); toast('Код скопирован', 'ok', 1500); } },
          { icon: 'logOut', label: 'Покинуть сервер', danger: true, onClick: async () => {
            if (!(await confirmDialog({ title: 'Покинуть сервер?', message: 'Вернуться можно будет по приглашению.' }))) return;
            try { await app.api.post(`/api/servers/${item.dataset.id}/leave`); } catch (err) { toast(err.message, 'err'); }
          } },
        ],
        ev.clientX,
        ev.clientY,
      );
    }
    const msg = ev.target.closest('[data-msg]');
    if (msg) {
      ev.preventDefault();
      const id = msg.dataset.msg;
      contextMenu(
        [
          { icon: 'copy', label: 'Скопировать текст', onClick: () => copyMessage(id) },
          { icon: 'trash', label: 'Удалить сообщение', danger: true, onClick: () => deleteMessage(id) },
        ],
        ev.clientX,
        ev.clientY,
      );
    }
  });

  document.addEventListener('keydown', (ev) => {
    const inField = /input|textarea|select/i.test(ev.target.tagName);
    if (ev.key === 'Escape') {
      document.querySelectorAll('.cmdk, .emoji-pop, .ctx-menu').forEach((e) => e.remove());
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      openPalette(app);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'm') {
      ev.preventDefault();
      app.toggleMute();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'd') {
      ev.preventDefault();
      app.toggleDeafen();
      return;
    }
    if (!inField && S.view.type !== 'voice') {
      const focus = () => document.querySelector(`[data-input="${S.view.id}"]`)?.focus();
      if (ev.key === 'Enter' || (ev.key.length === 1 && ev.key !== ' ' && !ev.ctrlKey && !ev.metaKey && !ev.altKey)) {
        if (ev.key !== 'Enter') focus();
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (S.voice.joined) leaveVoice({ silent: true });
  });
}

function wireComposers() {
  appEl().querySelectorAll('[data-input]').forEach((ta) => {
    autoGrow(ta);
    ta.addEventListener('paste', (ev) => {
      const items = [...(ev.clipboardData?.items || [])];
      const image = items.find((i) => i.type.startsWith('image/'));
      if (image) {
        ev.preventDefault();
        const file = image.getAsFile();
        if (file) uploadAndSend(file, ta.dataset.input);
      }
    });
    const inner = ta.closest('.composer-inner');
    if (inner) {
      inner.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        inner.classList.add('drag-over');
      });
      inner.addEventListener('dragleave', () => inner.classList.remove('drag-over'));
      inner.addEventListener('drop', (ev) => {
        ev.preventDefault();
        inner.classList.remove('drag-over');
        const file = ev.dataTransfer?.files?.[0];
        if (file) uploadAndSend(file, ta.dataset.input);
      });
    }
  });
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(220, ta.scrollHeight) + 'px';
}

function insertAtCursor(channelId, text) {
  const ta = document.querySelector(`[data-input="${channelId}"]`);
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  autoGrow(ta);
}

function openLightbox(src) {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.innerHTML = `<img src="${escapeAttr(src)}" alt="" />`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

/* --------------------------------------------------------------- auth ops */

app.logout = async function logout() {
  try {
    await apiMod.post('/api/logout');
  } catch { /* ignore */ }
  app.realtime?.close();
  if (S.voice.joined) leaveVoice({ silent: true });
  app.setToken(null);
  S.me = null;
  S.servers = [];
  S.dms = [];
  S.channels = {};
  S.keys = {};
  boundGlobals = false;
  appEl().innerHTML = '';
  renderAuth('login', '');
};

/* ---------------------------------------------------------------- server */

app.createServer = async function createServer(name, iconData) {
  const res = await apiMod.post('/api/servers', { name, icon: iconData || null });
  S.servers.push(res.server);
  renderSide();
  await openServer(res.server.id);
  toast('Сервер создан', 'ok');
};

app.updateServer = async function updateServer(serverId, patch) {
  const res = await apiMod.patch(`/api/servers/${serverId}`, patch);
  const idx = S.servers.findIndex((s) => s.id === serverId);
  if (idx >= 0) S.servers[idx] = res.server;
  paint('all');
};

app.joinInvite = async function joinInvite(code) {
  const res = await apiMod.post('/api/servers/join', { code });
  const exists = S.servers.find((s) => s.id === res.server.id);
  if (exists) Object.assign(exists, res.server);
  else S.servers.push(res.server);
  renderSide();
  await openServer(res.server.id);
  toast(`Вы на сервере «${res.server.name}»`, 'ok');
};

async function openHome() {
  S.view = { type: 'home', id: null, serverId: null };
  paint('all');
}

async function openServer(serverId) {
  const server = S.servers.find((s) => s.id === serverId);
  if (!server) return openHome();
  if (!S.members[server.id]) loadMembers(server.id);
  const last = store.get('raut.lastChannel.' + serverId);
  const target =
    server.channels.find((c) => c.id === last && c.type === 'text') ||
    server.channels.find((c) => c.type === 'text') ||
    server.channels[0];
  if (target) {
    await openChannel(target.type === 'voice' ? 'voice' : 'channel', target.id, serverId, null, { silent: true });
  } else {
    S.view = { type: 'home', id: null, serverId };
    paint('all');
  }
}

async function loadMembers(serverId) {
  try {
    const r = await apiMod.get(`/api/servers/${serverId}/members`);
    S.members[serverId] = r.members;
    for (const m of r.members) {
      S.memberIndex[m.id] = m;
      S.presence[m.id] = m.presence || S.presence[m.id];
    }
    paint('members');
  } catch { /* ignore */ }
}

async function createChannelDialog(kind) {
  const name = await promptDialog({
    title: kind === 'voice' ? 'Новый голосовой канал' : 'Новый текстовый канал',
    label: 'Название',
    placeholder: kind === 'voice' ? 'Переговорка' : 'новый-канал',
    confirmLabel: 'Создать',
  });
  if (!name) return;
  try {
    const serverId = S.view.serverId;
    const r = await apiMod.post(`/api/servers/${serverId}/channels`, { name, type: kind });
    const server = S.servers.find((s) => s.id === serverId);
    if (server && !server.channels.find((c) => c.id === r.channel.id)) server.channels.push(r.channel);
    paint('all');
    toast('Канал создан', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function shareInvite() {
  const server = S.servers.find((s) => s.id === S.view.serverId);
  if (!server) return;
  const text = `Входи в Raut — мой сервер «${server.name}». Код приглашения: ${server.inviteCode}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Raut', text });
      return;
    } catch { /* отменили */ }
  }
  await navigator.clipboard.writeText(text).catch(() => {});
  toast('Приглашение скопировано', 'ok');
}

/* --------------------------------------------------------------- channels */

async function openChannel(type, channelId, serverId = null, userId = null, opts = {}) {
  if (S.voice.joined && type !== 'voice') {
    // остаёмся в звонке, просто переключаем вид — голос живёт в своём канале
  }
  S.view = { type, id: channelId, serverId };
  S.viewUser = userId;
  S.mobileSide = false;
  applyMobileSide();
  if (serverId) store.set('raut.lastChannel.' + serverId, channelId);
  S.membersOpen = S.membersOpen && type !== 'dm';
  if (!serverId && type === 'channel') {
    // канал принадлежит серверу — восстановим его по каналу
    const owner = S.servers.find((srv) => srv.channels.some((c) => c.id === channelId));
    if (owner) S.view.serverId = owner.id;
  }
  paint('all');
  if (type === 'channel' || type === 'dm') {
    await loadMessages(channelId, { initial: true });
    markRead(channelId);
    app.realtime?.send({ t: 'join', channelId });
    if (!opts.silent) requestAnimationFrame(() => document.querySelector(`[data-input="${channelId}"]`)?.focus());
  } else if (type === 'voice') {
    if (!S.voiceMembers[channelId]) S.voiceMembers[channelId] = new Set();
  }
}

async function loadMessages(channelId, { initial = false, older = false } = {}) {
  const box = (S.channels[channelId] ||= { messages: [], loaded: false, hasMore: false, authors: {} });
  if (box.loading) return;
  box.loading = true;
  try {
    let qs = '?limit=50';
    if (older && box.messages.length) {
      const first = box.messages[0];
      if (first?.id) qs += `&before=${encodeURIComponent(first.id)}`;
    }
    const r = await apiMod.get(`/api/channels/${channelId}/messages${qs}`);
    box.authors = { ...box.authors, ...r.authors };
    Object.assign(S.authors, r.authors);
    const key = await ensureChannelKey(channelId).catch(() => null);
    const decoded = [];
    for (const m of r.messages) {
      decoded.push(await decodeMessage(m, channelId, key));
    }
    if (older) {
      box.messages = [...dedup([...decoded, ...box.messages])];
    } else {
      box.messages = dedup(decoded);
    }
    box.loaded = true;
    box.hasMore = !!r.hasMore;
    box.dirty = (box.dirty || 0) + 1;
    if (S.view.id === channelId) paint('messages');
    else refreshUnreadTitle();
  } catch (err) {
    box.loaded = true;
    box.dirty = (box.dirty || 0) + 1;
    if (err.status === 403) toast('Нет доступа к каналу', 'err');
    else if (S.view.id === channelId) toast(err.message, 'err');
  } finally {
    box.loading = false;
  }
}

function dedup(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function decodeMessage(m, channelId, key) {
  if (m.kind === 'system') return { ...m, _text: m.system };
  if (m._decoded) return m;
  const k = key || S.keys[channelId];
  if (!k) return { ...m, _locked: true };
  try {
    const text = await decryptText(k, channelId, m.payload);
    const out = { ...m, _text: text, _decoded: true };
    if (m.attachment) {
      out._attach = {
        status: 'loading',
        name: m.attachment.name,
        size: m.attachment.size,
        type: attachmentType(m.attachment.mime || guessMime(m.attachment.name)),
        id: m.attachment.id,
        iv: m.attachment.iv,
        url: null,
      };
    }
    return out;
  } catch {
    return { ...m, _locked: true };
  }
}

function guessMime(name = '') {
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
      pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain',
    }[ext] || 'application/octet-stream'
  );
}

function attachmentType(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/* ------------------------------------------------------------ attachments */

const attachCache = new Map(); // attachmentId -> object URL

async function hydrateAttachments() {
  const box = S.channels[S.view.id];
  if (!box) return;
  const pending = box.messages.filter((m) => m._attach && m._attach.status === 'loading' && !m._attach.busy);
  for (const m of pending) {
    m._attach.busy = true;
    loadAttachment(m, S.view.id).catch(() => {
      m._attach.status = 'error';
      paint('messages');
    });
  }
}

async function loadAttachment(m, channelId) {
  const a = m._attach;
  if (attachCache.has(a.id)) {
    a.url = attachCache.get(a.id);
    a.status = 'ready';
    paint('messages');
    return;
  }
  const token = apiMod.store.get(KEYS.token);
  const res = await fetch(apiMod.httpBase() + `/api/attachments/${a.id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('download failed');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const key = await ensureChannelKey(channelId);
  if (!key) throw new Error('no key');
  const plain = await decryptBytes(key, channelId, { i: a.iv, c: bytesToB64(bytes) });
  const url = URL.createObjectURL(new Blob([plain], { type: guessMime(a.name) }));
  attachCache.set(a.id, url);
  a.url = url;
  a.status = 'ready';
  paint('messages');
}

function pickFileFor(channelId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) uploadAndSend(file, channelId);
  };
  input.click();
}

async function uploadAndSend(file, channelId) {
  if (file.size > 32 * 1024 * 1024) {
    toast('Файл больше 32 МБ', 'err');
    return;
  }
  const ta = document.querySelector(`[data-input="${channelId}"]`);
  const text = ta?.value.trim() || '';
  if (ta) {
    ta.value = '';
    autoGrow(ta);
  }
  const key = await ensureChannelKey(channelId).catch(() => null);
  if (!key) return toast('Нет ключа канала', 'err');

  const tray = ensureTray(channelId);
  tray.insertAdjacentHTML('beforeend', trayChipHTML(file.name, 'Шифруем…'));

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const enc = await encryptBytes(key, channelId, bytes);
    tray.querySelector('.attach-chip:last-child .status').textContent = 'Загружаем…';
    const up = await apiMod.post('/api/upload', {
      data: enc.c,
      name: file.name,
      mime: file.type || guessMime(file.name),
      iv: enc.i,
    });
    tray.querySelector('.attach-chip:last-child .status').textContent = 'Отправляем…';
    const payload = await encryptText(key, channelId, text);
    const body = {
      payload,
      kind: 'file',
      attachment: { id: up.id, name: file.name, channelId },
    };
    // кэш заполняем ДО вставки сообщения: иначе первый же рендер успевает
    // сходить за файлом на сервер и показать «Файл недоступен»
    const url = URL.createObjectURL(new Blob([bytes], { type: file.type || guessMime(file.name) }));
    attachCache.set(up.id, url);
    const res = await apiMod.post(`/api/channels/${channelId}/messages`, body);
    await insertOwnMessage(res.message, channelId);
  } catch (err) {
    toast('Не удалось отправить файл: ' + err.message, 'err');
  } finally {
    tray.querySelector('.attach-chip:last-child')?.remove();
  }
}

function ensureTray(channelId) {
  const composer = document.querySelector(`[data-composer="${channelId}"]`);
  if (!composer) return document.body;
  let tray = composer.parentElement.querySelector('.attach-tray');
  if (!tray) {
    tray = document.createElement('div');
    tray.className = 'attach-tray';
    composer.parentElement.insertBefore(tray, composer);
  }
  return tray;
}

function trayChipHTML(name, status) {
  return `<div class="attach-chip">${icon('file', 'sm')}<span>${escapeHtml(name)}</span><span class="status small muted">${escapeHtml(status)}</span></div>`;
}

/* ------------------------------------------------------------- messages */

async function insertOwnMessage(message, channelId) {
  const box = S.channels[channelId];
  if (!box) return;
  if (box.messages.some((m) => m.id === message.id)) return;
  const key = S.keys[channelId];
  const decoded = key ? await decodeMessage(message, channelId, key) : { ...message, _locked: true };
  box.messages.push(decoded);
  box.messages = dedup(box.messages);
  box.dirty = (box.dirty || 0) + 1;
  if (S.view.id === channelId) paint('messages');
}

async function submitMessage(channelId) {
  const ta = document.querySelector(`[data-input="${channelId}"]`);
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) return;
  const key = await ensureChannelKey(channelId).catch(() => null);
  if (!key) return toast('Нет ключа канала — сообщение не зашифровать', 'err');
  ta.value = '';
  autoGrow(ta);
  try {
    const payload = await encryptText(key, channelId, text);
    const res = await apiMod.post(`/api/channels/${channelId}/messages`, { payload });
    await insertOwnMessage(res.message, channelId);
    markRead(channelId);
  } catch (err) {
    ta.value = text;
    autoGrow(ta);
    toast(err.message, 'err');
  }
}

async function deleteMessage(messageId) {
  const channelId = S.view.id;
  const box = S.channels[channelId];
  const m = box?.messages.find((x) => x.id === messageId);
  if (!m) return;
  if (m.authorId !== S.me.id) {
    const server = S.servers.find((s) => s.id === S.view.serverId);
    if (server?.ownerId !== S.me.id) return toast('Можно удалять только свои сообщения', 'err');
  }
  try {
    await apiMod.del(`/api/channels/${channelId}/messages/${messageId}`).catch(() => apiMod.api('DELETE', `/api/channels/${channelId}/messages`, { messageId }));
    box.messages = box.messages.filter((x) => x.id !== messageId);
    box.dirty = (box.dirty || 0) + 1;
    paint('messages');
  } catch (err) {
    toast(err.message, 'err');
  }
}

function copyMessage(messageId) {
  const box = S.channels[S.view.id];
  const m = box?.messages.find((x) => x.id === messageId);
  if (!m) return;
  navigator.clipboard.writeText(m._text || '').then(() => toast('Скопировано', 'ok', 1400)).catch(() => {});
}

const sendTyping = throttle((channelId) => {
  if (!channelId) return;
  app.realtime?.send({ t: 'typing', channelId });
}, 2500);

function markRead(channelId) {
  const box = S.channels[channelId];
  const last = box?.messages?.[box.messages.length - 1];
  if (!last) return;
  S.unread[channelId] = 0;
  app.realtime?.send({ t: 'read', channelId, messageId: last.id });
  syncUnreadInModels();
  updateTitle();
}

function syncUnreadInModels() {
  for (const s of S.servers) for (const c of s.channels) c.unread = S.unread[c.id] || 0;
  for (const d of S.dms) d.unread = S.unread[d.channelId] || 0;
}

function updateTitle() {
  const total = Object.values(S.unread).reduce((a, b) => a + (b || 0), 0);
  document.title = total ? `(${total}) Raut` : 'Raut';
  S.desktop?.setTrayState?.({ unread: total, connection: S.connection });
}

function refreshUnreadTitle() {
  updateTitle();
}

/* -------------------------------------------------------------- keys/E2E */

function channelMeta(channelId) {
  for (const s of S.servers) {
    const c = s.channels.find((x) => x.id === channelId);
    if (c) {
      const server = S.servers.find((x) => x.id === c.serverId);
      return { kind: 'channel', channel: c, server };
    }
  }
  const dm = S.dms.find((d) => d.channelId === channelId);
  if (dm) return { kind: 'dm', dm };
  return null;
}

async function ensureChannelKey(channelId, depth = 0) {
  if (S.keys[channelId]) return S.keys[channelId];
  const meta = channelMeta(channelId);
  if (!meta) return null;

  if (meta.kind === 'dm') {
    const partner = meta.dm.user;
    if (!partner?.publicKey) return null;
    const key = await deriveDMKey(S.identity, partner.publicKey, [S.me.id, partner.id]);
    S.keys[channelId] = key;
    return key;
  }

  if (S.keyErrors[channelId]) return null;
  const channel = meta.channel;
  const server = meta.server;
  const isOwner = server?.role === 'owner' || server?.ownerId === S.me.id;

  try {
    const r = await apiMod.get(`/api/channels/${channelId}/keys`);
    if (r.myEnvelope) {
      const key = await unwrapKey(S.identity.priv, S.identity.pub, r.myEnvelope);
      S.keys[channelId] = key;
      delete S.keyErrors[channelId];
      await decryptCached(channelId);
      return key;
    }
    if (isOwner && !r.adminPub) {
      const key = await createChannelKey(channelId);
      if (key) return key;
    }
    if (isOwner) {
      // кто-то другой владеет ключом, но у нас его нет — пересоздаём, если в канале никого с ключом
      const hasOthers = r.memberIds?.some((id) => id !== S.me.id) && Object.keys(r.keys || {}).length;
      if (!r.adminPub) {
        const key = await createChannelKey(channelId);
        if (key) return key;
      }
    }
    // просим владельца выдать ключ
    app.realtime?.send({ t: 'keys:request', channelId });
    S.keyErrors[channelId] = 'pending';
    setTimeout(() => {
      delete S.keyErrors[channelId];
      if (!S.keys[channelId]) {
        paint('all');
        ensureChannelKey(channelId).then((k) => {
          if (k) {
            decryptCached(channelId).then(() => paint('all'));
          }
        }).catch(() => {});
      }
    }, 2500);
    if (depth < 1) return null;
    return null;
  } catch (err) {
    console.warn('[keys]', err.message);
    return null;
  }
}

async function createChannelKey(channelId) {
  const meta = channelMeta(channelId);
  if (!meta?.server) return null;
  const keysInfo = await apiMod.get(`/api/channels/${channelId}/keys`);
  const memberIds = keysInfo.memberIds || [];
  const key = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = {};
  for (const id of memberIds) {
    if (id === S.me.id) {
      wrapped[id] = await wrapKeyFor(S.identity.pub, key);
      continue;
    }
    const user = S.memberIndex[id] || (await apiMod.get(`/api/users/${id}`).catch(() => null))?.user;
    if (!user?.publicKey) continue;
    wrapped[id] = await wrapKeyFor(user.publicKey, key);
  }
  await apiMod.put(`/api/channels/${channelId}/keys`, { adminPub: S.identity.pub, keys: wrapped });
  S.keys[channelId] = key;
  delete S.keyErrors[channelId];
  await decryptCached(channelId);
  return key;
}

/** Владелец: досыпает ключ новому участнику (по событию keys:sync). */
async function grantKeyTo(channelId, userId) {
  const key = S.keys[channelId];
  if (!key) return;
  const user = S.memberIndex[userId] || (await apiMod.get(`/api/users/${userId}`).catch(() => null))?.user;
  if (!user?.publicKey) return;
  const envelope = await wrapKeyFor(user.publicKey, key);
  await apiMod.put(`/api/channels/${channelId}/keys`, { keys: { [userId]: envelope } }).catch(() => {});
}

async function decryptCached(channelId) {
  const box = S.channels[channelId];
  const key = S.keys[channelId];
  if (!box || !key) return;
  box.messages = await Promise.all(box.messages.map((m) => decodeMessage(m, channelId, key)));
  box.dirty = (box.dirty || 0) + 1;
  if (S.view.id === channelId) paint('messages');
}

async function hydrateAllServerKeys() {
  for (const server of S.servers) {
    const isOwner = server.role === 'owner';
    for (const c of server.channels) {
      if (c.type !== 'text') continue;
      try {
        const r = await apiMod.get(`/api/channels/${c.id}/keys`);
        if (r.myEnvelope) {
          S.keys[c.id] = await unwrapKey(S.identity.priv, S.identity.pub, r.myEnvelope);
        } else if (isOwner) {
          await createChannelKey(c.id);
        }
      } catch { /* ignore */ }
    }
  }
  if (S.view.id) decryptCached(S.view.id).then(() => paint('all'));
}

/* -------------------------------------------------------------- realtime */

async function handleWsEvent(msg) {
  switch (msg.t) {
    case 'ready': {
      S.connection = 'ready';
      if (msg.you) S.me = { ...S.me, ...msg.you };
      for (const p of msg.presence || []) S.presence[p.userId] = { status: p.status, lastSeen: p.lastSeen };
      paint('side');
      break;
    }
    case 'session:expired':
      toast('Сессия истекла — войдите снова', 'err');
      app.logout();
      break;
    case 'presence':
      S.presence[msg.userId] = { status: msg.status, lastSeen: msg.lastSeen };
      if (msg.userId === S.me.id) S.me.status = msg.status;
      paint('status');
      if (S.membersOpen) renderMainFull();
      break;
    case 'user:update':
      Object.assign(S.authors, { [msg.user.id]: msg.user });
      if (msg.user.id === S.me.id) S.me = { ...S.me, ...msg.user };
      paint('all');
      break;
    case 'msg': {
      const box = (S.channels[msg.channelId] ||= { messages: [], loaded: false, hasMore: false, authors: {} });
      if (box.messages.some((m) => m.id === msg.message.id)) break;
      const key = S.keys[msg.channelId] || null;
      let decoded;
      if (msg.message.kind === 'system') decoded = await decodeMessage(msg.message, msg.channelId, key);
      else if (key) decoded = await decodeMessage(msg.message, msg.channelId, key);
      else {
        // возможно, ключ можно получить прямо сейчас
        const k = await ensureChannelKey(msg.channelId).catch(() => null);
        decoded = k ? await decodeMessage(msg.message, msg.channelId, k) : { ...msg.message, _locked: true };
      }
      box.messages.push(decoded);
      box.messages = dedup(box.messages);
      box.dirty = (box.dirty || 0) + 1;
      if (msg.message.authorId !== S.me.id) {
        S.unread[msg.channelId] = (S.unread[msg.channelId] || 0) + 1;
        syncUnreadInModels();
        if (S.view.id === msg.channelId && document.hasFocus()) {
          markRead(msg.channelId);
        } else {
          notifyMessage(decoded, msg.channelId);
          paint('side');
          updateTitle();
        }
      }
      if (S.view.id === msg.channelId) {
        paint('messages');
        if (document.hasFocus()) markRead(msg.channelId);
      }
      break;
    }
    case 'msg:delete': {
      const box = S.channels[msg.channelId];
      if (box) {
        box.messages = box.messages.map((m) => (m.id === msg.messageId ? { ...m, _gone: false } : m)).filter((m) => m.id !== msg.messageId);
        box.dirty = (box.dirty || 0) + 1;
        if (S.view.id === msg.channelId) paint('messages');
      }
      break;
    }
    case 'channel:cleared': {
      const box = S.channels[msg.channelId];
      if (box) {
        box.messages = [];
        box.dirty = (box.dirty || 0) + 1;
        if (S.view.id === msg.channelId) paint('messages');
      }
      break;
    }
    case 'typing': {
      if (msg.userId === S.me.id) break;
      const map = (S.typing[msg.channelId] ||= new Map());
      map.set(msg.userId, { displayName: msg.displayName, until: msg.until });
      if (S.view.id === msg.channelId) paint('typing');
      clearTimeout(map._t);
      map._t = setTimeout(() => {
        map.delete(msg.userId);
        if (S.view.id === msg.channelId) paint('typing');
      }, Math.max(600, (msg.until || Date.now()) - Date.now() + 400));
      break;
    }
    case 'channel:created':
      applyChannelChange(msg);
      break;
    case 'channel:update':
      applyChannelChange(msg);
      break;
    case 'channel:deleted': {
      const server = S.servers.find((s) => s.id === msg.serverId);
      if (server) server.channels = server.channels.filter((c) => c.id !== msg.channelId);
      if (S.view.id === msg.channelId) openServer(msg.serverId);
      paint('all');
      break;
    }
    case 'channel:activity': {
      const server = S.servers.find((s) => s.channels.some((c) => c.id === msg.channelId));
      const ch = server?.channels.find((c) => c.id === msg.channelId);
      if (ch) ch.lastMessageAt = msg.lastMessageAt;
      paint('side');
      break;
    }
    case 'dm:activity': {
      const dm = S.dms.find((d) => d.channelId === msg.channelId);
      if (dm) dm.lastMessageAt = msg.lastMessageAt;
      paint('side');
      break;
    }
    case 'dm:created': {
      if (!S.dms.find((d) => d.channelId === msg.dm.channelId)) S.dms.push(msg.dm);
      if (msg.user) S.authors[msg.user.id] = msg.user;
      paint('side');
      break;
    }
    case 'server:update': {
      const idx = S.servers.findIndex((s) => s.id === msg.server.id);
      if (idx >= 0) S.servers[idx] = msg.server;
      else S.servers.push(msg.server);
      syncUnreadInModels();
      paint('all');
      break;
    }
    case 'server:deleted': {
      S.servers = S.servers.filter((s) => s.id !== msg.serverId);
      if (S.view.serverId === msg.serverId) openHome();
      paint('all');
      break;
    }
    case 'server:member-join': {
      Object.assign(S.authors, { [msg.user.id]: msg.user });
      if (msg.serverId) loadMembers(msg.serverId);
      break;
    }
    case 'keys:update':
      if (!S.keys[msg.channelId]) {
        try {
          const r = await apiMod.get(`/api/channels/${msg.channelId}/keys`);
          if (r.myEnvelope) {
            S.keys[msg.channelId] = await unwrapKey(S.identity.priv, S.identity.pub, r.myEnvelope);
            delete S.keyErrors[msg.channelId];
            await decryptCached(msg.channelId);
            if (S.view.id === msg.channelId) paint('all');
          }
        } catch { /* ignore */ }
      }
      break;
    case 'keys:sync':
      if (S.keys[msg.channelId]) grantKeyTo(msg.channelId, msg.userId);
      else ensureChannelKey(msg.channelId).then((k) => k && grantKeyTo(msg.channelId, msg.userId));
      break;
    case 'rtc:joined':
      S.voice.selfConnId = msg.selfConnId || null;
      app.mesh?.setSelf(msg.selfConnId || null);
      break;
    case 'rtc:peers': {
      if (msg.channelId !== S.voice.channelId) break;
      updateVoicePeers(msg.peers || []);
      break;
    }
    case 'rtc:peer-join': {
      if (msg.channelId !== S.voice.channelId) {
        // обновим счётчики в сайдбаре
        const p = msg.peer;
        const set = (S.voiceMembers[msg.channelId] ||= new Set());
        set.add(p.connId);
        paint('side');
        break;
      }
      updateVoicePeers([...(S.voice.peers.values()), msg.peer]);
      break;
    }
    case 'rtc:peer-leave': {
      const set = S.voiceMembers[msg.channelId];
      if (set) set.delete(msg.connId);
      if (msg.channelId === S.voice.channelId) {
        S.voice.peers.delete(msg.connId);
        S.voice.participants.delete(msg.connId);
        app.mesh?.removePeer(msg.connId);
        cleanupPeerMedia(msg.connId);
        paint('voice');
      } else paint('side');
      break;
    }
    case 'voice:state': {
      if (msg.left) {
        S.voiceMembers[msg.channelId]?.delete(msg.connId);
        break;
      }
      const entry = { ...(S.voiceMembers[msg.channelId]?.get?.(msg.connId) || {}), ...msg };
      const set = (S.voiceMembers[msg.channelId] ||= new Set());
      set.add(msg.connId);
      S.voiceMembers[msg.channelId].meta ||= new Map();
      S.voiceMembers[msg.channelId].meta.set(msg.connId, entry);
      if (msg.channelId === S.voice.channelId) {
        const p = S.voice.participants.get(msg.connId);
        if (p) {
          p.voice = { mute: !!msg.mute, deaf: !!msg.deaf, video: !!msg.video, screen: !!msg.screen, speaking: !!msg.speaking };
          updateVoiceTile(msg.connId);
        }
      }
      paint('side');
      break;
    }
    case 'rtc:signal':
      if (msg.channelId === S.voice.channelId && app.mesh) app.mesh.handleSignal(msg.from, msg.data);
      break;
    case 'rtc:decline':
      if (msg.userId) toast(`${msg.displayName || 'Собеседник'} отклонил звонок`, 'err', 4000);
      S.dmCalls.ringing = null;
      break;
    case 'rtc:invite':
      if (S.voice.joined && S.voice.channelId === msg.channelId) break;
      S.dmCalls.incoming = msg;
      if (S.settings.sound) audio.playRing().catch(() => {});
      openIncomingCall(app, { ...msg, video: msg.video });
      break;
    default:
      break;
  }
}

function applyChannelChange(msg) {
  const server = S.servers.find((s) => s.id === msg.serverId);
  if (!server) return;
  const idx = server.channels.findIndex((c) => c.id === msg.channel.id);
  if (idx >= 0) server.channels[idx] = msg.channel;
  else server.channels.push(msg.channel);
  paint('all');
}

function notifyMessage(m, channelId) {
  if (S.settings.badge) updateTitle();
  if (document.hasFocus()) return;
  if (S.desktop?.notify) {
    S.desktop.notify({ title: channelNameFor(channelId), body: `${S.authors[m.authorId]?.displayName || ''}: ${(m._text || '').slice(0, 120)}`.trim() }).catch(() => {});
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const box = S.channels[channelId];
  const author = box?.authors?.[m.authorId] || S.authors[m.authorId];
  const title = S.view.id === channelId ? 'Raut' : channelNameFor(channelId);
  const body = `${author?.displayName || 'Кто-то'}: ${(m._text || '').slice(0, 120) || 'вложение'}`;
  try {
    const n = new Notification(title, { body, icon: '/icon.svg', tag: channelId });
    n.onclick = () => {
      window.focus();
      openChannel(channelMeta(channelId)?.kind === 'dm' ? 'dm' : 'channel', channelId);
      n.close();
    };
  } catch { /* ignore */ }
}

/* ----------------------------------------------------------------- voice */

app.restartMicIfActive = debounce(async () => {
  if (!S.voice.joined) return;
  try {
    audio.settings = { ...audio.settings, ...S.settings };
    const { stream } = await audio.startMic(S.settings);
    applyMicStream(stream);
  } catch (err) {
    toast('Микрофон: ' + err.message, 'err');
  }
}, 400);

async function ensureMic() {
  if (audio.micStream) return audio.micStream;
  audio.settings = { ...audio.settings, ...S.settings };
  const { stream } = await audio.startMic(S.settings);
  return stream;
}

function sendVoiceState() {
  if (!S.voice.joined) return;
  app.realtime?.send({
    t: 'voice:state',
    channelId: S.voice.channelId,
    mute: S.voice.muted,
    deaf: S.voice.deafened,
    video: S.voice.cameraOn,
    screen: S.voice.screenOn,
    speaking: S.voice.speaking,
  });
}
const sendVoiceStateThrottled = throttle(sendVoiceState, 350);

async function joinVoice(channelId, { serverId = null, dm = false } = {}) {
  if (S.voice.joined) await leaveVoice({ silent: true });
  S.voice = freshVoice();
  S.voice.channelId = channelId;
  S.voice.channelName = channelNameFor(channelId);
  S.voice.dm = dm;
  S.voice.startedAt = Date.now();
  S.voice.joining = true;
  S.view = { type: 'voice', id: channelId, serverId };
  paint('all');
  try {
    // Без микрофона звонок всё равно возможен: слушаем, а говорить не сможем.
    let stream = null;
    let micError = null;
    try {
      stream = await ensureMic();
    } catch (err) {
      micError = err;
      S.voice.micUnavailable = true;
      S.voice.muted = true;
    }
    S.voice.localStream = stream;
    S.voice.joined = true;
    S.voice.joining = false;
    if (!micError) setMicEnabled(true);
    if (!app.mesh) {
      app.mesh = new Mesh({
        selfConnId: S.voice.selfConnId,
        sendSignal: (to, data) => app.realtime?.send({ t: 'rtc:signal', channelId: S.voice.channelId, to, data }),
        onPeer: (connId, info) => {
          S.voice.peers.set(connId, info);
        },
        onState: (connId, state) => {
          const p = S.voice.participants.get(connId);
          if (p) {
            p.state = state;
            updateVoiceTile(connId);
          }
        },
        onTrack: (connId, streamIn, track) => {
          handleRemoteTrack(connId, streamIn, track);
        },
      });
    }
    app.mesh.channelId = channelId;
    app.mesh.setLocalStream(stream);
    app.mesh.setSelf(S.voice.selfConnId || null);
    app.realtime?.send({ t: 'rtc:join', channelId });
    paint('all');
    if (micError) {
      const notFound = /NotFoundError|Requested device not found/i.test(micError.message + ' ' + (micError.name || ''));
      const reason = notFound
        ? 'Микрофон не найден — вы подключились в режиме слушателя. Подключите микрофон и нажмите кнопку ещё раз.'
        : 'Нет доступа к микрофону — вы в режиме слушателя. Разрешите микрофон в параметрах системы.';
      toast(reason, 'warn', 5500);
    }
    if (dm) {
      app.realtime?.send({ t: 'rtc:joined-dm', channelId });
    }
    if (S.settings.monitor) setMonitor(true);
  } catch (err) {
    S.voice.joined = false;
    S.voice.joining = false;
    paint('all');
    toast('Не удалось подключиться к каналу: ' + err.message, 'err', 6000);
  }
}

async function leaveVoice({ silent = false } = {}) {
  const channelId = S.voice.channelId;
  if (!channelId) return;
  app.realtime?.send({ t: 'rtc:leave', channelId });
  app.mesh?.close();
  app.mesh = null;
  for (const [, el] of S.voice.media) {
    if (el) {
      el.srcObject = null;
      el.remove();
    }
  }
  S.voice.cameraStream?.getTracks().forEach((t) => t.stop());
  S.voice.screenStream?.getTracks().forEach((t) => t.stop());
  S.voice = freshVoice();
  setMonitor(false);
  audio.stopMic();
  if (!silent) {
    if (S.view.type === 'voice') {
      const meta = channelMeta(channelId);
      if (meta?.kind === 'dm') openChannel('dm', channelId);
      else if (meta?.server) openChannel('channel', (meta.server.channels.find((c) => c.type === 'text') || {}).id, meta.server.id);
      else openHome();
    } else {
      paint('all');
    }
  }
}

function setMicEnabled(enabled) {
  const track = S.voice.localStream?.getAudioTracks()[0] || audio.micStream?.getAudioTracks()[0];
  if (track) track.enabled = enabled && !S.voice.deafened;
  S.voice.micAvailable = !!track;
}

app.toggleMute = async function toggleMute() {
  if (S.voice.joined && S.voice.micUnavailable) {
    // попробуем поднять микрофон на лету (например, его только что подключили)
    try {
      const stream = await ensureMic();
      applyMicStream(stream);
      S.voice.micUnavailable = false;
      S.voice.muted = false;
      setMicEnabled(true);
      sendVoiceState();
      paint('all');
      toast('Микрофон подключён', 'ok');
    } catch {
      toast('Микрофон не найден. Подключите его и нажмите кнопку ещё раз.', 'warn', 5000);
    }
    return;
  }
  if (!S.voice.joined) {
    toast('Сначала подключитесь к голосовому каналу', 'err', 2200);
    return;
  }
  S.voice.muted = !S.voice.muted;
  setMicEnabled(!S.voice.muted);
  sendVoiceState();
  paint(S.view.type === 'voice' ? 'all' : 'side');
};

app.toggleDeafen = function toggleDeafen() {
  if (!S.voice.joined) {
    toast('Сначала подключитесь к голосовому каналу', 'err', 2200);
    return;
  }
  S.voice.deafened = !S.voice.deafened;
  for (const [, el] of S.voice.media) el.muted = S.voice.deafened;
  if (S.voice.deafened) {
    S.voice.muted = true;
    setMicEnabled(false);
  } else {
    setMicEnabled(!S.voice.muted);
  }
  sendVoiceState();
  paint(S.view.type === 'voice' ? 'all' : 'side');
};

app.applyOutputVolume = function applyOutputVolume() {
  for (const [, el] of S.voice.media) el.volume = Math.min(1, S.settings.outputVolume ?? 1);
};

function setMonitor(on) {
  if (!on) {
    audio.nodes.monitor?.disconnect();
    audio.nodes.monitor = null;
    return;
  }
  try {
    audio.ensureContext().then((ctx) => {
      if (!audio.nodes.gain) return;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      audio.nodes.gain.connect(g);
      g.connect(ctx.destination);
      audio.nodes.monitor = g;
    });
  } catch { /* ignore */ }
}

async function toggleCamera() {
  if (!S.voice.joined) return;
  if (S.voice.cameraOn) {
    S.voice.cameraStream?.getTracks().forEach((t) => t.stop());
    S.voice.cameraStream = null;
    await app.mesh?.setCamera(null);
    S.voice.cameraOn = false;
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      S.voice.cameraStream = stream;
      await app.mesh?.setCamera(stream);
      S.voice.cameraOn = true;
    } catch (err) {
      toast('Камера недоступна: ' + err.message, 'err');
      return;
    }
  }
  sendVoiceState();
  paint('voice');
}

async function toggleScreen() {
  if (!S.voice.joined) return;
  if (S.voice.screenOn) {
    S.voice.screenStream?.getTracks().forEach((t) => t.stop());
    S.voice.screenStream = null;
    await app.mesh?.setScreen(null);
    S.voice.screenOn = false;
  } else {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { max: 1920 } },
        audio: false,
      });
      S.voice.screenStream = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        S.voice.screenOn = false;
        app.mesh?.setScreen(null);
        sendVoiceState();
        paint('voice');
      });
      await app.mesh?.setScreen(stream);
      S.voice.screenOn = true;
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast('Не удалось показать экран: ' + err.message, 'err');
      return;
    }
  }
  sendVoiceState();
  paint('voice');
}

function updateVoicePeers(peers) {
  const list = [];
  const seen = new Set();
  for (const p of peers) {
    if (!p || !p.connId) continue;
    if (seen.has(p.connId)) continue;
    seen.add(p.connId);
    S.voice.peers.set(p.connId, p);
    const existing = S.voice.participants.get(p.connId) || {};
    S.voice.participants.set(p.connId, { ...existing, ...p });
    list.push({ ...existing, ...p });
  }
  const set = (S.voiceMembers[S.voice.channelId] ||= new Set());
  for (const p of list) set.add(p.connId);
  if (app.mesh) app.mesh.sync(list);
  paint('voice');
}

function handleRemoteTrack(connId, stream, track) {
  const p = S.voice.participants.get(connId) || { connId };
  if (track.kind === 'audio') {
    let el = S.voice.media.get(connId + ':audio');
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.playsInline = true;
      el.dataset.rautPeer = connId;
      document.body.appendChild(el);
      S.voice.media.set(connId + ':audio', el);
      audio.attachRemoteAnalyser(stream, (speaking) => {
        const pp = S.voice.participants.get(connId);
        if (!pp) return;
        pp.voice = { ...(pp.voice || {}), speaking };
        updateVoiceTile(connId);
        sendVoiceStateThrottled();
      });
    }
    el.srcObject = stream;
    el.volume = Math.min(1, S.settings.outputVolume ?? 1);
    el.muted = S.voice.deafened;
    el.play().catch(() => {});
  } else if (track.kind === 'video') {
    p.videoStream = stream;
    S.voice.participants.set(connId, p);
    const video = document.querySelector(`[data-peer-video="${connId}"]`);
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
      video.closest('.video-tile')?.classList.remove('empty');
    }
    updateVoiceTile(connId);
  }
}

function applyMicStream(stream) {
  S.voice.localStream = stream;
  app.mesh?.setLocalStream(stream);
  setMicEnabled(!S.voice.muted);
}

function cleanupPeerMedia(connId) {
  for (const key of [`${connId}:audio`]) {
    const el = S.voice.media.get(key);
    if (el) {
      el.srcObject = null;
      el.remove();
      S.voice.media.delete(key);
    }
  }
}

function restoreVoiceMedia() {
  // после перерисовки заново привязываем видеопотоки
  for (const [connId, p] of S.voice.participants) {
    if (!p.videoStream) continue;
    const video = document.querySelector(`[data-peer-video="${connId}"]`);
    if (video) {
      video.srcObject = p.videoStream;
      video.play().catch(() => {});
      video.closest('.video-tile')?.classList.remove('empty');
    }
  }
  const self = appEl().querySelector('[data-self-video]');
  if (self) {
    const stream = S.voice.screenStream || S.voice.cameraStream;
    if (stream) {
      self.srcObject = stream;
      self.play().catch(() => {});
      self.closest('.video-tile')?.classList.remove('empty');
    }
  }
}

function updateVoiceTile(connId) {
  const p = S.voice.participants.get(connId);
  if (!p) return;
  const tile = document.querySelector(`.video-tile[data-peer="${connId}"]`);
  if (!tile) return;
  tile.classList.toggle('speaking', !!p.voice?.speaking);
  const nameEl = tile.querySelector('.vt-name');
  if (nameEl) {
    nameEl.innerHTML = `${escapeHtml(p.displayName || S.authors[p.userId]?.displayName || '?')}
      ${p.voice?.mute ? `<span class="vt-mute">${icon('micOff', 'sm')}</span>` : ''}
      ${p.voice?.screen ? '<span class="pill-tag">экран</span>' : ''}
      ${p.state && p.state !== 'connected' ? `<span class="pill-tag dim">${{ connecting: 'соединяемся', failed: 'нет связи', disconnected: 'обрыв', closed: 'вышел' }[p.state] || p.state}</span>` : ''}`;
  }
  const av = tile.querySelector('.avatar');
  if (av) av.classList.toggle('speaking', !!p.voice?.speaking);
}

/* -------------------------------------------------------------- dm calls */

app.startDm = async function startDm(userId) {
  try {
    const r = await apiMod.post(`/api/dm/${userId}`);
    if (!S.dms.find((d) => d.channelId === r.channel.id)) S.dms.push(r.dm);
    if (r.other) S.authors[r.other.id] = r.other;
    paint('side');
    await openChannel('dm', r.channel.id, null, userId);
    return r.channel.id;
  } catch (err) {
    toast(err.message, 'err');
    return null;
  }
};

app.callUser = async function callUser(userId, video = false) {
  const channelId = await app.startDm(userId);
  if (!channelId) return;
  try {
    await joinVoice(channelId, { dm: true });
    await apiMod.post(`/api/channels/${channelId}/call`, { video });
  } catch (err) {
    toast(err.message, 'err');
  }
};

async function startDmCall(video) {
  const dm = S.dms.find((d) => d.channelId === S.view.id);
  if (!dm?.user) return;
  await app.callUser(dm.user.id, video);
}

app.acceptCall = async function acceptCall(invite) {
  S.dmCalls.incoming = null;
  await openChannel('dm', invite.channelId, null, invite.from?.id);
  await joinVoice(invite.channelId, { dm: true });
};

/* ---------------------------------------------------------------- misc */

app.ensureMic = ensureMic;
app.paint = paint;
app.openChannel = openChannel;
app.joinVoice = joinVoice;
app.leaveVoice = leaveVoice;
app.sendWs = (payload) => app.realtime?.send(payload);
app.toggleMute = app.toggleMute;
app.resizeImage = async function resizeImage(file, max = 128) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/webp', 0.86);
};

async function loadDevices() {
  try {
    S.devices = await audio.listDevices();
  } catch {
    S.devices = [];
  }
}

// периодическое обновление таймера звонка и «печатает»
setInterval(() => {
  if (S.view.type === 'voice' && S.voice.joined) {
    const el = appEl().querySelector('.topbar .topic');
    if (el) {
      const participants = S.voice.participants.size + 1;
      el.textContent = `в звонке ${formatDuration(Date.now() - S.voice.startedAt)} · ${participants} ${participants === 1 ? 'участник' : participants < 5 ? 'участника' : 'участников'}`;
    }
  }
  for (const [channelId, map] of Object.entries(S.typing)) {
    const now = Date.now();
    for (const [uid, t] of map) if (t.until < now) map.delete(uid);
    if (S.view.id === channelId && map.size) paint('typing');
  }
}, 3000);

// обновление присутствия по таймауту без сети
setInterval(() => {
  if (app.realtime?.status === 'ready') app.realtime.send({ t: 'ping', ts: Date.now() });
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.view.id) {
    markRead(S.view.id);
  }
  if (!document.hidden) {
    const box = S.channels[S.view.id];
    if (box) box.dirty = (box.dirty || 0) + 1;
  }
});

boot();

export { S, app };
