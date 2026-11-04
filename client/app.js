import { Net } from './net.js';
import { RautRTC } from './rtc.js';

/* ------------------------------------------------------------------ */
/* Иконки                                                              */
/* ------------------------------------------------------------------ */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/><path d="M9.5 21v-6h5v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  hash: '<path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
  micOff: '<path d="M3 3 21 21"/><path d="M9 9v2a3 3 0 0 0 4.8 2.4M15 10V5a3 3 0 0 0-5.6-1.5"/><path d="M5 10a7 7 0 0 0 10.6 6M19 10a7 7 0 0 1-.4 2.3M12 17v5M8 22h8"/>',
  headphones: '<path d="M4 14v-2a8 8 0 1 1 16 0v2"/><rect x="2" y="13" width="5" height="8" rx="2"/><rect x="17" y="13" width="5" height="8" rx="2"/>',
  headphonesOff: '<path d="M3 3 21 21"/><path d="M4 14v-2a8 8 0 0 1 13.4-5.9M20 12v2"/><rect x="2" y="13" width="5" height="8" rx="2"/><rect x="17" y="13" width="5" height="8" rx="2"/>',
  screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  screenOff: '<path d="M3 3 21 21"/><path d="M8 21h8M12 17v4"/><path d="M22 12V5a2 2 0 0 0-2-2H7M2 7v8a2 2 0 0 0 2 2h12"/>',
  phoneOff: '<path d="M3 3 21 21"/><path d="M10.7 5.2A15 15 0 0 1 21 8.5v3a2 2 0 0 1-2 2c-1 0-1.7-.5-2.3-1.2M6.5 6.6C5 7.7 3.8 9.2 3 11.5a2 2 0 0 0 2 2.5h1.5a2 2 0 0 0 2-1.7c.1-.8.3-1.5.6-2.2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  attach: '<path d="M21.4 11.05 12.25 20.2a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48"/>',
  emoji: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9h.01M15 9h.01"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M4 12h11a5 5 0 0 1 5 5v2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  spark: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z"/>',
  signal: '<path d="M2 20h.01M6 20v-4M10 20v-8M14 20V8M18 20V4M22 20V2"/>',
  pin: '<path d="M12 17v5M9 3h6l1 6 3 3v2H5v-2l3-3 1-6Z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-4v12l-6-4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.info}</svg>`;
const $ = (s, root = document) => root.querySelector(s);
const byId = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtSize = (n) => n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;
const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();

/* ------------------------------------------------------------------ */
/* Состояние                                                           */
/* ------------------------------------------------------------------ */
const DEFAULT_SETTINGS = {
  name: '', color: '#5865f2', serverUrl: '', token: '', login: '',
  audioInput: '', audioOutput: '', audioBitrate: 256,
  echoCancellation: true, noiseSuppression: false, autoGainControl: true, ptt: false,
  shareWidth: 1920, shareHeight: 1080, shareFps: 60, shareBitrate: 8000, shareSystemAudio: true,
  turnUrl: '', turnUser: '', turnPass: '', stun: '', masterVolume: 1,
};
const COLORS = ['#5865f2', '#eb459e', '#3ba55d', '#faa81a', '#ed4245', '#00a8fc', '#9b59b6', '#1abc9c'];

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('raut.settings') || '{}') }; }
  catch (_) { return { ...DEFAULT_SETTINGS }; }
}
const saveSettings = () => localStorage.setItem('raut.settings', JSON.stringify(S.settings));

const S = {
  settings: loadSettings(),
  me: null, guilds: [], members: [], messages: {}, config: {},
  authMode: 'login', authPending: null,
  friends: [], requests: [], outgoing: [], dms: [],
  activeGuildId: '@home', activeChannelId: null,
  voiceChannelId: null, roster: [], unread: new Set(),
  muted: false, deafened: false, sharing: false,
  localVideo: null, videos: new Map(), speaking: new Set(), stats: null,
  typing: new Map(), replying: null,
  net: null, rtc: null, openedOnce: false, gestureNotified: false,
  memberListVisible: true,
};

const isHome = () => S.activeGuildId === '@home';
const HOME_GUILD = { id: '@home', name: 'Личные сообщения', icon: 'R', channels: [], categories: [], color: '#5865f2' };
const activeGuild = () => isHome() ? HOME_GUILD : (S.guilds.find((g) => g.id === S.activeGuildId) || S.guilds[0] || HOME_GUILD);
const activeChannel = () => {
  if (isHome()) return S.activeChannelId ? S.dms.find((d) => d.id === S.activeChannelId) || null : null;
  return activeGuild().channels.find((c) => c.id === S.activeChannelId) || activeGuild().channels.find((c) => c.type === 'text') || null;
};
const friendStatus = (id) => {
  const m = S.members.find((x) => x.id === id);
  if (m) return m.status === 'invisible' ? 'offline' : (m.status || 'online');
  return 'offline';
};
const gameOf = (id) => S.members.find((m) => m.id === id)?.game || S.friends.find((f) => f.id === id)?.game || '';
const memberById = (id) => S.members.find((m) => m.id === id);
const nameOf = (id) => memberById(id)?.name || 'Участник';
const colorOf = (id) => memberById(id)?.color || '#5865f2';

function iceServers() {
  const list = [];
  const stun = S.settings.stun.trim() || (S.config.iceServers || []).filter((s) => !s.username).map((s) => [].concat(s.urls).join(',')).join(',');
  for (const u of stun.split(',').map((x) => x.trim()).filter(Boolean)) list.push({ urls: u });
  const serverTurn = (S.config.iceServers || []).find((s) => s.username);
  const turnUrl = S.settings.turnUrl.trim() || (serverTurn ? [].concat(serverTurn.urls).join(',') : '');
  if (turnUrl) {
    list.push({
      urls: turnUrl.split(',').map((x) => x.trim()).filter(Boolean),
      username: S.settings.turnUser || serverTurn?.username || '',
      credential: S.settings.turnPass || serverTurn?.credential || '',
    });
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Вспомогательный UI                                                  */
/* ------------------------------------------------------------------ */
function toast(text, type = '') {
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = text;
  byId('toasts').appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; div.style.transform = 'translateX(20px)'; setTimeout(() => div.remove(), 250); }, 4200);
}

function closePopout() { byId('popoutRoot').innerHTML = ''; }
function showPopout(x, y, html, cls = '') {
  const root = byId('popoutRoot');
  root.innerHTML = `<div class="popout ${cls}" style="left:${Math.min(x, innerWidth - 320)}px;top:${Math.min(y, innerHeight - 260)}px">${html}</div>`;
  const po = $('.popout', root);
  po.addEventListener('click', (e) => { if (e.target.closest('[data-close-popout]')) closePopout(); });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#popoutRoot') && !e.target.closest('[data-popout]')) closePopout();
});

