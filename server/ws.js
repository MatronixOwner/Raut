'use strict';
/**
 * Минимальная реализация WebSocket (RFC 6455) на чистых модулях Node.js.
 * Никаких внешних зависимостей: установщик содержит только node.exe и наш код.
 */
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 16 * 1024 * 1024;

class WSConn extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = 0;
    this.closed = false;
    this.isAlive = true;
    this.id = crypto.randomUUID();
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish());
    socket.on('error', () => this.destroy());
  }

  _onData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE + 65536) return this.close(1009, 'too much data');
    this._parse();
  }

  _parse() {
    while (!this.closed) {
      if (this.buffer.length < 2) return;
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;

      if (len === 126) {
        if (this.buffer.length < off + 2) return;
        len = this.buffer.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (this.buffer.length < off + 8) return;
        const big = this.buffer.readBigUInt64BE(off);
        if (big > BigInt(MAX_MESSAGE)) return this.close(1009, 'frame too large');
        len = Number(big);
        off += 8;
      }

      // Клиент ОБЯЗАН маскировать кадры.
      if (!masked) return this.close(1002, 'client frame must be masked');
      if (off + 4 + len > this.buffer.length) return;
      const mask = this.buffer.subarray(off, off + 4);
      off += 4;
      const payload = Buffer.from(this.buffer.subarray(off, off + len));
      this.buffer = this.buffer.subarray(off + len);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];

      if (rsv !== 0) return this.close(1002, 'reserved bits set');
      if (op >= 0x8 && (!fin || len > 125)) return this.close(1002, 'bad control frame');
      this._frame(op, fin, payload);
    }
  }

  _frame(op, fin, payload) {
    switch (op) {
      case 0x8: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        this._write(0x8, payload.subarray(0, Math.min(payload.length, 125)));
        this.closed = true;
        this.socket.end();
        this.emit('close', code);
        return;
      }
      case 0x9:
        this._write(0xA, payload);
        return;
      case 0xA:
        this.isAlive = true;
        return;
      case 0x0:
        if (this.fragmentOp === 0) return this.close(1002, 'unexpected continuation');
        this.fragments.push(payload);
        if (fin) {
          const all = Buffer.concat(this.fragments);
          this.fragments = [];
          this._emitMessage(this.fragmentOp, all);
          this.fragmentOp = 0;
        }
        return;
      case 0x1:
      case 0x2:
        if (fin) {
          this._emitMessage(op, payload);
        } else {
          this.fragmentOp = op;
          this.fragments = [payload];
        }
        return;
      default:
        return this.close(1002, 'unknown opcode');
    }
  }

  _emitMessage(op, payload) {
    if (this.closed) return;
    const value = op === 0x1 ? payload.toString('utf8') : payload;
    this.emit('message', value, op === 0x2);
  }

  _write(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.alloc(2);
      head[0] = 0x80 | op;
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([head, payload]));
    } catch (_) {
      this.destroy();
    }
  }

  /** Отправить строку, Buffer или JSON-объект. */
  send(data) {
    if (typeof data === 'string') return this._write(0x1, Buffer.from(data, 'utf8'));
    if (Buffer.isBuffer(data)) return this._write(0x2, data);
    return this._write(0x1, Buffer.from(JSON.stringify(data), 'utf8'));
  }

  ping() {
    this.isAlive = false;
    this._write(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.concat([
      Buffer.from([(code >> 8) & 0xff, code & 0xff]),
      Buffer.from(reason, 'utf8'),
    ]);
    this._write(0x8, body.subarray(0, 125));
    this.closed = true;
    this.socket.end();
    this.emit('close', code);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch (_) { /* ignore */ }
    this.emit('close', 1006);
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', 1006);
  }
}

/**
 * Присоединяет WebSocket к уже созданному http/https серверу.
 * Возвращает объект с множеством соединений и методом broadcast().
 */
function attachWebSocket(server, onConnection) {
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    const connection = String(req.headers.connection || '').toLowerCase();
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    if (upgrade !== 'websocket' || !connection.includes('upgrade') || !key || version !== '13') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new WSConn(socket, req);
    if (head && head.length) conn._onData(head);
    clients.add(conn);
    conn.on('close', () => clients.delete(conn));
    try { onConnection(conn, req); } catch (err) { console.error('[ws] connection handler:', err); }
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.isAlive) { c.destroy(); clients.delete(c); continue; }
      c.ping();
    }
  }, 30000);
  heartbeat.unref();

  return {
    clients,
    broadcast(obj, filter) {
      const payload = JSON.stringify(obj);
      for (const c of clients) {
        if (c.closed) continue;
        if (filter && !filter(c)) continue;
        c.send(payload);
      }
    },
    closeAll() {
      clearInterval(heartbeat);
      for (const c of clients) c.close(1001, 'server shutdown');
    },
  };
}

module.exports = { attachWebSocket, WSConn };
