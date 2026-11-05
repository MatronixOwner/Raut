/** Чистые HTML-представления. Никакой логики — только разметка по состоянию. */

import { icon } from './icons.js';
import { avatar, clock, dayLabel, escapeAttr, escapeHtml, formatMessage, relTime } from './ui.js';
import { formatBytes, formatDuration } from './audio.js';

export const STATUS_LABEL = {
  online: 'в сети',
  idle: 'неактивен',
  dnd: 'не беспокоить',
  offline: 'не в сети',
  invisible: 'невидимка',
};

/* ---------------------------------------------------------------- auth */

export function authView(state, mode, err) {
  const art = `
    <div class="auth-art">
      <svg class="auth-mesh" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#a273ff" stop-opacity=".8"/>
            <stop offset="1" stop-color="#ff7ab8" stop-opacity=".2"/>
          </linearGradient>
        </defs>
        ${Array.from({ length: 26 }, (_, i) => {
          const x = 40 + ((i * 137) % 520);
          const y = 60 + ((i * 219) % 700);
          return `<circle cx="${x}" cy="${y}" r="${2 + (i % 3)}" fill="url(#lg)"/>`;
        }).join('')}
        ${Array.from({ length: 16 }, (_, i) => {
          const x1 = 40 + ((i * 137) % 520);
          const y1 = 60 + ((i * 219) % 700);
          const j = (i + 3) % 26;
          const x2 = 40 + ((j * 137) % 520);
          const y2 = 60 + ((j * 219) % 700);
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#lg)" stroke-opacity=".18" stroke-width="1"/>`;
        }).join('')}
      </svg>
      <div style="position:relative">
        <h1>Голос, который<br><em>слышно</em>.</h1>
        <p>Raut — открытый мессенджер для своих: серверы, каналы, личные звонки и переписка.
        Собственный сервер, сквозное шифрование, никаких лишних людей.</p>
        <div class="marks">
          <div class="mark">${icon('shieldCheck', 'sm')}<span><b>E2E</b> шифрование</span></div>
          <div class="mark">${icon('activity', 'sm')}<span><b>GTCRN</b> нейро-шумодав</span></div>
          <div class="mark">${icon('server', 'sm')}<span><b>Ваш</b> сервер</span></div>
        </div>
      </div>
    </div>`;

  const tab = (id, label) =>
    `<button class="${mode === id ? 'on' : ''}" data-mode="${id}">${label}</button>`;

  const form =
    mode === 'register'
      ? `
      <div class="field">
        <label>Имя пользователя</label>
        <input name="username" autocomplete="username" placeholder="например, nikita" />
        <div class="hint">латиница, цифры, _ . - · от 3 до 24 символов</div>
      </div>
      <div class="field">
        <label>Как вас называть</label>
        <input name="displayName" autocomplete="nickname" placeholder="Никита" />
      </div>
      <div class="field">
        <label>Пароль</label>
        <div class="wrap"><input name="password" type="password" autocomplete="new-password" placeholder="минимум 8 символов" /></div>
        <div class="hint" data-strength></div>
      </div>
      <div class="field">
        <label>Повторите пароль</label>
        <input name="password2" type="password" autocomplete="new-password" placeholder="ещё раз" />
        <div class="hint" data-match></div>
      </div>`
      : `
      <div class="field">
        <label>Имя пользователя</label>
        <input name="username" autocomplete="username" placeholder="ваше имя" />
      </div>
      <div class="field">
        <label>Пароль</label>
        <input name="password" type="password" autocomplete="current-password" placeholder="ваш пароль" />
      </div>`;

  return `
  <div class="auth">
    ${art}
    <div class="auth-form-wrap">
      <div class="auth-card">
        <div class="logo">
          <div class="mark-box">R</div>
          <div><b style="font-size:18px">Raut</b><div class="small muted">версия ${escapeHtml(state.version || '0.1.0')}</div></div>
        </div>
        <div class="tabs">${tab('login', 'Вход')}${tab('register', 'Регистрация')}</div>
        <h2>${mode === 'register' ? 'Создать аккаунт' : 'С возвращением'}</h2>
        <p class="sub">${mode === 'register' ? 'Пара кликов — и можно звать своих.' : 'Войдите, чтобы продолжить общение.'}</p>
        <div class="server-url-row">${icon('server', 'sm')} Сервер: <b>${escapeHtml(state.serverLabel || '')}</b>
          <button class="btn link" data-change-server style="margin-left:auto;font-size:12px">сменить</button></div>
        ${err ? `<div class="form-err">${escapeHtml(err)}</div>` : ''}
        <form data-auth-form novalidate>
          ${form}
          <button class="btn block" type="submit" style="margin-top:6px" ${state.authBusy ? 'disabled' : ''}>
            ${state.authBusy ? '<span class="spinner"></span>' : icon(mode === 'register' ? 'sparkles' : 'logOut', 'sm')}
            ${mode === 'register' ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        <p class="form-note">${icon('lock', 'sm')} Ключи шифрования создаются на этом устройстве и никуда не отправляются.
        Данные хранятся на вашем сервере Raut.</p>
        ${state.firstRun ? `<p class="form-note" style="color:var(--accent-3)">Похоже, вы первый на этом сервере — регистрация открыта.</p>` : ''}
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- rail */

export function railView(state) {
  const s = state;
  const pills = [];

  pills.push(`
    <button class="pill home ${s.view.type === 'home' ? 'active' : ''}" data-act="home" title="Личные сообщения">
      <span class="pill-bar"></span>
      R
      <span class="rail-tip">Личные сообщения</span>
    </button>
    <div class="rail-sep"></div>`);

  for (const server of s.servers) {
    const active = s.view.serverId === server.id;
    const unread = server.channels.reduce((n, c) => n + (s.unread[c.id] || 0), 0);
    const voiceHere = server.channels.some((c) => c.type === 'voice' && s.voiceMembers[c.id]?.size);
    const initials = escapeHtml(server.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join(''));
    const style = server.icon
      ? `background-image:url('${escapeAttr(server.icon)}')`
      : `background:radial-gradient(circle at 30% 25%, rgba(255,255,255,.18), transparent 55%), ${color(server.id)}`;
    pills.push(`
      <button class="pill server-pill ${server.icon ? 'has-icon' : ''} ${active ? 'active' : ''} ${voiceHere ? 'voice-on' : ''}"
        data-act="server" data-id="${server.id}" style="${style}" title="${escapeAttr(server.name)}">
        <span class="pill-bar"></span>
        ${server.icon ? '' : initials}
        ${unread ? `<span class="pill-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
        <span class="rail-tip">${escapeHtml(server.name)}</span>
      </button>`);
  }

  pills.push(`
    <button class="pill add" data-act="create-server" title="Создать сервер">
      ${icon('plus')}
      <span class="rail-tip">Создать сервер</span>
    </button>`);

  return `
  <nav class="rail" aria-label="Серверы">
    ${pills.join('')}
    <div class="rail-spacer"></div>
    <button class="pill dm-pill" data-act="join-invite" title="Войти по приглашению">
      ${icon('link', 'sm')}
      <span class="rail-tip">По приглашению</span>
    </button>
    <button class="pill dm-pill" data-act="settings" title="Настройки">
      ${icon('settings', 'sm')}
      <span class="rail-tip">Настройки</span>
    </button>
  </nav>`;
}

function color(seed) {
  const palette = ['#4a3a63', '#3f4a70', '#5a3f66', '#3d5a55', '#5c4a35', '#4b3f5f'];
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

/* -------------------------------------------------------------- sidebar */

function presenceOf(state, userId) {
  return state.presence[userId]?.status || 'offline';
}

function sortedDms(state) {
  return [...state.dms].sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
}

export function sidebarView(state) {
  if (state.view.type === 'home') return homeSidebar(state);
  const server = state.servers.find((x) => x.id === state.view.serverId);
  if (!server) return homeSidebar(state);
  return serverSidebar(state, server);
}

function selfFooter(state) {
  const me = state.me;
  const st = presenceOf(state, me.id) || 'online';
  return `
  <div class="side-foot">
    <div class="self" data-act="self-card">
      ${avatar(me, 32, { status: st })}
      <div class="self-name">
        <b>${escapeHtml(me.displayName)}</b>
        <span>${escapeHtml(me.username)}</span>
      </div>
    </div>
    <button class="icon-btn ${state.voice.muted ? 'danger-on' : ''}" data-act="toggle-mute" title="Микрофон (Ctrl+Shift+M)">
      ${icon(state.voice.muted ? 'micOff' : 'mic', 'sm')}
    </button>
    <button class="icon-btn ${state.voice.deafened ? 'danger-on' : ''}" data-act="toggle-deafen" title="Наушники (Ctrl+Shift+D)">
      ${icon(state.voice.deafened ? 'headphonesOff' : 'headphones', 'sm')}
    </button>
    <button class="icon-btn ${state.voice.channelId ? 'on' : ''}" data-act="settings" title="Настройки">
      ${icon('settings', 'sm')}
    </button>
  </div>`;
}

function homeSidebar(state) {
  const dms = sortedDms(state);
  const items = dms
    .map((dm) => {
      const active = state.view.type === 'dm' && state.view.id === dm.channelId;
      const u = dm.user;
      if (!u) return '';
      const unread = state.unread[dm.channelId] || 0;
      return `
      <button class="side-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}" data-act="open-dm" data-id="${dm.channelId}" data-user="${u.id}">
        ${avatar(u, 32, { status: presenceOf(state, u.id) })}
        <span class="name">${escapeHtml(u.displayName)}</span>
        ${unread ? `<span class="count">${unread > 99 ? '99+' : unread}</span>` : ''}
      </button>`;
    })
    .join('');

  return `
  <aside class="side">
    <div class="side-head" data-act="home">
      <div class="side-title"><b>Личные сообщения</b><span>${dms.length} ${plural(dms.length, 'диалог', 'диалога', 'диалогов')}</span></div>
      ${icon('chevronDown', 'sm muted')}
    </div>
    <div class="side-scroll">
      <button class="side-item" data-act="find-user">${icon('search', 'sm')}<span class="name">Найти человека</span></button>
      <button class="side-item" data-act="join-invite">${icon('link', 'sm')}<span class="name">Войти по приглашению</span></button>
      <button class="side-item" data-act="create-server">${icon('plus', 'sm')}<span class="name">Создать сервер</span></button>
      <div class="side-group">
        <div class="side-group-head"><span class="grow">Диалоги</span>
          <button data-act="find-user" title="Начать диалог">${icon('plus', 'sm')}</button></div>
        <div class="side-group-body">
          ${items || `<div class="muted small" style="padding:8px 10px">Пока никого. Найдите человека по имени — и начните переписку.</div>`}
        </div>
      </div>
      ${voiceSidebarGlobal(state)}
    </div>
    ${selfFooter(state)}
  </aside>`;
}

function voiceSidebarGlobal(state) {
  return '';
}

function serverSidebar(state, server) {
  const text = server.channels.filter((c) => c.type === 'text');
  const voice = server.channels.filter((c) => c.type === 'voice');
  const canManage = server.role === 'owner';
  const group = (title, list, kind) => `
    <div class="side-group">
      <div class="side-group-head">
        <span class="grow">${title}</span>
        ${canManage ? `<button data-act="create-channel" data-kind="${kind}" title="Создать канал">${icon('plus', 'sm')}</button>` : ''}
      </div>
      <div class="side-group-body">
        ${list
          .map((c) => {
            const active = state.view.id === c.id && state.view.type === (kind === 'voice' ? 'voice' : 'channel');
            const unread = state.unread[c.id] || 0;
            const joinedHere = state.voice.channelId === c.id;
            const people = kind === 'voice' ? [...(state.voiceMembers[c.id]?.values() || [])] : [];
            return `
            <button class="side-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}" data-act="${kind === 'voice' ? 'open-voice' : 'open-text'}" data-id="${c.id}" data-server="${server.id}">
              <span class="hash">${kind === 'voice' ? icon('volume', 'sm') : '#'}</span>
              <span class="name">${escapeHtml(c.name)}</span>
              ${unread ? `<span class="count">${unread > 99 ? '99+' : unread}</span>` : ''}
              ${joinedHere ? `<span class="pill-tag">вы</span>` : ''}
            </button>
            ${people.length
              ? `<div style="padding:2px 0 6px 30px;display:flex;flex-direction:column;gap:3px">
                  ${people
                    .map((p) => {
                      const u = state.authors[p.userId] || state.memberIndex[p.userId] || { displayName: p.displayName };
                      return `<div class="small" style="display:flex;align-items:center;gap:6px;color:var(--fg-dim)">
                        ${avatar(u, 18, { speaking: p.voice?.speaking, status: null })}
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.displayName || u.displayName || '')}</span>
                        ${p.voice?.mute ? icon('micOff', 'sm') : ''}
                        ${p.voice?.video || p.voice?.screen ? icon('camera', 'sm') : ''}
                      </div>`;
                    })
                    .join('')}
                </div>`
              : ''}`;
          })
          .join('')}
      </div>
    </div>`;

  return `
  <aside class="side">
    <div class="side-head" data-act="server-menu">
      <div class="side-title"><b>${escapeHtml(server.name)}</b>
        <span>${server.memberCount} ${plural(server.memberCount, 'участник', 'участника', 'участников')}</span></div>
      ${icon('chevronDown', 'sm muted')}
    </div>
    <div class="side-scroll">
      ${group('Текстовые', text, 'text')}
      ${group('Голосовые', voice, 'voice')}
      <div class="side-group">
        <div class="side-group-head"><span class="grow">Приглашение</span></div>
        <div class="side-group-body" style="padding:2px 8px">
          <div class="mono-box" style="font-size:12px;display:flex;align-items:center;gap:6px">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(server.inviteCode || '—')}</span>
            <button class="icon-btn" data-act="copy-invite" data-code="${escapeAttr(server.inviteCode || '')}" title="Скопировать код">
              ${icon('copy', 'sm')}</button>
          </div>
          <button class="btn ghost sm block" style="margin-top:6px" data-act="share-invite">
            ${icon('link', 'sm')} Поделиться
          </button>
        </div>
      </div>
    </div>
    ${selfFooter(state)}
  </aside>`;
}

/* ---------------------------------------------------------------- main */

export function mainView(state) {
  if (state.view.type === 'voice') return voiceView(state);
  if (state.view.type === 'dm') return dmView(state);
  const server = state.servers.find((x) => x.id === state.view.serverId);
  const channel = server?.channels.find((c) => c.id === state.view.id);
  if (!channel) return homeMain(state);

  const locked = state.keyErrors[channel.id];
  return `
  <main class="main">
    ${topbar(state, '#' + ' ' + escapeHtml(channel.name), channel.topic || 'Здесь начинается разговор', {
      lock: !!locked,
      serverId: server.id,
      channelId: channel.id,
      members: true,
    })}
    <div class="messages" data-scroll="messages">
      ${messagesView(state, channel.id, channel.name)}
    </div>
    <div class="typing" data-typing="${channel.id}">${typingView(state, channel.id)}</div>
    ${composerView(state, channel.id, locked ? '<span class="enc-badge locked">Ключ канала ещё не получен — писать нельзя</span>' : '')}
  </main>`;
}

function homeMain(state) {
  return `
  <main class="main">
    <div class="topbar">
      <h1>Личные сообщения</h1>
      <span class="topic">Сквозное шифрование · соединение ${state.connection === 'ready' ? 'активно' : state.connection}</span>
      <div class="actions">
        <button class="icon-btn" data-act="find-user" title="Найти человека">${icon('search')}</button>
      </div>
    </div>
    <div class="welcome">
      <div class="welcome-hero">
        <div class="welcome-badge">R</div>
        <h2>Свои — рядом</h2>
        <p>Выберите диалог слева или найдите человека по имени. Всё, что здесь написано,
        шифруется на этом устройстве и расшифровывается только у получателя.</p>
        <div class="chips">
          <span class="chip">${icon('shieldCheck', 'sm')} <b>E2E</b> AES-256-GCM</span>
          <span class="chip">${icon('activity', 'sm')} <b>GTCRN</b> шумоподавление</span>
          <span class="chip">${icon('phone', 'sm')} <b>Звонки</b> WebRTC</span>
          <span class="chip">${icon('server', 'sm')} сервер: <b>${escapeHtml(state.serverLabel)}</b></span>
        </div>
      </div>
    </div>
  </main>`;
}

function topbar(state, title, topic, opts = {}) {
  return `
  <div class="topbar">
    <button class="icon-btn side-toggle" data-act="toggle-side" aria-label="Каналы и серверы">${icon('menu', 'sm')}</button>
    <span class="hash">${title.replace(/^#\s/, '#')}</span>
    <span class="topic">${topic}</span>
    <div class="actions">
      ${opts.lock ? `<span class="pill-tag warn" title="Ключ канала не получен">${icon('lock', 'sm')} закрыто</span>` : `<span class="pill-tag" title="Сквозное шифрование">${icon('shieldCheck', 'sm')} E2E</span>`}
      ${opts.members ? `<button class="icon-btn" data-act="toggle-members" title="Участники">${icon('users')}</button>` : ''}
      ${opts.channelId ? `<button class="icon-btn" data-act="channel-menu" data-id="${opts.channelId}" title="Ещё">${icon('settings')}</button>` : ''}
    </div>
  </div>`;
}

/* ------------------------------------------------------------- messages */

export function messagesView(state, channelId, fallbackName) {
  const box = state.channels[channelId];
  if (!box?.loaded) {
    return `<div class="empty-state"><div><div class="spinner" style="margin:0 auto 12px"></div><div class="small">Расшифровываем историю…</div></div></div>`;
  }
  const list = box.messages || [];
  if (!list.length) {
    return `<div class="empty-state"><div>
      <div class="big">${icon('sparkles', 'lg')}</div>
      <b style="color:var(--fg)">Это начало канала #${escapeHtml(fallbackName || '')}</b>
      <div class="small" style="margin-top:6px">Первое сообщение — за вами.</div>
    </div></div>`;
  }

  const out = [];
  if (box.hasMore) {
    out.push(`<div class="center" style="padding:8px"><button class="btn ghost sm" data-act="load-more" data-id="${channelId}">${icon('chevronDown', 'sm')} Загрузить раньше</button></div>`);
  }
  let prev = null;
  let prevDay = null;
  for (const m of list) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== prevDay) {
      out.push(`<div class="day-sep">${dayLabel(m.createdAt)}</div>`);
      prevDay = day;
      prev = null;
    }
    if (m.kind === 'system') {
      out.push(`<div class="system-msg">${escapeHtml(m.system || '')}</div>`);
      prev = null;
      continue;
    }
    const author = state.authors[m.authorId] || box.authors?.[m.authorId] || { displayName: '', id: m.authorId };
    const grouped = prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < 5 * 60 * 1000;
    const mine = m.authorId === state.me?.id;
    const body = messageBody(m, state, channelId);
    const actions = `
      <div class="msg-actions">
        <button data-act="copy-msg" data-id="${m.id}" title="Скопировать текст">${icon('copy', 'sm')}</button>
        ${mine ? `<button data-act="delete-msg" data-id="${m.id}" title="Удалить">${icon('trash', 'sm')}</button>` : ''}
      </div>`;
    if (grouped) {
      out.push(`
        <div class="msg-group ${m._gone ? 'gone' : ''}" data-msg="${m.id}">
          ${actions}
          <div class="msg-row">
            <div class="gutter"><span class="time-hover">${clock(m.createdAt)}</span></div>
            <div class="content">${body}</div>
          </div>
        </div>`);
    } else {
      out.push(`
        <div class="msg-group first ${m._gone ? 'gone' : ''}" data-msg="${m.id}">
          ${actions}
          <div class="msg-row">
            <div class="gutter">${avatar(author, 40, { status: presenceOf(state, m.authorId) })}</div>
            <div class="content">
              <div class="msg-head">
                <span class="author" data-act="user-card" data-id="${m.authorId}">${escapeHtml(author.displayName || author.username || '?')}</span>
                ${isOwnerOf(state, m.authorId, channelId) ? `<span class="role">владелец</span>` : ''}
                <span class="time">${clock(m.createdAt)}</span>
              </div>
              ${body}
            </div>
          </div>
        </div>`);
    }
    prev = m;
  }
  out.push(`<div data-bottom-anchor></div>`);
  return out.join('');
}

function isOwnerOf(state, userId, channelId) {
  const channel = findChannel(state, channelId);
  if (!channel?.serverId) return false;
  const server = state.servers.find((s) => s.id === channel.serverId);
  return server?.ownerId === userId;
}

function findChannel(state, channelId) {
  for (const s of state.servers) {
    const c = s.channels.find((x) => x.id === channelId);
    if (c) return c;
  }
  return state.dms.find((d) => d.channelId === channelId) ? { id: channelId, kind: 'dm' } : null;
}

function messageBody(m, state, channelId) {
  if (m._locked) {
    return `<div class="msg-body" style="color:var(--warn);display:flex;align-items:center;gap:6px">${icon('lock', 'sm')} сообщение недоступно: нет ключа канала</div>`;
  }
  const text = m._text ?? '';
  const { html, emojiOnly } = formatMessage(text);
  const parts = [];
  if (text) parts.push(`<div class="msg-body ${emojiOnly ? 'emoji-only' : ''}">${html}</div>`);
  if (m._attach) {
    const a = m._attach;
    if (a.status === 'loading') {
      parts.push(`<div class="attach-file"><span class="spinner"></span><div class="meta"><b>Расшифровываем файл…</b><small>${escapeHtml(a.name || '')}</small></div></div>`);
    } else if (a.status === 'error') {
      parts.push(`<div class="attach-file" style="border-color:rgba(255,93,108,.4)">${icon('alert', 'sm')}<div class="meta"><b>Файл недоступен</b><small>${escapeHtml(a.name || '')}</small></div></div>`);
    } else if (a.type === 'image') {
      parts.push(`<img class="attach-img" src="${escapeAttr(a.url)}" alt="${escapeAttr(a.name || 'изображение')}" data-act="lightbox" data-src="${escapeAttr(a.url)}" />`);
    } else if (a.type === 'audio') {
      parts.push(`<audio class="attach-audio" controls src="${escapeAttr(a.url)}"></audio>`);
    } else if (a.type === 'video') {
      parts.push(`<video class="attach-img" controls src="${escapeAttr(a.url)}"></video>`);
    } else {
      parts.push(`<a class="attach-file" href="${escapeAttr(a.url)}" download="${escapeAttr(a.name || 'файл')}">
        ${icon('file', 'sm')}<div class="meta"><b>${escapeHtml(a.name || 'файл')}</b><small>${formatBytes(a.size || 0)}</small></div>
        ${icon('download', 'sm')}</a>`);
    }
  }
  return parts.join('') || '<div class="msg-body muted">пустое сообщение</div>';
}

export function typingView(state, channelId) {
  const map = state.typing[channelId];
  if (!map || !map.size) return '';
  const now = Date.now();
  const names = [...map.values()].filter((t) => t.until > now).map((t) => t.displayName);
  if (!names.length) return '';
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} и ${names[1]}` : `${names[0]} и ещё ${names.length - 1}`;
  return `${who} печатает<span class="dots"><i></i><i></i><i></i></span>`;
}

export function composerView(state, channelId, extraHint = '') {
  const locked = !!state.keyErrors[channelId];
  return `
  <div class="composer">
    <div class="composer-inner" data-composer="${channelId}">
      <button class="icon-btn" data-act="attach" title="Прикрепить файл" ${locked ? 'disabled' : ''}>${icon('plus')}</button>
      <textarea rows="1" maxlength="4000" placeholder="${locked ? 'Ожидаем ключ канала…' : `Написать в #${escapeHtml(channelName(state, channelId))}`}"
        data-input="${channelId}" ${locked ? 'disabled' : ''}></textarea>
      <button class="icon-btn" data-act="emoji" title="Эмодзи" ${locked ? 'disabled' : ''}>${icon('smile')}</button>
      <button class="icon-btn" data-act="send" data-id="${channelId}" title="Отправить (Enter)" ${locked ? 'disabled' : ''}>${icon('send')}</button>
    </div>
    <div class="composer-hint">
      <span>${locked ? '<span class="enc-badge locked">' + icon('lock', 'sm') + ' канал ждёт ключ</span>' : `<span class="enc-badge">${icon('shieldCheck', 'sm')} шифруется на устройстве</span>`} ${extraHint}</span>
      <span><kbd>Enter</kbd> отправить · <kbd>Shift+Enter</kbd> перенос · <kbd>Ctrl+K</kbd> поиск</span>
    </div>
  </div>`;
}

function channelName(state, channelId) {
  const c = findChannel(state, channelId);
  if (c?.name) return c.name;
  const dm = state.dms.find((d) => d.channelId === channelId);
  return dm?.user?.displayName || 'канал';
}

/* ------------------------------------------------------------------- dm */

function dmView(state) {
  const dm = state.dms.find((d) => d.channelId === state.view.id);
  if (!dm) return homeMain(state);
  const u = state.authors[dm.user.id] || dm.user || { id: '', displayName: 'Собеседник', username: '' };
  const st = presenceOf(state, dm.user?.id);
  return `
  <main class="main">
    <div class="topbar">
      ${avatar(u, 28, { status: st })}
      <h1>${escapeHtml(u.displayName)}</h1>
      <span class="topic">${STATUS_LABEL[st] || ''} · @${escapeHtml(u.username || '')}</span>
      <div class="actions">
        <button class="icon-btn" data-act="dm-call" data-audio title="Голосовой звонок">${icon('phone')}</button>
        <button class="icon-btn" data-act="dm-call" data-video title="Видеозвонок">${icon('camera')}</button>
        <button class="icon-btn" data-act="toggle-members" title="Профиль">${icon('info')}</button>
      </div>
    </div>
    <div class="messages" data-scroll="messages">
      ${messagesView(state, dm.channelId, u.displayName)}
    </div>
    <div class="typing" data-typing="${dm.channelId}">${typingView(state, dm.channelId)}</div>
    ${composerView(state, dm.channelId, '')}
  </main>`;
}

/* ---------------------------------------------------------------- voice */

export function voiceView(state) {
  const v = state.voice;
  const channel = v.channelId ? findChannel(state, v.channelId) : null;
  const participants = [...v.participants.values()];
  const tiles = [];

  if (v.channelId) {
    tiles.push(`
      <div class="video-tile self-tile ${v.speaking ? 'speaking' : ''} ${v.cameraOn || v.screenOn ? '' : 'empty'}" data-peer="self">
        <video data-self-video autoplay playsinline muted></video>
        <div class="vt-avatar">${avatar(state.me, 84, { speaking: v.speaking })}</div>
        <div class="vt-name">${escapeHtml(state.me.displayName)} ${v.muted ? `<span class="vt-mute">${icon('micOff', 'sm')}</span>` : ''}${v.screenOn ? `<span class="pill-tag">экран</span>` : ''}${v.micUnavailable ? '<span class="pill-tag warn">без микрофона</span>' : ''}</div>
      </div>`);
  }

  for (const p of participants) {
    const u = state.authors[p.userId] || { displayName: p.displayName, id: p.userId };
    const hasVideo = !!(p.videoStream || p.video);
    tiles.push(`
      <div class="video-tile ${hasVideo ? '' : 'empty'} ${p.voice?.speaking ? 'speaking' : ''}" data-peer="${p.connId}">
        <video data-peer-video="${p.connId}" autoplay playsinline></video>
        <div class="vt-avatar">${avatar(u, 84, { speaking: p.voice?.speaking, status: presenceOf(state, p.userId) })}</div>
        <div class="vt-name">${escapeHtml(p.displayName || u.displayName || 'Участник')}
          ${p.voice?.mute ? `<span class="vt-mute">${icon('micOff', 'sm')}</span>` : ''}
          ${p.voice?.screen ? `<span class="pill-tag">экран</span>` : ''}
          ${p.state && p.state !== 'connected' ? `<span class="pill-tag dim">${connectLabel(p.state)}</span>` : ''}
        </div>
      </div>`);
  }

  const status = v.joined ? 'connected' : 'idle';
  return `
  <main class="main">
    <div class="topbar">
      ${icon('volume')}
      <h1>${escapeHtml(channel?.name || v.channelName || 'Голос')}</h1>
      <span class="topic">${v.joined ? `в звонке ${formatDuration(Date.now() - v.startedAt)} · ${participants.length + 1} ${plural(participants.length + 1, 'участник', 'участника', 'участников')}` : 'голосовой канал Raut'}</span>
      <div class="actions">
        ${v.joined ? `<span class="pill-tag">${icon('shieldCheck', 'sm')} DTLS-SRTP</span>` : ''}
        <button class="icon-btn" data-act="toggle-members" title="Участники">${icon('users')}</button>
      </div>
    </div>
    <div class="call-stage">
      ${tiles.join('')}
      ${!v.joined ? `
        <div class="video-tile empty" style="aspect-ratio:16/10;min-height:220px;width:100%;max-width:520px">
          <div class="vt-head" style="bottom:auto"><b>${escapeHtml(channel?.name || 'Голосовой канал')}</b>
            ${v.joining ? 'Включаем микрофон…' : 'Микрофон включается только после вашего согласия'}</div>
          <div style="text-align:center;padding:48px 16px 20px">
            <div style="font-size:36px;margin-bottom:12px">${v.joining ? icon('activity', 'lg') : icon('phone', 'lg')}</div>
            <button class="btn" data-act="join-voice" ${v.joining ? 'disabled' : ''}>${icon('phone', 'sm')} ${v.joining ? 'Подключаемся' : 'Подключиться'}</button>
          </div>
        </div>` : ''}
      ${v.joined && !participants.length ? `<div class="video-tile empty"><div class="vt-head"><b>Пока никого</b>Позовите своих — позвоните в личку или скиньте приглашение</div></div>` : ''}
    </div>
    ${v.joined ? callBar(state) : ''}
  </main>`;
}

function connectLabel(state) {
  return { connecting: 'соединяемся', failed: 'нет связи', disconnected: 'обрыв' }[state] || state;
}

function callBar(state) {
  const v = state.voice;
  return `
  <div class="call-bar">
    <button class="call-btn ${v.muted ? 'on' : ''}" data-act="toggle-mute" title="Микрофон (Ctrl+Shift+M)">
      ${icon(v.muted ? 'micOff' : 'mic')}
    </button>
    <button class="call-btn ${v.deafened ? 'on' : ''}" data-act="toggle-deafen" title="Наушники (Ctrl+Shift+D)">
      ${icon(v.deafened ? 'headphonesOff' : 'headphones')}
    </button>
    <button class="call-btn ${v.cameraOn ? 'on' : ''}" data-act="toggle-camera" title="Камера">${icon(v.cameraOn ? 'camera' : 'cameraOff')}</button>
    <button class="call-btn ${v.screenOn ? 'on' : ''}" data-act="toggle-screen" title="Демонстрация экрана">${icon('monitorUp')}</button>
    <button class="call-btn" data-act="settings" title="Настройки звука">${icon('settings')}</button>
    <button class="call-btn hangup" data-act="hangup" title="Отключиться">${icon('phoneOff')}</button>
  </div>`;
}

/* -------------------------------------------------------------- members */

export function membersView(state) {
  const server = state.servers.find((s) => s.id === state.view.serverId);
  const members = server ? state.members[server.id] || [] : [];
  const online = members.filter((m) => presenceOf(state, m.id) !== 'offline');
  const offline = members.filter((m) => presenceOf(state, m.id) === 'offline');
  const voiceIds = new Set([...state.voice.participants.values()].map((p) => p.userId));

  const row = (m) => `
    <button class="member" data-act="user-card" data-id="${m.id}">
      ${avatar(m, 32, { status: presenceOf(state, m.id) })}
      <span class="nm"><b style="color:${m.id === state.me.id ? 'var(--accent)' : 'inherit'}">${escapeHtml(m.displayName)}</b>
        ${voiceIds.has(m.id) ? `<small class="member-voice">${icon('volume', 'sm')} в голосовом</small>` : `<small>@${escapeHtml(m.username)}</small>`}</span>
      ${m.role === 'owner' ? `<span class="owner-tag" title="Владелец">${icon('crown', 'sm')}</span>` : ''}
    </button>`;

  return `
  <aside class="members">
    <div class="row" style="padding:0 8px 8px">
      <b class="grow">${server ? escapeHtml(server.name) : 'Профиль'}</b>
      <span class="small muted">${members.length}</span>
    </div>
    ${online.length ? `<h3>В сети — ${online.length}</h3>${online.map(row).join('')}` : ''}
    ${offline.length ? `<h3>Не в сети — ${offline.length}</h3>${offline.map(row).join('')}` : ''}
    ${server?.role === 'owner' ? `<div style="padding:12px 8px"><button class="btn ghost sm block" data-act="server-settings">${icon('settings', 'sm')} Управление сервером</button></div>` : ''}
  </aside>`;
}

/* --------------------------------------------------------------- utils */

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export { relTime };