function closeModal() { byId('modalRoot').innerHTML = ''; }
function openModal(content, { small = false, onMount } = {}) {
  byId('modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-holder">
        <div class="modal ${small ? 'small' : ''}">${content}</div>
        <button class="modal-close" id="modalClose" title="Закрыть">${icon('x')}</button>
      </div>
    </div>`;
  $('#modalClose').onclick = closeModal;
  $('.modal-backdrop').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeModal(); });
  onMount?.();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closePopout(); byId('emojiPicker').classList.add('hidden'); }
});

function avatarHTML(m, cls = '') {
  const color = m?.color || '#5865f2';
  const speaking = S.speaking.has(m?.id) ? ' speaking' : '';
  const dot = m?.status ? `<span class="status-dot ${m.status}"></span>` : '';
  return `<div class="avatar ${cls}${speaking}" data-peer="${esc(m?.id || '')}" style="background:${esc(color)}">${esc(m?.avatar || initials(m?.name))}${dot}</div>`;
}

/* ------------------------------------------------------------------ */
/* Рендер                                                              */
/* ------------------------------------------------------------------ */
function renderGuildRail() {
  const parts = [];
  parts.push(`<div class="guild-icon home ${isHome() ? 'active' : ''}" data-guild="@home" title="Личные сообщения"><span class="guild-pill"></span>${icon('home')}</div>`);
  parts.push('<div class="rail-divider"></div>');
  for (const g of S.guilds) {
    parts.push(`<div class="guild-icon ${g.id === S.activeGuildId ? 'active' : ''}" data-guild="${esc(g.id)}" title="${esc(g.name)}" style="background:${g.id === S.activeGuildId ? '' : esc(g.color || '#313338')}">
      <span class="guild-pill"></span>${esc(g.icon || initials(g.name))}</div>`);
  }
  parts.push(`<div class="guild-icon rail-btn" data-action="about" title="О программе">${icon('download')}</div>`);
  byId('guildRail').innerHTML = parts.join('');
}

function renderGuildHeader() {
  const g = activeGuild();
  byId('guildHeader').innerHTML = `<span>${esc(g.name)}</span>${icon('chevron', 'ic chev')}`;
}

function renderHome() {
  const view = byId('homeView');
  const show = isHome() && !S.activeChannelId;
  if (view) view.classList.toggle('hidden', !show);
  const scroll = $('.messages-scroll');
  const composer = $('.composer-wrap');
  if (scroll) scroll.classList.toggle('hidden', show);
  if (composer) composer.classList.toggle('hidden', show);
  if (!show || !view) return;

  const requests = S.requests.length ? `<div class="request-banner">
      <span class="rb-text"><strong>Входящие запросы:</strong> ${S.requests.map((r) => esc(r.from.name)).join(', ')}</span>
      <span class="rb-actions">${S.requests.map((r) => `<button class="btn primary" data-action="friend-accept" data-user="${esc(r.from.id)}">Принять</button>
        <button class="btn ghost" data-action="friend-decline" data-user="${esc(r.from.id)}">Отклонить</button>`).join('')}</span>
    </div>` : '';
  const friends = S.friends.length ? S.friends.map((f) => {
    const st = friendStatus(f.id);
    const game = st === 'offline' ? '' : gameOf(f.id);
    return `<div class="friend-card">
      ${avatarHTML({ ...f, status: st })}
      <div class="fc-info"><div class="fc-name">${esc(f.name)}</div>
        <div class="fc-sub">@${esc(f.login || '—')} · ${game ? 'Играет в ' + esc(game) : (st === 'offline' ? 'не в сети' : 'в сети')}</div></div>
      <div class="fc-actions">
        <button class="icon-btn" data-action="open-dm" data-user="${esc(f.id)}" title="Написать">${icon('reply')}</button>
        <button class="icon-btn" data-action="friend-remove" data-user="${esc(f.id)}" title="Удалить из друзей">${icon('x')}</button>
      </div></div>`;
  }).join('') : `<div class="home-empty">${icon('users')}<div>Пока нет друзей.<br>Нажмите «Добавить друга» и введите его логин.</div></div>`;
  const outgoing = S.outgoing.length ? `<div class="hint" style="margin:0 18px 12px">Ожидают ответа: ${S.outgoing.map((o) => '@' + esc(o.to.login)).join(', ')}</div>` : '';
  view.innerHTML = `<div class="home-hero">
      <div><h2>Друзья</h2><p>Добавляйте друзей по логину и общайтесь в личных сообщениях и голосом.</p></div>
      <button class="btn primary" data-action="add-friend">${icon('plus')} Добавить друга</button>
    </div>${requests}${outgoing}<div class="friends-grid">${friends}</div>`;
}

function renderChannels() {
  if (isHome()) {
    const dmRows = S.dms.map((d) => {
      const st = friendStatus(d.peer.id);
      return `<div class="channel ${d.id === S.activeChannelId ? 'active' : ''}" data-channel="${esc(d.id)}" data-type="dm">
        <span class="dm-status ${st === 'offline' ? 'offline' : ''}"></span>
        <span class="ch-name">${esc(d.name)}</span>
        ${d.lastMessage ? '' : ''}
      </div>`;
    }).join('') || '<div class="home-empty" style="padding:12px;font-size:12px">Напишите другу — чат появится здесь</div>';
    byId('channelList').innerHTML = `
      <div class="channel ${!S.activeChannelId ? 'active' : ''}" data-action="show-friends">${icon('users', 'ic ch-icon')}<span class="ch-name">Друзья</span>
        ${S.requests.length ? `<span class="m-badge" style="font-size:10px;background:var(--blurple);padding:1px 5px;border-radius:3px">${S.requests.length}</span>` : ''}</div>
      <div class="sidebar-section-title">ЛИЧНЫЕ СООБЩЕНИЯ</div>
      ${dmRows}
      <div class="sidebar-section-title">ОБЩИЕ ЧАТЫ</div>
      ${S.guilds.map((g) => `<div class="channel" data-guild="${esc(g.id)}">${icon('hash', 'ic ch-icon')}<span class="ch-name">${esc(g.name)}</span></div>`).join('')}`;
    return;
  }
  const g = activeGuild();
  const cats = g.categories || [];
  const byCat = new Map(cats.map((c) => [c.id, []]));
  for (const ch of g.channels) {
    if (!byCat.has(ch.categoryId)) byCat.set(ch.categoryId, []);
    byCat.get(ch.categoryId).push(ch);
  }
  const out = [];
  for (const cat of cats) {
    const channels = byCat.get(cat.id) || [];
    out.push(`<div class="category"><span class="cat-name">${esc(cat.name)}</span>
      </div>`);
    for (const ch of channels) {
      const isVoice = ch.type === 'voice';
      const active = ch.id === S.activeChannelId && !isVoice;
      const inVoice = ch.id === S.voiceChannelId;
      const unread = S.unread.has(ch.id) && !active;
      out.push(`<div class="channel ${active ? 'active' : ''} ${unread ? 'has-unread' : ''}" data-channel="${esc(ch.id)}" data-type="${ch.type}">
        ${icon(isVoice ? 'volume' : 'hash', 'ic ch-icon')}
        <span class="ch-name">${esc(ch.name)}</span>
        <span class="ch-actions">
        </span>
      </div>`);
      if (isVoice) {
        const peers = S.members.filter((m) => m.voiceChannelId === ch.id);
        out.push(`<div class="voice-peers">${peers.map((m) => `
          <div class="voice-peer" data-member="${esc(m.id)}">${avatarHTML(m)}
            <span class="peer-name">${esc(m.name)}</span>
            <span class="peer-icons">${m.muted ? icon('micOff') : ''}${m.deafened ? icon('headphonesOff') : ''}${m.sharing ? icon('screen') : ''}</span>
          </div>`).join('')}</div>`);
        void inVoice;
      }
    }
  }
  byId('channelList').innerHTML = out.join('');
}

function renderHeader() {
  const ch = activeChannel();
  const home = isHome();
  const headIcon = home ? (ch ? 'user' : 'users') : (ch && ch.type === 'voice' ? 'volume' : 'hash');
  const heading = home ? (ch ? ch.name : 'Друзья') : (ch?.name || 'канал');
  const topic = home ? (ch ? 'Личные сообщения' : 'Ваши друзья и запросы') : (ch?.topic || '');
  byId('chatHeader').innerHTML = `
    ${icon(headIcon, 'ic hash')}
    <h3>${esc(heading)}</h3>
    ${topic ? `<span class="topic">${esc(topic)}</span>` : ''}
    <span class="spacer"></span>
    <button class="icon-btn" data-action="toggle-share" title="Демонстрация экрана">${icon(S.sharing ? 'screenOff' : 'screen')}</button>
    <button class="icon-btn ${S.memberListVisible ? 'on' : ''}" data-action="toggle-members" title="Список участников">${icon('users')}</button>
    <button class="icon-btn" data-action="search" title="Поиск по сообщениям">${icon('search')}</button>
    <button class="icon-btn" data-action="settings" title="Настройки">${icon('gear')}</button>`;
  byId('memberList').classList.toggle('hidden', !S.memberListVisible);
}

function richText(text) {
  let s = esc(text);
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/(^|\s)@([\wА-Яа-яЁё\-]+)/g, '$1<span class="mention">@$2</span>');
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

function messageHTML(m, grouped) {
  const author = { id: m.authorId, name: m.authorName, color: m.color, avatar: m.avatar };
  const head = grouped ? '' : `<div class="msg-head"><span class="msg-author" data-member="${esc(m.authorId)}" style="color:${esc(m.color || '#fff')}">${esc(m.authorName)}</span><span class="msg-time">${fmtDate(m.ts)} ${fmtTime(m.ts)}</span></div>`;
  let attachment = '';
  if (m.attachment?.url) {
    const a = m.attachment;
    const isImage = /^image\//.test(a.type);
    attachment = `<div class="msg-attachment">${isImage
      ? `<a href="${esc(a.url)}" target="_blank"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`
      : `<a class="file-card" href="${esc(a.url)}" download="${esc(a.name)}">${icon('file')}<span class="file-meta"><span class="file-name">${esc(a.name)}</span><span class="file-size">${fmtSize(a.size)}</span></span>${icon('download')}</a>`}</div>`;
  }
  return `<div class="msg ${grouped ? 'grouped' : ''}" data-msg="${esc(m.id)}">
    <div class="msg-avatar-slot">${grouped ? `<span class="ts-mini">${fmtTime(m.ts)}</span>` : avatarHTML(author, 'lg')}</div>
    <div class="msg-body">${head}<div class="msg-text">${richText(m.text || '')}</div>${attachment}</div>
    <div class="msg-actions">
      <button class="icon-btn" data-action="reply" data-msg="${esc(m.id)}" title="Ответить">${icon('reply')}</button>
      <button class="icon-btn" data-action="copy-msg" data-msg="${esc(m.id)}" title="Копировать текст">${icon('copy')}</button>
    </div>
  </div>`;
}

function renderMessages({ scroll = false } = {}) {
  const ch = activeChannel();
  const list = (ch && S.messages[ch.id]) || [];
  const intro = ch ? `<div class="channel-intro" id="channelIntro">
      <div class="intro-icon">${icon(ch.type === 'dm' ? 'user' : ch.type === 'voice' ? 'volume' : 'hash')}</div>
      ${ch.type === 'dm'
        ? `<h2>${esc(ch.name)}</h2><p>Это начало личной переписки с ${esc(ch.name)}. Сообщения видите только вы вдвоём.</p>`
        : `<h2>Добро пожаловать в #${esc(ch.name)}!</h2><p>Это начало канала «${esc(ch.name)}». ${esc(ch.topic || 'Общайтесь, созванивайтесь и показывайте экран.')}</p>`}
    </div>` : '';
  let prev = null;
  const html = list.map((m) => {
    const grouped = prev && prev.authorId === m.authorId && m.ts - prev.ts < 5 * 60 * 1000;
    prev = m;
    return messageHTML(m, grouped);
  }).join('');
  byId('messages').innerHTML = html;
  byId('channelIntro')?.remove();
  $('.messages-scroll')?.insertAdjacentHTML('afterbegin', intro);
  if (scroll) requestAnimationFrame(() => { const s = $('.messages-scroll'); if (s) s.scrollTop = s.scrollHeight; });
}

function renderMembers() {
  let groups;
  if (isHome()) {
    const online = S.friends.filter((f) => friendStatus(f.id) !== 'offline');
    const offline = S.friends.filter((f) => friendStatus(f.id) === 'offline');
    groups = [['В СЕТИ — ДРУЗЬЯ', online], ['НЕ В СЕТИ', offline]];
  } else {
    const online = S.members.filter((m) => m.status !== 'invisible');
    groups = [['В СЕТИ', online]];
  }
  groups = groups.filter(([, list]) => list.length);
  if (!groups.length) groups = [['НИКОГО НЕТ', []]];
  byId('memberList').innerHTML = groups.map(([title, list]) => `
    <div class="member-group">${title} — ${list.length}</div>
    ${list.map((m) => `<div class="member" data-member="${esc(m.id)}">
      ${avatarHTML(isHome() ? { ...m, status: friendStatus(m.id) } : m)}
      <span class="m-name" style="color:${m.id === S.me?.id ? '#fff' : esc(m.color || '#dbdee1')}">${esc(m.name)}</span>
      <span class="m-icons">${gameOf(m.id) ? icon('monitor') : ''}${m.muted ? icon('micOff') : ''}${m.deafened ? icon('headphonesOff') : ''}${m.sharing ? icon('screen') : ''}</span>
    </div>`).join('')}`).join('');
}

function renderUserPanel() {
  const me = S.me || { name: S.settings.name, color: S.settings.color, id: 'me' };
  byId('userPanel').innerHTML = `
    <div class="me" data-action="my-profile">
      ${avatarHTML(me)}
      <div class="me-names"><div class="me-name">${esc(me.name)}</div><div class="me-status" id="connStatus">${S.net ? 'в сети' : 'не подключён'}</div></div>
    </div>
    <button class="icon-btn ${S.muted ? 'active' : ''}" data-action="mute" title="${S.muted ? 'Включить микрофон' : 'Выключить микрофон'}">${icon(S.muted ? 'micOff' : 'mic')}</button>
    <button class="icon-btn ${S.deafened ? 'active' : ''}" data-action="deafen" title="${S.deafened ? 'Включить звук' : 'Выключить звук'}">${icon(S.deafened ? 'headphonesOff' : 'headphones')}</button>
    <button class="icon-btn" data-action="settings" title="Настройки">${icon('gear')}</button>
    <button class="icon-btn" data-action="logout" title="Выйти из аккаунта">${icon('logout')}</button>`;
}

function renderVoicePanel() {
  const panel = byId('voicePanel');
  if (!S.voiceChannelId) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
  panel.classList.remove('hidden');
  const ch = S.guilds.flatMap((g) => g.channels).find((c) => c.id === S.voiceChannelId);
  const st = S.stats;
  const quality = st ? ` · ${st.rtt} мс · потери ${st.loss}%` : '';
  panel.innerHTML = `
    <div class="vp-row">
      <div class="vp-info">
        <div class="vp-title">${icon('signal')} Голос подключён</div>
        <div class="vp-sub">${esc(ch?.name || 'Голосовой канал')} · ${S.roster.length + 1} чел.${quality}</div>
      </div>
      <button class="icon-btn" data-action="leave-voice" title="Отключиться">${icon('phoneOff')}</button>
    </div>
    <div class="vp-buttons">
      <button class="icon-btn ${S.sharing ? 'active' : ''}" data-action="toggle-share" title="Демонстрация экрана">${icon(S.sharing ? 'screenOff' : 'screen')}</button>
      <button class="icon-btn ${S.muted ? 'active' : ''}" data-action="mute" title="Микрофон">${icon(S.muted ? 'micOff' : 'mic')}</button>
      <button class="icon-btn ${S.deafened ? 'active' : ''}" data-action="deafen" title="Наушники">${icon(S.deafened ? 'headphonesOff' : 'headphones')}</button>
      <button class="icon-btn" data-action="voice-settings" title="Качество звука">${icon('sliders')}</button>
    </div>`;
}

function renderStage() {
  const stage = byId('stage');
  const tiles = [];
  if (S.localVideo) {
    tiles.push(`<div class="video-tile" data-tile="local"><video id="localVideo" autoplay muted playsinline></video>
      <div class="tile-label">Вы демонстрируете экран</div>
      <div class="tile-actions"><button class="icon-btn" data-action="stop-share" title="Остановить">${icon('screenOff')}</button></div></div>`);
  }
  for (const [peerId, stream] of S.videos) {
    const m = memberById(peerId);
    tiles.push(`<div class="video-tile ${S.speaking.has(peerId) ? 'speaking' : ''}" data-tile="${esc(peerId)}" data-peer="${esc(peerId)}">
      <video autoplay playsinline data-video="${esc(peerId)}"></video>
      <div class="tile-label">${esc(m?.name || nameOf(peerId))} · экран</div>
      <div class="tile-actions">
        <button class="icon-btn" data-action="fullscreen" data-peer="${esc(peerId)}" title="На весь экран">${icon('fullscreen')}</button>
        <button class="icon-btn" data-action="mute-tile" data-peer="${esc(peerId)}" title="Выключить звук">${icon('volume')}</button>
      </div></div>`);
  }
  if (!tiles.length) { stage.classList.add('hidden'); stage.innerHTML = ''; return; }
  stage.classList.remove('hidden');
  stage.innerHTML = `<div class="stage-head"><span class="live">LIVE</span><span>Демонстрация экрана · ${tiles.length} ${tiles.length === 1 ? 'трансляция' : 'трансляции'}</span><span class="spacer"></span><span>до ${S.settings.shareFps} FPS · ${(S.settings.shareBitrate / 1000).toFixed(0)} Мбит/с</span></div>
    <div class="stage-videos">${tiles.join('')}</div>`;
  const lv = byId('localVideo');
  if (lv && S.localVideo) { lv.srcObject = S.localVideo; lv.play().catch(() => {}); }
  for (const [peerId, stream] of S.videos) {
    const v = $(`[data-video="${peerId}"]`, stage);
    if (v) { v.srcObject = stream; v.play().catch(() => {}); }
  }
}

function renderAll() {
  renderGuildRail(); renderGuildHeader(); renderChannels(); renderHeader();
  renderMessages({ scroll: true }); renderMembers(); renderUserPanel(); renderVoicePanel(); renderStage(); renderHome();
}

function renderDownloadLinks() {
  const exe = byId('connectDownload');
  const zip = byId('connectPortable');
  if (exe) {
    const info = S.config.installer;
    if (!info) exe.classList.add('hidden');
    else {
      exe.href = info.url;
      exe.setAttribute('download', info.name);
      const size = $('.dl-size', exe);
      if (size) size.textContent = `${(info.size / 1048576).toFixed(1)} МБ · установщик .exe`;
      exe.classList.remove('hidden');
    }
  }
  if (zip) {
    const info = S.config.portable;
    if (!info) zip.classList.add('hidden');
    else {
      zip.href = info.url;
      zip.setAttribute('download', info.name);
      const size = $('.dl-size', zip);
      if (size) size.textContent = `${(info.size / 1048576).toFixed(1)} МБ · без установщика`;
      zip.classList.remove('hidden');
    }
  }
}

function renderNetBanner(state, extra = {}) {
  const b = byId('netBanner');
  if (state === 'connected') { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  if (state === 'connecting') b.textContent = 'Подключение…';
  else if ((extra.attempt || 1) < 3) b.textContent = 'Восстанавливаем соединение…';
  else b.textContent = `Нет связи с сервером, пробуем ещё (попытка ${extra.attempt})…`;
}

function updateSpeakingUI() {
  document.querySelectorAll('[data-peer]').forEach((node) => {
    node.classList.toggle('speaking', S.speaking.has(node.dataset.peer));
  });
}

/* ------------------------------------------------------------------ */
/* Сеть                                                                */
/* ------------------------------------------------------------------ */
function wsURL() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function ensureRTC() {
  if (S.rtc) return S.rtc;
  S.rtc = new RautRTC({
    signal: (to, kind, data, media) => S.net?.send({ t: 'signal', to, kind, media, ...data }),
    iceServers: iceServers(),
    settings: S.settings,
    myId: S.me?.id || '',
  });
  S.rtc.muted = S.muted;
  S.rtc.deafened = S.deafened;
  S.rtc.outputDevice = S.settings.audioOutput || '';
  S.rtc.addEventListener('speaking', (e) => {
    const { peerId, speaking } = e.detail;
    if (speaking) S.speaking.add(peerId); else S.speaking.delete(peerId);
    updateSpeakingUI();
  });
  S.rtc.addEventListener('stats', (e) => { S.stats = e.detail; renderVoicePanel(); });
  S.rtc.addEventListener('error', (e) => toast(e.detail.message, 'error'));
  S.rtc.addEventListener('remote-video', (e) => { S.videos.set(e.detail.peerId, e.detail.stream); renderStage(); });
  S.rtc.addEventListener('local-video', (e) => { S.localVideo = e.detail.stream; renderStage(); });
  S.rtc.addEventListener('share-started', () => {
    S.sharing = true;
    S.net?.send({ t: 'state', patch: { sharing: true } });
    renderHeader(); renderVoicePanel();
    toast('Демонстрация экрана запущена', 'success');
  });
  S.rtc.addEventListener('share-ended', () => {
    S.sharing = false; S.localVideo = null;
    S.net?.send({ t: 'state', patch: { sharing: false } });
    renderHeader(); renderVoicePanel(); renderStage();
  });
  S.rtc.addEventListener('peer-left', (e) => {
    if (e.detail.media === 'video') { S.videos.delete(e.detail.peerId); renderStage(); }
  });
  S.rtc.addEventListener('need-gesture', () => {
    if (S.gestureNotified) return;
    S.gestureNotified = true;
    toast('Кликните в окне, чтобы разрешить воспроизведение звука');
  });
  return S.rtc;
}

function enterShell() {
  byId('connectScreen').classList.add('hidden');
  byId('shell').classList.remove('hidden');
}
function leaveShell(message) {
  if (S.keepAlive) { clearInterval(S.keepAlive); S.keepAlive = null; }
  try { S.net?.close(); } catch (_) { /* ignore */ }
  S.net = null; S.me = null;
  S.friends = []; S.requests = []; S.outgoing = []; S.dms = []; S.messages = {};
  S.voiceChannelId = null; S.roster = []; S.unread.clear();
  byId('shell').classList.add('hidden');
  byId('connectScreen').classList.remove('hidden');
  const err = byId('connectError');
  if (err) {
    err.textContent = message || '';
    err.classList.toggle('hidden', !message);
  }
}

function startSession() {
  enterShell();
  S.net = new Net();
  S.net.addEventListener('status', (e) => {
    renderNetBanner(e.detail.state, e.detail);
    const cs = byId('connStatus');
    if (cs) cs.textContent = e.detail.state === 'connected' ? 'в сети' : 'переподключение…';
    if (e.detail.state === 'reconnecting' && S.rtc) { S.rtc.destroy(); S.rtc = null; S.videos.clear(); S.localVideo = null; S.sharing = false; }
  });
  // Прикладной keep-alive: обычные кадры данных, которые не режет ни один
  // прокси (в отличие от WS-ping). Держим соединение живым всё время.
  if (S.keepAlive) clearInterval(S.keepAlive);
  S.keepAlive = setInterval(() => { if (S.net?.ws?.readyState === 1) S.net.send({ t: 'ping' }); }, 20000);
  S.net.addEventListener('open', () => {
    ensureRTC();
    S.net.send(S.authPending || { t: 'auth', mode: 'token', token: S.settings.token });
  });
  S.net.addEventListener('welcome', (e) => {
    const m = e.detail;
    S.me = m.self; S.guilds = m.guilds || []; S.members = m.members || [];
    S.messages = m.messages || {}; S.config = m.config || {};
    S.friends = m.friends || []; S.requests = m.requests || []; S.outgoing = m.outgoing || [];
    S.dms = m.dms || [];
    S.authPending = null;
    if (m.token) { S.settings.token = m.token; S.settings.login = m.self.login || ''; }
    if (m.self?.name) S.settings.name = m.self.name;
    if (m.self?.color) S.settings.color = m.self.color;
    saveSettings();
    if (!isHome() && !S.guilds.some((g) => g.id === S.activeGuildId)) S.activeGuildId = '@home';
    if (isHome()) {
      if (S.activeChannelId && !S.dms.some((d) => d.id === S.activeChannelId)) S.activeChannelId = null;
    } else {
      const g = activeGuild();
      if (!g.channels.some((c) => c.id === S.activeChannelId)) S.activeChannelId = g.channels.find((c) => c.type === 'text')?.id;
    }
    ensureRTC().setConfig({ myId: S.me.id, iceServers: iceServers() });
    // Всё состояние шлём ТОЛЬКО после успешного входа, иначе сервер отвечает ошибкой.
    if (S.voiceChannelId) S.net.send({ t: 'join-voice', channelId: S.voiceChannelId });
    S.net.send({ t: 'state', patch: { muted: S.muted, deafened: S.deafened, sharing: false } });
    renderAll(); renderDownloadLinks();
    toast(`Вы вошли как ${m.self?.name || 'гость'}`, 'success');
  });
  S.net.addEventListener('auth-error', (e) => {
    S.settings.token = ''; S.settings.login = '';
    S.authPending = null;
    saveSettings();
    leaveShell(e.detail?.message || 'Не удалось войти');
    renderUserPanel();
  });
  S.net.addEventListener('error', (e) => toast(e.detail.message, 'error'));
  S.net.addEventListener('notice', (e) => toast(e.detail.message, 'info'));
  S.net.addEventListener('friends', (e) => {
    S.friends = e.detail.friends || [];
    S.requests = e.detail.requests || [];
    S.outgoing = e.detail.outgoing || [];
    renderHome(); renderChannels(); renderMembers();
  });
  S.net.addEventListener('friend-request', (e) => {
    toast(`${e.detail?.from?.name || 'Кто-то'} хочет добавить вас в друзья`, 'info');
    S.net?.send({ t: 'friends-refresh' });
  });
  S.net.addEventListener('dms', (e) => {
    S.dms = e.detail.dms || [];
    renderChannels(); renderHome();
  });
  S.net.addEventListener('dm-opened', (e) => {
    S.dms = e.detail.dms || S.dms;
    S.activeGuildId = '@home';
    S.activeChannelId = e.detail.channel?.id || null;
    S.unread.delete(S.activeChannelId);
    renderAll();
  });
  S.net.addEventListener('presence', (e) => {
    S.members = e.detail.members;
    renderMembers(); renderChannels(); renderHome(); renderUserPanel(); renderVoicePanel(); renderStage();
  });
  S.net.addEventListener('guilds', (e) => { S.guilds = e.detail.guilds; renderGuildRail(); renderGuildHeader(); renderChannels(); renderHeader(); });
  S.net.addEventListener('chat', (e) => {
    const m = e.detail.message;
    (S.messages[m.channelId] ||= []).push(m);
    if (m.channelId === S.activeChannelId) renderMessages({ scroll: true });
    else { S.unread.add(m.channelId); renderChannels(); }
    if (m.authorId !== S.me?.id && document.hidden) document.title = '(1) Raut';
  });
  S.net.addEventListener('typing', (e) => {
    const { channelId, userId, name } = e.detail;
    S.typing.set(channelId, { userId, name, ts: Date.now() });
    showTyping();
  });
  S.net.addEventListener('voice-roster', (e) => {
    if (e.detail.channelId !== S.voiceChannelId) return;
    S.roster = e.detail.peers.filter((p) => p.id !== S.me?.id);
    const rtc = ensureRTC();
    rtc.ensureLocalAudio().catch(() => {}).finally(() => rtc.setRoster(e.detail.peers));
    renderVoicePanel(); renderChannels();
  });
  S.net.addEventListener('signal', (e) => {
    const m = e.detail;
    ensureRTC().handleSignal(m.from, m.kind, { sdp: m.sdp, candidate: m.candidate }, m.media || 'audio');
  });
  S.net.connect(wsURL());
}

function showTyping() {
  const now = Date.now();
  const item = S.typing.get(S.activeChannelId);
  const row = byId('typingRow');
  if (!item || now - item.ts > 4000) { row.innerHTML = ''; return; }
  row.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> ${esc(item.name)} печатает…`;
  setTimeout(showTyping, 1200);
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */
function sendState(patch) { S.net?.send({ t: 'state', patch }); }

function setMuted(v) {
  S.muted = !!v;
  ensureRTC().setMuted(S.muted);
  sendState({ muted: S.muted, deafened: S.deafened });
  renderUserPanel(); renderVoicePanel(); renderChannels(); renderMembers();
}
function setDeafened(v) {
  S.deafened = !!v;
  ensureRTC().setDeafened(S.deafened);
  S.muted = S.deafened;
  sendState({ muted: S.muted, deafened: S.deafened });
  renderUserPanel(); renderVoicePanel(); renderChannels(); renderMembers();
}

async function joinVoice(channelId) {
  const rtc = ensureRTC();
  try { await rtc.ensureLocalAudio(); }
  catch (err) { toast('Микрофон недоступен: ' + err.message + ' — вы будете слушателем', 'error'); }
  S.voiceChannelId = channelId;
  S.net.send({ t: 'join-voice', channelId });
  renderChannels(); renderVoicePanel();
}

function leaveVoice() {
  const id = S.voiceChannelId;
  S.voiceChannelId = null; S.roster = []; S.sharing = false; S.localVideo = null;
  S.net?.send({ t: 'leave-voice' });
  if (S.rtc) { S.rtc.stopShare(); S.rtc.destroy(); S.rtc = null; }
  S.videos.clear();
  sendState({ sharing: false });
  void id;
  renderChannels(); renderVoicePanel(); renderStage(); renderHeader();
}

async function toggleShare() {
  if (S.sharing) { ensureRTC().stopShare(); return; }
  if (!S.voiceChannelId) {
    const g = activeGuild();
    const vc = g.channels.find((c) => c.type === 'voice');
    if (!vc) return toast('Сначала зайдите в голосовой канал', 'error');
    await joinVoice(vc.id);
    await new Promise((r) => setTimeout(r, 350));
  }
  try { await ensureRTC().startShare(); }
  catch (err) {
    if (err.name !== 'NotAllowedError') toast('Не удалось показать экран: ' + err.message, 'error');
  }
}

function updateSetting(key, value) {
  S.settings[key] = value;
  saveSettings();
  if (S.rtc) S.rtc.applySettings(S.settings).catch(() => {});
  if (key === 'audioOutput' && S.rtc) S.rtc.setOutputDevice(value);
  if (key === 'masterVolume' && S.rtc) for (const id of S.roster.map((p) => p.id)) S.rtc.setPeerVolume(id, value);
  if (['name', 'color'].includes(key) && S.me) {
    S.me.name = S.settings.name;
    S.me.color = S.settings.color;
    sendState({ name: S.settings.name, color: S.settings.color });
    renderUserPanel(); renderMembers();
  }
  if (['turnUrl', 'turnUser', 'turnPass', 'stun'].includes(key) && S.rtc) {
    S.rtc.setConfig({ iceServers: iceServers() });
  }
  if (['shareFps', 'shareBitrate'].includes(key)) renderStage();
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const ins = $('[data-setting="audioInput"]');
    const outs = $('[data-setting="audioOutput"]');
    if (ins) {
      const cur = S.settings.audioInput;
      ins.innerHTML = `<option value="">По умолчанию</option>` + devices.filter((d) => d.kind === 'audioinput').map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || 'Микрофон ' + d.deviceId.slice(0, 6))}</option>`).join('');
    }
    if (outs) {
      const cur = S.settings.audioOutput;
      outs.innerHTML = `<option value="">По умолчанию</option>` + devices.filter((d) => d.kind === 'audiooutput').map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || 'Динамики ' + d.deviceId.slice(0, 6))}</option>`).join('');
    }
  } catch (_) { /* enumerateDevices может быть недоступен */ }
}

