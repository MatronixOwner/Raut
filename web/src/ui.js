/** Мелкие UI-помощники: тосты, модалки, аватары, меню, время. */

import { icon } from './icons.js';

/* --------------------------------------------------------------- toasts */

export function toast(message, kind = 'info', ms = 3400) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info', 'sm')}<span></span>`;
  el.querySelector('span').textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s ease, transform .2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/* --------------------------------------------------------------- avatars */

const COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#e91e63'];

export function colorFor(seed = '') {
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export function initials(name = '') {
  const clean = String(name || '').trim();
  if (!clean) return '·';
  const parts = clean.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function avatar(user, size = 38, { status = null, speaking = false, image = null } = {}) {
  const color = user?.avatarColor || colorFor(user?.id || user?.username || '');
  const label = initials(user?.displayName || user?.username || '');
  const fs = Math.round(size * 0.38);
  const img = image || user?.avatar;
  return `<span class="avatar ${speaking ? 'speaking' : ''}" style="width:${size}px;height:${size}px;font-size:${fs}px;background:${img ? 'transparent' : color}">
    ${img ? `<img src="${escapeAttr(img)}" alt="">` : escapeHtml(label)}
    ${status ? `<span class="status ${status}"></span>` : ''}
  </span>`;
}

export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s = '') {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

/* ---------------------------------------------------------------- modals */

let modalSeq = 0;

/**
 * Показывает модальное окно. Возвращает объект с close().
 * content: HTML-строка или (el) => void
 */
export function modal({ title = '', lead = '', body = '', actions = '', wide = false, closable = true, onMount }) {
  const id = `m${++modalSeq}`;
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.dataset.modalId = id;
  layer.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" style="position:relative">
      ${closable ? `<button class="icon-btn modal-close" data-close aria-label="Закрыть">${icon('x')}</button>` : ''}
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      ${lead ? `<p class="lead">${lead}</p>` : ''}
      <div class="modal-body">${body}</div>
      ${actions ? `<div class="modal-actions">${actions}</div>` : ''}
    </div>`;
  document.body.appendChild(layer);

  const close = () => {
    layer.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape' && closable) close();
  };
  document.addEventListener('keydown', onKey);
  layer.addEventListener('mousedown', (ev) => {
    if (ev.target === layer && closable) close();
  });
  layer.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const el = layer.querySelector('.modal');
  onMount?.(el, close);
  const firstInput = el.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
  return { el, close, layer };
}

export function confirmDialog({ title, message, confirmLabel = 'Подтвердить', danger = true }) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      lead: escapeHtml(message),
      actions: `
        <button class="btn ghost" data-no>Отмена</button>
        <button class="btn ${danger ? 'danger' : ''}" data-yes>${escapeHtml(confirmLabel)}</button>`,
      onMount(el, close) {
        el.querySelector('[data-no]').onclick = () => {
          close();
          resolve(false);
        };
        el.querySelector('[data-yes]').onclick = () => {
          close();
          resolve(true);
        };
      },
    });
    m.layer.addEventListener('click', (ev) => {
      if (ev.target === m.layer) resolve(false);
    });
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', multiline = false, confirmLabel = 'OK' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    modal({
      title,
      body: `
        ${label ? `<div class="field"><label>${escapeHtml(label)}</label>` : '<div class="field">'}
        ${multiline
          ? `<textarea class="textarea" rows="3" style="width:100%;padding:11px 13px;background:var(--bg-input);border:1px solid var(--line-strong);border-radius:10px;outline:none;resize:vertical">${escapeHtml(value)}</textarea>`
          : `<input type="text" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" />`}
        </div>`,
      actions: `<button class="btn ghost" data-cancel>Отмена</button><button class="btn" data-ok>${escapeHtml(confirmLabel)}</button>`,
      onMount(el, close) {
        const input = el.querySelector('input, textarea');
        const submit = () => {
          done(input.value.trim());
          close();
        };
        el.querySelector('[data-ok]').onclick = submit;
        el.querySelector('[data-cancel]').onclick = () => {
          done(null);
          close();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && !multiline) {
            ev.preventDefault();
            submit();
          }
        });
        setTimeout(() => {
          input.focus();
          input.select?.();
        }, 30);
      },
    });
  });
}

/* ------------------------------------------------------------------ menus */

export function contextMenu(items, x, y) {
  document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:300;background:var(--bg-panel);border:1px solid var(--line-strong);border-radius:10px;box-shadow:var(--shadow);padding:5px;min-width:180px;max-width:280px`;
  for (const item of items) {
    if (item.sep) {
      menu.insertAdjacentHTML('beforeend', '<div style="height:1px;background:var(--line);margin:4px 6px"></div>');
      continue;
    }
    const b = document.createElement('button');
    b.className = 'cmdk-item';
    b.style.cssText = 'width:100%;text-align:left;border:none;background:none;color:' + (item.danger ? 'var(--danger)' : 'var(--fg)');
    b.innerHTML = `${item.icon ? icon(item.icon, 'sm') : ''}<span>${escapeHtml(item.label)}</span>`;
    b.onclick = () => {
      menu.remove();
      item.onClick?.();
    };
    b.onmouseenter = () => (b.style.background = 'var(--bg-active)');
    b.onmouseleave = () => (b.style.background = 'none');
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
  const off = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('mousedown', off, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  return menu;
}

/* ------------------------------------------------------------------ time */

const pad = (n) => String(n).padStart(2, '0');

export function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Сегодня';
  if (same(d, yest)) return 'Вчера';
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const year = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${months[d.getMonth()]}${year}`;
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 45000) return 'только что';
  if (diff < 3600000) return `${Math.round(diff / 60000)} мин назад`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} ч назад`;
  return dayLabel(ts);
}

/* --------------------------------------------------------- message format */

const EMOJI_ONLY = /^(\p{Extended_Pictographic}|\uFE0F|\u200D|\s){1,12}$/u;

export function formatMessage(text) {
  let html = escapeHtml(text);
  // код `...`
  html = html.replace(/`([^`\n]{1,400})`/g, '<span class="code">$1</span>');
  // упоминания @имя
  html = html.replace(/(^|\s)@([\p{L}\p{N}_.-]{2,24})/gu, '$1<span class="mention">@$2</span>');
  // ссылки
  html = html.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  const emojiOnly = EMOJI_ONLY.test(text.trim()) && /\p{Extended_Pictographic}/u.test(text);
  return { html, emojiOnly };
}

/* -------------------------------------------------------------- utilities */

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 100) {
  let last = 0;
  let timer;
  return (...args) => {
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, wait);
    }
  };
}

export function uploadBar(percent, label = 'Загрузка…') {
  return `<div class="small muted" style="margin-top:6px">${escapeHtml(label)} ${Math.round(percent)}%</div><div class="upload-bar"><i style="width:${percent}%"></i></div>`;
}
