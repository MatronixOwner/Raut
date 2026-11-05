/** Тонкий клиент REST + WebSocket с автопереподключением и очередью сообщений. */

const LS = {
  server: 'raut.server',
  token: 'raut.token',
  identity: 'raut.identity',
  settings: 'raut.settings',
};

/* ------------------------------------------------------------------- IDB */
/* Ключи E2E — самое ценное, что есть на устройстве: без них не прочитать
   старые сообщения. Держим их в IndexedDB (надёжнее localStorage, не чистится
   вместе с «данными сайта» так легко) и дублируем в localStorage. */

const DB_NAME = 'raut';
const DB_STORE = 'kv';

function openDb() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const idb = {
  async get(key) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  },
  async set(key, value) {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  },
};

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* приватный режим / переполнение */ }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  },
};

export const KEYS = LS;

/* ------------------------------------------------------------------ server */

function defaultServer() {
  if (location.protocol === 'file:') return 'http://localhost:8787';
  return location.origin;
}

export function getServerUrl() {
  return (store.get(LS.server) || defaultServer()).replace(/\/+$/, '');
}

export function setServerUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  store.set(LS.server, clean || defaultServer());
  return clean || defaultServer();
}

export function httpBase() {
  const s = getServerUrl();
  if (/^https?:\/\//.test(s)) return s;
  if (/^(localhost|127\.|\[)/.test(s)) return `http://${s}`;
  return `https://${s}`;
}

export function wsUrl() {
  return httpBase().replace(/^http/, 'ws') + '/ws';
}

/* -------------------------------------------------------------------- REST */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function token() {
  return store.get(LS.token);
}

export async function api(method, path, body, opts = {}) {
  const headers = {};
  const tk = token();
  if (tk) headers.Authorization = `Bearer ${tk}`;
  let payload;
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(httpBase() + path, { method, headers, body: payload, signal: opts.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Сервер недоступен. Проверьте адрес и соединение.', 0);
  }
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) throw new ApiError(data.error || `Ошибка ${res.status}`, res.status);
  return data;
}

export const get = (p, opts) => api('GET', p, null, opts);
export const post = (p, b = {}, opts) => api('POST', p, b, opts);
export const patch = (p, b = {}, opts) => api('PATCH', p, b, opts);
export const put = (p, b = {}, opts) => api('PUT', p, b, opts);
export const del = (p, b = {}, opts) => api('DELETE', p, b, opts);

/* --------------------------------------------------------------- WebSocket */

export class Realtime {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.queue = [];
    this.attempt = 0;
    this.timer = null;
    this.heartbeat = null;
    this.manualClose = false;
    this.status = 'offline';
  }

  connect() {
    this.manualClose = false;
    this.#open();
  }

  #setStatus(s, detail) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s, detail);
  }

  #open() {
    clearTimeout(this.timer);
    const tk = token();
    if (!tk) {
      this.#setStatus('offline', 'нет входа');
      return;
    }
    let ws;
    try {
      ws = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(tk)}`);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.#setStatus(this.attempt ? 'reconnecting' : 'connecting');

    ws.onopen = () => {
      this.attempt = 0;
      this.#setStatus('online');
      ws.send(JSON.stringify({ t: 'hello', token: tk }));
      for (const msg of this.queue.splice(0)) this.#raw(msg);
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
      }, 25000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'auth:fail') {
        this.manualClose = true;
        this.#setStatus('unauthorized');
        this.onEvent({ t: 'session:expired' });
        return;
      }
      if (msg.t === 'ready') this.#setStatus('ready');
      this.onEvent(msg);
    };

    ws.onclose = (ev) => {
      clearInterval(this.heartbeat);
      if (this.manualClose) {
        this.#setStatus('offline');
        return;
      }
      this.#setStatus('reconnecting');
      this.onEvent({ t: 'ws:closed', code: ev.code });
      this.#scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose придёт следом — переподключимся там
    };
  }

  #scheduleReconnect() {
    clearTimeout(this.timer);
    const delay = Math.min(15000, 700 * Math.pow(1.7, this.attempt++));
    this.timer = setTimeout(() => this.#open(), delay);
  }

  #raw(payload) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  send(payload) {
    if (!this.#raw(payload) && this.queue.length < 100) this.queue.push(payload);
    if (!this.ws || this.ws.readyState > 1) this.connect();
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    try {
      this.ws?.close();
    } catch { /* ignore */ }
    this.ws = null;
    this.#setStatus('offline');
  }
}