/* ------------------------------------------------------------------ */
/* Модальные окна                                                      */
/* ------------------------------------------------------------------ */
const TABS = [
  { id: 'profile', label: 'Мой профиль', icon: 'user' },
  { id: 'voice', label: 'Голос и звук', icon: 'mic' },
  { id: 'share', label: 'Демонстрация экрана', icon: 'screen' },
  { id: 'about', label: 'О программе', icon: 'info' },
];

function openSettings(tab = 'profile') {
  let current = tab;
  const nav = `<div class="modal-nav">
    <div style="font-weight:800;font-size:15px;padding:0 10px 12px">НАСТРОЙКИ</div>
    ${TABS.map((t) => `<button class="nav-item ${t.id === current ? 'active' : ''}" data-tab="${t.id}">${icon(t.icon)} <span style="vertical-align:middle;margin-left:6px">${t.label}</span></button>`).join('')}
    <h4 style="margin-top:26px">Raut v1.0.1</h4>
  </div><div class="modal-body" id="settingsBody"></div>`;
  openModal(nav, {
    onMount: () => {
      const body = byId('settingsBody');
      const paint = () => {
        body.innerHTML = settingsTab(current);
        $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === current));
        bindSettings(body);
        refreshDevices();
      };
      $$('.nav-item').forEach((b) => b.addEventListener('click', () => { current = b.dataset.tab; paint(); }));
      paint();
    },
  });
}

