/** Тонкая обёртка над WebSocket с авто-переподключением. */
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.url = '';
    this.attempt = 0;
    this.manualClose = false;
    this.queue = [];
    this.retryTimer = null;
  }

  _dispatch(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  connect(url) {
    this.manualClose = false;
    this.url = url;
    clearTimeout(this.retryTimer);
    this._open();
  }

  _open() {
    if (this.manualClose) return;
    this._dispatch('status', { state: this.attempt ? 'reconnecting' : 'connecting' });
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      return this._retry(err);
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this._dispatch('status', { state: 'connected' });
      for (const payload of this.queue.splice(0)) ws.send(payload);
      this._dispatch('open');
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      this._dispatch('message', msg);
      this._dispatch(msg.t, msg);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.manualClose) this._retry();
    };
    ws.onerror = () => { /* onclose сделает всю работу */ };
  }

  _retry() {
    if (this.manualClose) return;
    this.attempt += 1;
    const delay = Math.min(20000, 400 * 1.6 ** Math.min(this.attempt, 6)) + Math.random() * 250;
    this._dispatch('status', { state: 'reconnecting', attempt: this.attempt, delay });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._open(), delay);
  }

  send(obj) {
    const payload = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(payload);
    else if (this.queue.length < 200) this.queue.push(payload);
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.retryTimer);
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
