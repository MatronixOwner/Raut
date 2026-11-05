import crypto from 'node:crypto';

/* --------------------------------------------------------------------- ids */

let lastTs = 0;
let counter = 0;

/**
 * Монотонный id в стиле snowflake: сортируется по времени, уникален в рамках процесса.
 * 41 бит времени (мс) + 14 бит счётчика + 9 бит случайности.
 */
export function nextId() {
  const ts = Date.now();
  if (ts === lastTs) {
    counter = (counter + 1) & 0x3fff;
    if (counter === 0) lastTs += 1;
  } else if (ts > lastTs) {
    lastTs = ts;
    counter = 0;
  } else {
    counter = (counter + 1) & 0x3fff;
  }
  const rand = crypto.randomInt(0, 512);
  return ((BigInt(lastTs) * 16384n + BigInt(counter)) * 512n + BigInt(rand)).toString(36);
}

export function idFromTs(ts) {
  return (BigInt(Math.floor(ts)) * 16384n * 512n).toString(36);
}

export function tsFromId(id) {
  try {
    const n = BigInt(parseInt36(id));
    return Number(n / (16384n * 512n));
  } catch {
    return 0;
  }
}

function parseInt36(id) {
  // BigInt не умеет парсить base36 напрямую — делаем вручную.
  let n = 0n;
  for (const ch of String(id)) {
    const v = parseInt(ch, 36);
    if (Number.isNaN(v)) throw new Error('bad id');
    n = n * 36n + BigInt(v);
  }
  return n;
}

export { parseInt36 };

export const now = () => Date.now();

/* ----------------------------------------------------------------- strings */

export const shortId = (n = 8) => crypto.randomBytes(n).toString('base64url');
export const token = () => crypto.randomBytes(32).toString('base64url');
export const inviteCode = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, '').slice(0, 7).toLowerCase();

export function slugifyName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function str(value, max = 200, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, max);
}

/* ------------------------------------------------------------------ ratelimit */

export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  hit(key) {
    const nowTs = Date.now();
    let list = this.hits.get(key);
    if (!list) this.hits.set(key, (list = []));
    while (list.length && list[0] < nowTs - this.windowMs) list.shift();
    if (list.length >= this.limit) return false;
    list.push(nowTs);
    if (this.hits.size > 5000) this.prune();
    return true;
  }

  prune() {
    const min = Date.now() - this.windowMs;
    for (const [k, v] of this.hits) {
      if (!v.length || v[v.length - 1] < min) this.hits.delete(k);
    }
  }
}

/* ----------------------------------------------------------------- parsing */

export function parseJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function readBodyBuffer(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('file too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function escapeForLog(s) {
  return String(s).replace(/[\r\n]/g, ' ');
}