const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toggleRow(label, desc, key) {
  return `<div class="check-row"><div><div class="check-label">${label}</div><div class="check-desc">${desc}</div></div>
    <button class="toggle ${S.settings[key] ? 'on' : ''}" data-toggle="${key}" aria-label="${esc(label)}"></button></div>`;
}
function selectRow(label, key, options, hint = '') {
  return `<label class="field"><span>${label}</span><select data-setting="${key}">
    ${options.map(([v, t]) => `<option value="${esc(v)}" ${String(S.settings[key]) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function rangeRow(label, key, min, max, step, unit) {
  return `<label class="field"><span>${label}</span><div class="range-row">
    <input type="range" data-setting="${key}" data-unit="${esc(unit)}" min="${min}" max="${max}" step="${step}" value="${esc(S.settings[key])}">
    <span class="range-val" data-range-val="${key}">${esc(S.settings[key])} ${esc(unit)}</span></div></label>`;
}

function settingsTab(tab) {
  if (tab === 'profile') return `<h2>Мой профиль</h2>
    <div style="display:flex;gap:20px;align-items:center;margin-bottom:24px">${avatarHTML({ ...S.me, name: S.settings.name, color: S.settings.color }, 'xl')}
      <div><div style="font-size:20px;font-weight:700">${esc(S.settings.name)}</div><div class="muted" style="font-size:13px">Участник · в сети</div></div></div>
    <label class="field"><span>Отображаемое имя</span><input type="text" data-setting="name" value="${esc(S.settings.name)}" maxlength="32"></label>
    <label class="field"><span>Цвет профиля</span><div class="color-picker" data-colors="1">${COLORS.map((c) => `<button class="swatch ${S.settings.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c};color:${c}"></button>`).join('')}</div></label>
    <div class="hint">Имя и цвет видны только вашим друзьям.</div>`;

  if (tab === 'voice') return `<h2>Голос и звук</h2>
    <h3>Устройства</h3>
    ${selectRow('Микрофон', 'audioInput', [['', 'По умолчанию']])}
    ${selectRow('Динамики / наушники', 'audioOutput', [['', 'По умолчанию']])}
    <h3>Качество (Opus 48 кГц, стерео)</h3>
    ${rangeRow('Битрейт звука', 'audioBitrate', 64, 510, 8, 'кбит/с')}
    ${rangeRow('Общая громкость собеседников', 'masterVolume', 0, 2, 0.05, '×')}
    <h3>Обработка звука</h3>
    ${toggleRow('Подавление эха', 'Рекомендуется при использовании динамиков', 'echoCancellation')}
    ${toggleRow('Шумоподавление', 'Выключите для музыки и стриминга — звук будет чище', 'noiseSuppression')}
    ${toggleRow('Автоматическая громкость', 'Выравнивает уровень микрофона', 'autoGainControl')}
    ${toggleRow('Рация (Push-to-talk)', 'Удерживайте ПРОБЕЛ, чтобы говорить', 'ptt')}
    <div class="hint">Соединение построено на WebRTC с кодеком Opus: 48 кГц, стерео, FEC и адаптивный джиттер-буфер. Для максимального качества отключите шумоподавление и выставьте битрейт 256–320 кбит/с.</div>`;

  if (tab === 'share') return `<h2>Демонстрация экрана</h2>
    <h3>Разрешение и частота кадров</h3>
    ${selectRow('Разрешение', 'shareWidth', [[1280, '1280×720 (HD)'], [1920, '1920×1080 (Full HD)'], [2560, '2560×1440 (QHD)'], [3840, '3840×2160 (4K)']], 'Высота подбирается пропорционально.')}
    ${rangeRow('Частота кадров', 'shareFps', 15, 60, 5, 'FPS')}
    ${rangeRow('Битрейт видео', 'shareBitrate', 2000, 30000, 500, 'кбит/с')}
    <h3>Дополнительно</h3>
    ${toggleRow('Звук системы', 'Передавать звук из захватываемого приложения', 'shareSystemAudio')}
    <div class="hint">Высокое качество держится на отдельных WebRTC-соединениях для видео: голос не прерывается при запуске трансляции. Рекомендуется 1920×1080 / 60 FPS / 8 Мбит/с. При слабом канале понизьте битрейт — разрешение останется прежним.</div>`;

  if (tab === 'about') return `<h2>О программе</h2>
    <div style="display:flex;gap:20px;align-items:center;margin-bottom:22px">
      <img src="/assets/logo.png?v=2" style="width:72px;height:72px;border-radius:18px" alt="">
      <div><div style="font-size:24px;font-weight:800">Raut</div><div class="muted">Версия 1.0.1 · независимая связь</div></div></div>
    <div class="kv"><span>Сервер</span><code>${esc(S.config.name || 'Raut Server')}</code></div>
    <div class="kv"><span>Протокол</span><code>WebSocket + WebRTC (Opus / VP9-H264)</code></div>
    <div class="kv"><span>Шифрование</span><code>DTLS-SRTP, сквозное</code></div>
    <div class="kv"><span>Зависимости</span><code>нет внешних сервисов</code></div>
    <div class="hint">Raut работает без Discord и без внешних сервисов. Установщик кладёт программу в папку пользователя, не требует прав администратора и не показывает консоль.</div>
    ${S.config.installer ? `<h3>Установщик для Windows</h3>
      <a class="download-link" href="${esc(S.config.installer.url)}" download="${esc(S.config.installer.name)}">
        ${icon('download')}<span class="dl-text"><strong>Скачать ${esc(S.config.installer.name)}</strong>
        <small>${(S.config.installer.size / 1048576).toFixed(1)} МБ · Windows 10/11 x64</small></span><span class="dl-arrow">↓</span></a>
      ${S.config.installer.sha ? `<div class="kv"><span>SHA-256</span><code>${esc(S.config.installer.sha.slice(0, 24))}…</code></div>` : ''}
      ${S.config.portable ? `<a class="download-link" href="${esc(S.config.portable.url)}" download="${esc(S.config.portable.name)}">
        ${icon('download')}<span class="dl-text"><strong>Портативная версия (ZIP)</strong>
        <small>${(S.config.portable.size / 1048576).toFixed(1)} МБ · без установщика, если АВ блокирует .exe</small></span><span class="dl-arrow">↓</span></a>` : ''}
      <div class="hint" style="font-size:12px">Антивирус ругается? Установщик не подписан и упакован NSIS/LZMA — это частая причина ложных срабатываний. Сверьте SHA-256 через <code>Get-FileHash</code>, проверьте на VirusTotal или скачайте портативный ZIP. В сборке нет VBS/WSH и скрытых окон.</div>` : ''}
    <div class="modal-actions"><button class="btn ghost" id="restartVoice">${icon('refresh')} Переподключить голос</button></div>`;
  return '';
}

function bindSettings(root) {
  $$('[data-setting]', root).forEach((input) => {
    const key = input.dataset.setting;
    const handler = () => {
      let value = input.type === 'range' ? Number(input.value) : input.value;
      if (key === 'shareWidth') {
        const map = { 1280: 720, 1920: 1080, 2560: 1440, 3840: 2160 };
        S.settings.shareHeight = map[value] || 1080;
        value = Number(value);
      }
      updateSetting(key, value);
      const label = $(`[data-range-val="${key}"]`, root);
      if (label) label.textContent = `${value} ${input.dataset.unit || ''}`;
    };
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'range' ? 'input' : 'change', handler);
    if (input.type === 'range') input.addEventListener('change', handler);
  });
  $$('[data-toggle]', root).forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    updateSetting(key, !S.settings[key]);
    btn.classList.toggle('on', !!S.settings[key]);
  }));
  $$('[data-color]', root).forEach((btn) => btn.addEventListener('click', () => {
    updateSetting('color', btn.dataset.color);
    $$('[data-color]', root).forEach((b) => b.classList.toggle('selected', b === btn));
    const av = $('.avatar.xl', root);
    if (av) av.style.background = btn.dataset.color;
  }));
  const restart = $('#restartVoice', root);
  if (restart) restart.onclick = async () => {
    const id = S.voiceChannelId;
    leaveVoice();
    if (id) { await new Promise((r) => setTimeout(r, 300)); await joinVoice(id); }
    toast('Голосовое соединение пересоздано', 'success');
    closeModal();
  };
}

