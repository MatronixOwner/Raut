import fs from 'node:fs';
import path from 'node:path';

/**
 * Простое надёжное хранилище: один JSON-файл, атомарная запись, бэкап,
 * дебаунс 120 мс. Для демки на 10–10 000 сообщений этого более чем достаточно.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = emptyData();
    this._timer = null;
    this._dirty = false;
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = migrate(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[store] не удалось прочитать базу, начинаем заново:', err.message);
        try {
          fs.copyFileSync(this.file, this.file + '.broken-' + Date.now());
        } catch { /* ignore */ }
      }
      this.data = emptyData();
    }
    return this.data;
  }

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), 120);
    this._timer.unref?.();
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;
    const tmp = `${this.file}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] ошибка записи:', err.message);
    }
  }
}

export function emptyData() {
  return {
    version: 1,
    createdAt: Date.now(),
    users: {},
    sessions: {},
    servers: {},
    channels: {},
    messages: {},
    channelKeys: {},
    readState: {},
    meta: {},
  };
}

function migrate(data) {
  const base = emptyData();
  const merged = { ...base, ...data };
  for (const key of ['users', 'sessions', 'servers', 'channels', 'messages', 'channelKeys', 'readState', 'meta']) {
    if (!merged[key] || typeof merged[key] !== 'object') merged[key] = base[key];
  }
  merged.version = 1;
  return merged;
}
