import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 512 * 1024; // 512 КБ на сообщение — с запасом для SDP и шифротекста

/**
 * Минимальная, но корректная реализация WebSocket-сервера (RFC 6455):
 * маскирование, фрагментация, пинг/понг, close-хендшейк, лимиты.
 * Без внешних зависимостей — так демка ставится одной командой.
 */
export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.alive = true;
    this.closed = false;
    this.rooms = new Set();
    this.id = crypto.randomBytes(6).toString('hex');
    this.data = {}; // сюда приложение кладёт userId и т.п.

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('close', () => this.#onClose());
    socket.on('error', () => this.#onClose());
  }

  #onData(chunk) {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      while (this.#parseFrame()) { /* пока есть целые фреймы */ }
    } catch (err) {
      this.close(err.wsCode || 1002, err.message || 'protocol error');
    }
  }

  #parseFrame() {
    const buf = this.buf;
    if (buf.length < 2) return false;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const rsv = b0 & 0x70;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (rsv) throw wsErr(1002, 'RSV must be 0');
    if (!masked) throw wsErr(1002, 'client frames must be masked');

    if (len === 126) {
      if (buf.length < 4) return false;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return false;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) throw wsErr(1009, 'frame too large');
      len = Number(big);
      offset = 10;
    }
    if (len > MAX_FRAME) throw wsErr(1009, 'frame too large');

    const isControl = opcode >= 0x8;
    if (isControl && (!fin || len > 125)) throw wsErr(1002, 'bad control frame');

    if (buf.length < offset + 4 + len) return false;

    const mask = buf.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i & 3];
    this.buf = buf.subarray(offset + len);

    if (opcode === 0x8) {
      let code = 1000;
      if (payload.length >= 2) code = payload.readUInt16BE(0);
      this.#sendClose(code);
      return false;
    }
    if (opcode === 0x9) {
      this.#sendFrame(0x0a, payload);
      return true;
    }
    if (opcode === 0x0a) {
      this.alive = true;
      return true;
    }

    if (opcode === 0x0) {
      if (!this.fragOpcode) throw wsErr(1002, 'unexpected continuation');
      this.fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this.fragments);
        const op = this.fragOpcode;
        this.fragments = [];
        this.fragOpcode = 0;
        this.#dispatch(op, full);
      }
      return true;
    }

    if (this.fragOpcode) throw wsErr(1002, 'fragment interleaved');

    if (!fin) {
      this.fragOpcode = opcode;
      this.fragments = [payload];
      return true;
    }

    this.#dispatch(opcode, payload);
    return true;
  }

  #dispatch(opcode, payload) {
    if (opcode === 0x1) {
      let msg;
      try {
        msg = JSON.parse(payload.toString('utf8'));
      } catch {
        this.send({ t: 'error', message: 'bad json' });
        return;
      }
      if (msg && typeof msg === 'object') this.emit('message', msg);
      else this.send({ t: 'error', message: 'bad message' });
    } else if (opcode === 0x2) {
      this.emit('binary', payload);
    }
  }

  #sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.#onClose();
    }
  }

  send(obj) {
    if (this.closed) return;
    this.#sendFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  ping() {
    this.#sendFrame(0x9, Buffer.alloc(0));
  }

  #sendClose(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.allocUnsafe(2);
    payload.writeUInt16BE(code, 0);
    this.#sendFrame(0x8, payload);
    this.closed = true;
    try {
      this.socket.end();
    } catch { /* ignore */ }
    this.emit('close');
  }

  close(code = 1000, reason = '') {
    this.#sendClose(code);
    this.closeReason = reason;
  }

  #onClose() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch { /* ignore */ }
    this.emit('close');
  }
}

function wsErr(code, message) {
  return Object.assign(new Error(message), { wsCode: code });
}

export class WsServer {
  constructor({ path = '/ws', heartbeatMs = 30000 } = {}) {
    this.path = path;
    this.rooms = new Map(); // room -> Set<WsConnection>
    this.connections = new Set();
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
    this.heartbeatMs = heartbeatMs;
    this.timer = setInterval(() => this.#heartbeat(), heartbeatMs);
    this.timer.unref?.();
  }

  on(event, fn) {
    this.emitter.on(event, fn);
    return this;
  }

  #heartbeat() {
    for (const conn of this.connections) {
      if (!conn.alive) {
        conn.close(1001, 'heartbeat timeout');
        continue;
      }
      conn.alive = false;
      conn.ping();
    }
  }

  handleUpgrade(req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== this.path) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    if (!key || version !== '13') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    // ВАЖНО: никакой проверки Origin — клиент может быть запакован в Electron/iframe.
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    if (head && head.length) socket.unshift(head);

    const conn = new WsConnection(socket, req);
    conn.query = url.searchParams;
    this.connections.add(conn);
    conn.on('message', (msg) => this.emitter.emit('message', conn, msg));
    conn.on('close', () => {
      this.connections.delete(conn);
      for (const room of conn.rooms) this.#removeFromRoom(conn, room);
      this.emitter.emit('connection:close', conn);
    });
    this.emitter.emit('connection', conn);
  }

  join(conn, room) {
    if (conn.closed || conn.rooms.has(room)) return;
    conn.rooms.add(room);
    let set = this.rooms.get(room);
    if (!set) this.rooms.set(room, (set = new Set()));
    set.add(conn);
  }

  leave(conn, room) {
    conn.rooms.delete(room);
    this.#removeFromRoom(conn, room);
  }

  #removeFromRoom(conn, room) {
    const set = this.rooms.get(room);
    if (!set) return;
    set.delete(conn);
    if (!set.size) this.rooms.delete(room);
  }

  /** Отправка события всем в комнате. payload: {t, ...} */
  broadcast(room, payload, { except } = {}) {
    const set = this.rooms.get(room);
    if (!set) return 0;
    let n = 0;
    for (const conn of set) {
      if (conn === except || conn.closed) continue;
      conn.send(payload);
      n++;
    }
    return n;
  }

  broadcastMany(rooms, payload, opts) {
    const seen = new Set();
    for (const room of rooms) {
      const set = this.rooms.get(room);
      if (!set) continue;
      for (const conn of set) {
        if (seen.has(conn) || conn.closed) continue;
        if (opts?.except && conn === opts.except) continue;
        seen.add(conn);
        conn.send(payload);
      }
    }
    return seen.size;
  }

  close() {
    clearInterval(this.timer);
    for (const conn of this.connections) conn.close(1001, 'server shutting down');
    this.connections.clear();
    this.rooms.clear();
  }
}