function openSimpleModal(title, content, onSubmit, submitLabel = 'Готово') {
  openModal(`<div class="modal-body" style="width:100%"><h2>${esc(title)}</h2>${content}
    <div class="modal-actions"><button class="btn ghost" id="simpleCancel">Отмена</button><button class="btn primary" id="simpleOk">${esc(submitLabel)}</button></div></div>`, {
    small: true,
    onMount: () => {
      $('#simpleCancel').onclick = closeModal;
      $('#simpleOk').onclick = () => { const keep = onSubmit(); if (keep !== false) closeModal(); };
      $('input', byId('modalRoot'))?.focus();
    },
  });
}

function openAddFriend() {
  openSimpleModal('Добавить друга', `
    <label class="field"><span>Логин друга</span><input id="friendLogin" type="text" maxlength="24" spellcheck="false" placeholder="например, alex"></label>
    <div class="hint">Друг должен быть зарегистрирован на этом же сервере Raut. Спросите его логин — он виден в профиле.</div>`, () => {
    const login = byId('friendLogin').value.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(login)) { toast('Введите корректный логин (3–24 символа, латиница)', 'error'); return false; }
    S.net?.send({ t: 'friend-add', login });
  }, 'Отправить запрос');
}

function openSetGame() {
  openSimpleModal('Во что играю', `
    <label class="field"><span>Название игры</span><input id="gameName" type="text" maxlength="60" placeholder="например, Counter-Strike 2"></label>
    <div class="hint">Друзья увидят это у себя в списке друзей. Оставьте поле пустым, чтобы убрать статус.</div>`, () => {
    const game = byId('gameName').value.trim();
    S.net?.send({ t: 'state', patch: { game } });
    if (S.me) S.me.game = game;
    toast(game ? 'Статус обновлён: играет в ' + game : 'Игровой статус убран');
  }, 'Сохранить');
}

function openSearch() {
  openSimpleModal('Поиск по сообщениям', `
    <label class="field"><span>Что ищем</span><input id="searchQuery" type="text" placeholder="текст сообщения"></label>
    <div id="searchResults" class="muted" style="font-size:13px;max-height:300px;overflow:auto"></div>`, () => {
    const q = byId('searchQuery').value.trim().toLowerCase();
    if (!q) return false;
    const found = Object.values(S.messages).flat().filter((m) => (m.text || '').toLowerCase().includes(q)).slice(-40).reverse();
    byId('searchResults').innerHTML = found.length
      ? found.map((m) => `<div class="kv"><span>${esc(m.authorName)} · ${fmtTime(m.ts)}</span><span>${esc(m.text.slice(0, 100))}</span></div>`).join('')
      : 'Ничего не найдено';
    return false;
  }, null);
  const ok = $('#simpleOk');
  if (ok) { ok.textContent = 'Найти'; }
}

function openProfile(id) {
  const friend = S.friends.find((f) => f.id === id);
  const live = memberById(id);
  const m = (id === S.me?.id ? S.me : null) || (friend ? { ...friend, ...(live || {}) } : live);
  if (!m) return;
  const isMe = id === S.me?.id;
  const inVoice = !!m.voiceChannelId;
  const volume = `<div class="profile-box"><h5>Громкость собеседника</h5>
    <input type="range" id="peerVolume" min="0" max="2" step="0.05" value="1" ${inVoice ? '' : 'disabled'}></div>`;
  const html = `<div class="profile-banner" style="background:${esc(m.color)}"></div>
    <div class="profile-body">${avatarHTML(m, 'xl')}
      <div class="profile-name">${esc(m.name)}</div>
      <div class="profile-tag">${m.login ? '@' + esc(m.login) : (isMe ? 'Это вы' : 'Участник')} · ${m.voiceChannelId ? 'в голосовом канале' : (friendStatus(m.id) === 'offline' ? 'не в сети' : 'в сети')}${gameOf(id) ? ' · Играет в ' + esc(gameOf(id)) : ''}</div>
      ${inVoice && !isMe ? volume : ''}
      ${S.friends.some((f) => f.id === id) ? `<div class="profile-box"><button class="btn primary" data-action="open-dm" data-user="${esc(id)}">Написать</button></div>` : ''}
      <div class="profile-box"><h5>ID</h5><div class="value">${esc(m.id)}</div></div>
    </div>`;
  showPopout(0, 0, html, 'profile-card');
}

function positionPopoutFor(el) {
  const r = el.getBoundingClientRect();
  const po = $('.popout');
  if (!po) return;
  const w = po.offsetWidth, h = po.offsetHeight;
  po.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  po.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8))}px`;
}

/* ------------------------------------------------------------------ */
/* Обработчики событий                                                 */
/* ------------------------------------------------------------------ */
function bindUI() {
  // Экран входа / регистрации
  const defaultServer = (window.RAUT_DEFAULT_SERVER || '').replace(/\/+$/, '');
  byId('colorPicker').innerHTML = COLORS.map((c) => `<button class="swatch ${S.settings.color === c ? 'selected' : ''}" data-c="${c}" style="background:${c};color:${c}"></button>`).join('');
  byId('colorPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    S.settings.color = b.dataset.c; saveSettings();
    $$('#colorPicker .swatch').forEach((x) => x.classList.toggle('selected', x === b));
  });
  byId('connectName').value = S.settings.name || '';
  byId('authLogin').value = S.settings.login || '';
  byId('connectUrl').value = S.settings.serverUrl || defaultServer || location.origin;

  function setAuthMode(mode) {
    S.authMode = mode === 'register' ? 'register' : 'login';
    $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.authMode));
    const reg = S.authMode === 'register';
    byId('authTitle').textContent = reg ? 'Регистрация' : 'С возвращением!';
    byId('authSubtitle').textContent = reg
      ? 'Придумайте логин и пароль — друзья найдут вас по логину.'
      : 'Введите логин и пароль — друзья и чаты уже ждут вас.';
    byId('authNameField').classList.toggle('hidden', !reg);
    byId('authColorField').classList.toggle('hidden', !reg);
    byId('connectBtn').innerHTML = reg ? 'Зарегистрироваться <span class="btn-arrow">→</span>' : 'Войти <span class="btn-arrow">→</span>';
    byId('authPassword').autocomplete = reg ? 'new-password' : 'current-password';
    byId('swapMode').textContent = reg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
    byId('connectError').classList.add('hidden');
  }
  $$('.auth-tab').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));
  byId('swapMode').onclick = () => setAuthMode(S.authMode === 'register' ? 'login' : 'register');

  function submitAuth(guest = false) {
    const err = byId('connectError');
    const url = byId('connectUrl').value.trim().replace(/\/+$/, '');
    let payload;
    if (guest) {
      payload = { t: 'auth', mode: 'guest', name: byId('connectName').value.trim() || 'Гость', color: S.settings.color };
    } else {
      const login = byId('authLogin').value.trim().toLowerCase();
      const password = byId('authPassword').value;
      const name = byId('connectName').value.trim();
      if (!login || !password) { err.textContent = 'Введите логин и пароль'; err.classList.remove('hidden'); return; }
      if (S.authMode === 'register' && !/^[a-z0-9_.-]{3,24}$/.test(login)) { err.textContent = 'Логин: 3–24 символа — латиница, цифры, . - _'; err.classList.remove('hidden'); return; }
      if (S.authMode === 'register' && password.length < 6) { err.textContent = 'Пароль должен быть не короче 6 символов'; err.classList.remove('hidden'); return; }
      payload = S.authMode === 'register'
        ? { t: 'auth', mode: 'register', login, password, name, color: S.settings.color }
        : { t: 'auth', mode: 'login', login, password };
      S.settings.login = login;
    }
    S.settings.name = payload.name || S.settings.name;
    S.settings.serverUrl = url && url !== location.origin ? url : '';
    saveSettings();
    if (S.settings.serverUrl) {
      // Hash не передаётся в HTTP-запросе: данные входа попадают только в новый origin.
      location.href = S.settings.serverUrl + '/#raut=' + encodeURIComponent(JSON.stringify(payload));
      return;
    }
    err.classList.add('hidden');
    S.authPending = payload;
    startSession();
  }
  byId('connectBtn').onclick = () => submitAuth(false);
  byId('guestBtn').onclick = () => submitAuth(true);
  [byId('authLogin'), byId('authPassword'), byId('connectName'), byId('connectUrl')].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') byId('connectBtn').click(); });
  });
  setAuthMode('login');

  // Клик по всему приложению (делегирование)
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const actionEl = t.closest('[data-action]');
    const action = actionEl?.dataset.action;

    if (t.closest('[data-guild]')) {
      const id = t.closest('[data-guild]').dataset.guild;
      S.activeGuildId = id === 'home' ? (S.guilds[0]?.id || '@home') : id;
      if (isHome()) S.activeChannelId = null;
      else {
        const g = activeGuild();
        S.activeChannelId = g.channels.find((c) => c.type === 'text')?.id || g.channels[0]?.id;
      }
      S.unread.delete(S.activeChannelId);
      renderAll();
      return;
    }
    if (t.closest('[data-channel]') && !action) {
      const node = t.closest('[data-channel]');
      const ch = node.dataset.channel;
      if (node.dataset.type === 'voice') { await joinVoice(ch); return; }
      S.activeChannelId = ch; S.unread.delete(ch);
      renderAll();
      return;
    }
    if (t.closest('[data-member]') && !action) {
      const node = t.closest('[data-member]');
      const id = node.dataset.member;
      if (!id) return;
      openProfile(id);
      positionPopoutFor(node);
      const vol = byId('peerVolume');
      if (vol) vol.oninput = () => S.rtc?.setPeerVolume(id, Number(vol.value));
      return;
    }
    const msgNode = t.closest('[data-msg]');
    if (action === 'reply' && msgNode) {
      const m = (S.messages[S.activeChannelId] || []).find((x) => x.id === msgNode.dataset.msg);
      if (m) {
        S.replying = m;
        byId('replyPreview').innerHTML = `<span>Ответ для <strong>${esc(m.authorName)}</strong>: ${esc(m.text.slice(0, 80))}</span><button class="icon-btn" id="cancelReply">${icon('x')}</button>`;
        byId('replyPreview').classList.remove('hidden');
        byId('cancelReply').onclick = () => { S.replying = null; byId('replyPreview').classList.add('hidden'); };
        byId('messageInput').focus();
      }
      return;
    }
    if (action === 'copy-msg' && msgNode) {
      const m = (S.messages[S.activeChannelId] || []).find((x) => x.id === msgNode.dataset.msg);
      if (m) { navigator.clipboard?.writeText(m.text).then(() => toast('Текст скопирован'), () => {}); }
      return;
    }
    if (!action) return;
    closePopout();
    switch (action) {
      case 'show-friends': S.activeGuildId = '@home'; S.activeChannelId = null; renderAll(); break;
      case 'add-friend': openAddFriend(); break;
      case 'set-game': openSetGame(); break;
      case 'friend-accept':
      case 'friend-decline':
      case 'friend-remove': {
        const uid2 = actionEl.dataset.user;
        if (uid2) S.net?.send({ t: action, userId: uid2 });
        break;
      }
      case 'open-dm': {
        const uid2 = actionEl.dataset.user;
        if (uid2) S.net?.send({ t: 'dm-open', userId: uid2 });
        break;
      }
      case 'logout': {
        S.settings.token = ''; S.settings.login = ''; S.authPending = null;
        saveSettings();
        leaveShell('');
        byId('authPassword').value = '';
        break;
      }
      case 'about': openSettings('about'); break;
      case 'settings': openSettings('profile'); break;
      case 'voice-settings': openSettings('voice'); break;
      case 'mute': setMuted(!S.muted); break;
      case 'deafen': setDeafened(!S.deafened); break;
      case 'leave-voice': leaveVoice(); break;
      case 'toggle-share': toggleShare(); break;
      case 'stop-share': S.rtc?.stopShare(); break;
      case 'toggle-members': S.memberListVisible = !S.memberListVisible; renderHeader(); break;
      case 'search': openSearch(); break;
      case 'my-profile': {
        const node = t.closest('.me');
        openProfile(S.me?.id); positionPopoutFor(node); break;
      }
      case 'fullscreen': {
        const v = $(`[data-video="${actionEl.dataset.peer}"]`);
        if (v?.requestFullscreen) v.requestFullscreen().catch(() => {});
        break;
      }
      case 'mute-tile': {
        const v = $(`[data-video="${actionEl.dataset.peer}"]`);
        if (v) { v.muted = !v.muted; actionEl.classList.toggle('active', v.muted); toast(v.muted ? 'Звук трансляции выключен' : 'Звук трансляции включён'); }
        break;
      }
      default: break;
    }
  });

  // Меню шапки сервера
  byId('guildHeader').addEventListener('click', () => {
    showPopout(250, 55, `
      <button class="po-item" data-action="set-game">${icon('monitor')} Во что играю</button>
      <button class="po-item" data-action="settings">${icon('gear')} Настройки</button>
      <button class="po-item" data-action="about">${icon('info')} О программе</button>`, '');
    const po = $('.popout');
    if (po) { po.style.left = '250px'; po.style.top = '52px'; }
  });

  // Отправка сообщений
  byId('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = byId('messageInput');
    const text = input.value.trim();
    if (!text || !S.activeChannelId) return;
    const prefix = S.replying ? `> @${S.replying.authorName}: ${S.replying.text.slice(0, 100)}\n` : '';
    const payload = { t: 'chat', channelId: S.activeChannelId, text: prefix + text, attachment: null };
    if (S.pendingAttachment) payload.attachment = S.pendingAttachment;
    S.net.send(payload);
    input.value = ''; S.replying = null; S.pendingAttachment = null;
    byId('replyPreview').classList.add('hidden');
    byId('emojiPicker').classList.add('hidden');
  });
  byId('messageInput').addEventListener('input', () => {
    const now = Date.now();
    if (!S.lastTyping || now - S.lastTyping > 2500) {
      S.lastTyping = now;
      S.net?.send({ t: 'typing', channelId: S.activeChannelId });
    }
  });
  const EMOJIS = ['😀','😂','😍','🤔','👍','👎','🎉','🔥','💜','🚀','👋','😎','🥳','😭','🙏','💪','✅','⚡','🎧','🎮','🖥️','❤️','☕','🐱','🌟','😅','🤝','📌','💡','🎵','🍕','🛠️','😴','🤖','🫶','👀','💯','🎯','🧊','🍀','🦊','🐻','🌈','☀️','🌙','⭐','🏆','📎','🔒'];
  byId('emojiPicker').innerHTML = EMOJIS.map((x) => `<button type="button" data-emoji="${x}">${x}</button>`).join('');
  byId('emojiBtn').onclick = () => byId('emojiPicker').classList.toggle('hidden');
  byId('emojiPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]'); if (!b) return;
    const input = byId('messageInput');
    input.value += b.dataset.emoji; input.focus();
    byId('emojiPicker').classList.add('hidden');
  });
  byId('attachBtn').onclick = () => byId('fileInput').click();
  byId('fileInput').addEventListener('change', async () => {
    const file = byId('fileInput').files?.[0];
    if (!file) return;
    if (file.size > (S.config.maxUpload || 15 * 1024 * 1024)) return toast('Файл больше 15 МБ', 'error');
    const data = await new Promise((resolve) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(file);
    });
    try {
      const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      S.pendingAttachment = { url: j.url, name: j.name, size: j.size, type: j.type };
      toast(`Файл «${j.name}» прикреплён — нажмите Отправить`, 'success');
    } catch (err) { toast('Ошибка загрузки: ' + err.message, 'error'); }
    byId('fileInput').value = '';
  });

  // Push-to-talk и жесты для автовоспроизведения
  document.addEventListener('keydown', (e) => {
    if (!S.settings.ptt || e.code !== 'Space' || e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || byId('modalRoot').innerHTML) return;
    e.preventDefault(); setMuted(false);
  });
  document.addEventListener('keyup', (e) => {
    if (!S.settings.ptt || e.code !== 'Space') return;
    setMuted(true);
  });
  document.addEventListener('pointerdown', () => S.rtc?.resumeAudioContext(), { once: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Raut'; });
}

/* ------------------------------------------------------------------ */
/* Запуск                                                              */
/* ------------------------------------------------------------------ */
function readHash() {
  const m = /^#raut=(.*)$/.exec(location.hash);
  if (!m) return;
  try {
    const d = JSON.parse(decodeURIComponent(m[1]));
    if (d?.t === 'auth') {
      S.authPending = d;
      if (d.name) S.settings.name = d.name;
      if (d.color) S.settings.color = d.color;
      if (d.login) S.settings.login = d.login;
    } else {
      if (d.n) S.settings.name = d.n;
      if (d.c) S.settings.color = d.c;
    }
    S.settings.serverUrl = '';   // мы уже на целевом сервере
    saveSettings();
    history.replaceState(null, '', location.pathname + location.search);
  } catch (_) { /* ignore */ }
}

function boot() {
  readHash();
  bindUI();
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    S.config.installer = cfg.installer || null;
    S.config.portable = cfg.portable || null;
    if (cfg.publicUrl) S.config.publicUrl = cfg.publicUrl;
    renderDownloadLinks();
  }).catch(() => {});
  if (S.authPending || S.settings.token) startSession();
  else byId('connectScreen').classList.remove('hidden');
}

boot();
