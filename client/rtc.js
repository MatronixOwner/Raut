/**
 * RautRTC — голос (Opus 48 kHz / стерео / до 256 кбит/с) и демонстрация экрана
 * (до 4K 60 FPS, битрейт настраивается). Ячеистая топология WebRTC:
 * одно соединение на собеседника для звука и отдельное — для видео,
 * поэтому включение шаринга никогда не разрывает голос.
 */
export class RautRTC extends EventTarget {
  constructor({ signal, iceServers = [], settings = {}, myId = '' }) {
    super();
    this.signal = signal;
    this.iceServers = iceServers;
    this.settings = settings;
    this.myId = myId;
    this.roster = [];
    this.audioPCs = new Map();
    this.videoPCs = new Map();
    this.remoteAudio = new Map();
    this.localStream = null;
    this.shareStream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.speakingTimer = null;
    this.statsTimer = null;
    this.muted = false;
    this.deafened = false;
    this.outputDevice = '';
    this.destroyed = false;
    this.statsTimer = setInterval(() => this._collectStats(), 2000);
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setConfig({ iceServers, settings, myId } = {}) {
    if (iceServers) this.iceServers = iceServers;
    if (settings) this.settings = { ...this.settings, ...settings };
    if (myId) this.myId = myId;
  }

  /* ------------------------- локальный звук ------------------------- */

  audioConstraints() {
    const s = this.settings;
    return {
      audio: {
        echoCancellation: s.echoCancellation !== false,
        noiseSuppression: !!s.noiseSuppression,
        autoGainControl: s.autoGainControl !== false,
        channelCount: 2,
        sampleRate: 48000,
        sampleSize: 16,
        latency: 0.01,
        ...(s.audioInput ? { deviceId: { exact: s.audioInput } } : {}),
      },
      video: false,
    };
  }

  async ensureLocalAudio() {
    if (this.localStream && this.localStream.active) return this.localStream;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Браузер не поддерживает захват звука');
    this.localStream = await navigator.mediaDevices.getUserMedia(this.audioConstraints());
    for (const t of this.localStream.getAudioTracks()) t.enabled = !this.muted;
    try {
      const track = this.localStream.getAudioTracks()[0];
      if (track?.applyConstraints) {
        await track.applyConstraints({ echoCancellation: this.settings.echoCancellation !== false, channelCount: 2, sampleRate: 48000 });
      }
    } catch (_) { /* устройство может не поддержать — не критично */ }
    this._setupSpeakingDetection(this.localStream);
    this._emit('local-audio', { stream: this.localStream });
    return this.localStream;
  }

  async applySettings(settings) {
    const prevDevice = this.settings.audioInput;
    this.settings = { ...this.settings, ...settings };
    if (this.localStream && prevDevice !== this.settings.audioInput) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
      if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
      await this.ensureLocalAudio();
      for (const [peerId, entry] of this.audioPCs) {
        const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'audio');
        const track = this.localStream.getAudioTracks()[0];
        if (sender && track) await sender.replaceTrack(track);
        void peerId;
      }
    }
    for (const entry of this.audioPCs.values()) this._tuneAudioSender(entry.pc);
    for (const entry of this.videoPCs.values()) this._tuneVideoSender(entry.pc);
    if (this.shareStream) {
      try {
        await this.shareStream.getVideoTracks()[0]?.applyConstraints({
          width: { ideal: this.settings.shareWidth || 1920 },
          height: { ideal: this.settings.shareHeight || 1080 },
          frameRate: { ideal: this.settings.shareFps || 60 },
        });
      } catch (_) { /* ignore */ }
    }
  }

  setMuted(v) {
    this.muted = !!v;
    if (this.localStream) for (const t of this.localStream.getAudioTracks()) t.enabled = !this.muted;
    this._emit('mute-changed', { muted: this.muted });
  }

  setDeafened(v) {
    this.deafened = !!v;
    for (const el of this.remoteAudio.values()) el.muted = this.deafened;
    if (this.deafened) this.setMuted(true);
    this._emit('deafen-changed', { deafened: this.deafened });
  }

  async setOutputDevice(deviceId) {
    this.outputDevice = deviceId || '';
    for (const el of this.remoteAudio.values()) {
      if (typeof el.setSinkId === 'function') {
        try { await el.setSinkId(this.outputDevice); } catch (_) { /* ignore */ }
      }
    }
  }

  setPeerVolume(peerId, value) {
    const el = this.remoteAudio.get(peerId);
    if (el) el.volume = Math.max(0, Math.min(2, value));
  }

  /* ------------------------- SDP-тюнинг ------------------------- */

  _mungeAudio(sdp) {
    const kbps = Math.max(32, Math.min(510, Number(this.settings.audioBitrate) || 256));
    const lines = sdp.replace(/\r\n/g, '\n').split('\n');
    let pt = null;
    for (const l of lines) {
      const m = /^a=rtpmap:(\d+)\s+opus\/48000\/2/i.exec(l);
      if (m) { pt = m[1]; break; }
    }
    if (pt) {
      const fmtp = `a=fmtp:${pt} minptime=3;maxptime=60;useinbandfec=1;usedtx=0;stereo=1;sprop-stereo=1;maxaveragebitrate=${kbps * 1000};cbr=0`;
      let found = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`a=fmtp:${pt} `)) { lines[i] = fmtp; found = true; break; }
      }
      if (!found) {
        const i = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
        if (i >= 0) lines.splice(i + 1, 0, fmtp);
      }
    }
    const i = lines.findIndex((l) => l.startsWith('m=audio'));
    if (i >= 0 && !lines.slice(i, i + 10).some((l) => l.startsWith('b=AS'))) {
      lines.splice(i + 1, 0, `b=AS:${kbps + 32}`, `b=TIAS:${(kbps + 32) * 1000}`);
    }
    return lines.join('\r\n');
  }

  _mungeVideo(sdp) {
    const kbps = Math.max(500, Math.min(40000, Number(this.settings.shareBitrate) || 8000));
    const lines = sdp.replace(/\r\n/g, '\n').split('\n');
    const i = lines.findIndex((l) => l.startsWith('m=video'));
    if (i >= 0 && !lines.slice(i, i + 14).some((l) => l.startsWith('b=AS'))) {
      lines.splice(i + 1, 0, `b=AS:${kbps}`, `b=TIAS:${kbps * 1000}`);
    }
    return lines.join('\r\n');
  }

  async _tuneAudioSender(pc) {
    const kbps = Math.max(32, Math.min(510, Number(this.settings.audioBitrate) || 256));
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'audio' || !sender.setParameters) continue;
      try {
        const p = sender.getParameters();
        p.encodings = p.encodings?.length ? p.encodings : [{}];
        for (const e of p.encodings) {
          e.maxBitrate = kbps * 1000;
          e.priority = 'high';
          e.dtx = false;
        }
        await sender.setParameters(p);
      } catch (_) { /* ignore */ }
    }
  }

  async _tuneVideoSender(pc) {
    const kbps = Math.max(500, Math.min(40000, Number(this.settings.shareBitrate) || 8000));
    const fps = Math.max(5, Math.min(60, Number(this.settings.shareFps) || 60));
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video' || !sender.setParameters) continue;
      try {
        const p = sender.getParameters();
        p.encodings = p.encodings?.length ? p.encodings : [{}];
        for (const e of p.encodings) {
          e.maxBitrate = kbps * 1000;
          e.maxFramerate = fps;
          e.scaleResolutionDownBy = 1;
          e.networkPriority = 'high';
          e.priority = 'high';
        }
        p.degradationPreference = 'maintain-resolution';
        await sender.setParameters(p);
      } catch (_) { /* ignore */ }
    }
  }

  /* ------------------------- PeerConnection ------------------------- */

  _pcConfig() {
    return {
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 2,
    };
  }

  _initiator(peerId) {
    return this.myId && peerId && this.myId < peerId;
  }

  _makePC(peerId, media) {
    const pc = new RTCPeerConnection(this._pcConfig());
    const entry = { pc, pending: [], dc: null };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signal(peerId, 'candidate', { candidate: ev.candidate.toJSON() }, media);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        this._emit('peer-state', { peerId, media, state: pc.connectionState });
      }
    };
    if (media === 'audio') {
      pc.ontrack = (ev) => {
        let el = this.remoteAudio.get(peerId);
        if (!el) {
          el = document.createElement('audio');
          el.autoplay = true;
          el.playsInline = true;
          el.style.display = 'none';
          el.dataset.peerId = peerId;
          document.body.appendChild(el);
          this.remoteAudio.set(peerId, el);
        }
        el.srcObject = ev.streams[0] || new MediaStream([ev.track]);
        el.muted = this.deafened;
        if (this.outputDevice && typeof el.setSinkId === 'function') {
          el.setSinkId(this.outputDevice).catch(() => {});
        }
        el.play().catch(() => this._emit('need-gesture'));
        this._emit('remote-audio', { peerId, stream: el.srcObject, element: el });
      };
      pc.ondatachannel = (ev) => this._bindDataChannel(peerId, ev.channel, entry);
    } else {
      pc.ondatachannel = () => {};
      pc.ontrack = (ev) => {
        this._emit('remote-video', { peerId, stream: ev.streams[0] || new MediaStream([ev.track]) });
      };
    }
    return entry;
  }

  _bindDataChannel(peerId, dc, entry) {
    entry.dc = dc;
    dc.onopen = () => { this._emit('peer-state', { peerId, media: 'audio', state: 'connected' }); };
    dc.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.t === 'spk') this._emit('speaking', { peerId, speaking: !!m.v });
      } catch (_) { /* ignore */ }
    };
  }

  async _flush(entry, peerId, media) {
    if (!entry.pc.remoteDescription) return;
    for (const c of entry.pending.splice(0)) {
      try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) { /* ignore */ }
    }
    void peerId; void media;
  }

  async _offer(peerId, media, entry) {
    const pc = entry.pc;
    if (pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer();
    offer.sdp = media === 'audio' ? this._mungeAudio(offer.sdp) : this._mungeVideo(offer.sdp);
    await pc.setLocalDescription(offer);
    await (media === 'audio' ? this._tuneAudioSender(pc) : this._tuneVideoSender(pc));
    this.signal(peerId, 'offer', { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }, media);
  }

  async ensureAudioPC(peerId) {
    if (this.audioPCs.has(peerId) || !this.localStream) return;
    const entry = this._makePC(peerId, 'audio');
    this.audioPCs.set(peerId, entry);
    for (const track of this.localStream.getTracks()) entry.pc.addTrack(track, this.localStream);
    if (this._initiator(peerId)) {
      const dc = entry.pc.createDataChannel('raut-meta');
      this._bindDataChannel(peerId, dc, entry);
      try { await this._offer(peerId, 'audio', entry); }
      catch (err) { this._emit('error', { message: 'Не удалось создать голосовое соединение: ' + err.message }); }
    }
  }

  /** Синхронизирует соединения с актуальным списком участников голосового канала. */
  async setRoster(peers) {
    this.roster = peers.filter((p) => p.id !== this.myId);
    for (const id of [...this.audioPCs.keys()]) {
      if (!this.roster.some((p) => p.id === id)) this._closePC('audio', id);
    }
    for (const id of [...this.videoPCs.keys()]) {
      if (!this.roster.some((p) => p.id === id)) this._closePC('video', id);
    }
    for (const p of this.roster) {
      await this.ensureAudioPC(p.id);
      // Если мы транслируем экран, newcomers должны сразу получить видео.
      if (this.shareStream && !this.videoPCs.has(p.id)) await this._openVideoPC(p.id);
    }
  }

  async handleSignal(from, kind, payload = {}, media = 'audio') {
    if (from === this.myId) return;
    const map = media === 'video' ? this.videoPCs : this.audioPCs;
    if (kind === 'bye') {
      this._closePC(media, from);
      this._emit('peer-left', { peerId: from, media });
      return;
    }
    let entry = map.get(from);
    if (!entry) {
      if (kind === 'candidate') {
        // Кандидат может прийти раньше offer'а — запомним.
        entry = this._makePC(from, media);
        map.set(from, entry);
        entry.pending.push(payload.candidate);
        return;
      }
      if (kind === 'offer' && media === 'audio' && !this.localStream) {
        try { await this.ensureLocalAudio(); } catch (_) { /* нет микрофона — всё равно слушаем */ }
      }
      entry = this._makePC(from, media);
      map.set(from, entry);
      if (media === 'audio' && this.localStream) {
        for (const track of this.localStream.getTracks()) entry.pc.addTrack(track, this.localStream);
      }
    }

    try {
      if (kind === 'offer') {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await this._flush(entry, from, media);
        const answer = await entry.pc.createAnswer();
        answer.sdp = media === 'audio' ? this._mungeAudio(answer.sdp) : this._mungeVideo(answer.sdp);
        await entry.pc.setLocalDescription(answer);
        await (media === 'audio' ? this._tuneAudioSender(entry.pc) : this._tuneVideoSender(entry.pc));
        this.signal(from, 'answer', { sdp: entry.pc.localDescription.toJSON ? entry.pc.localDescription.toJSON() : { type: entry.pc.localDescription.type, sdp: entry.pc.localDescription.sdp } }, media);
      } else if (kind === 'answer') {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await this._flush(entry, from, media);
      } else if (kind === 'candidate' && payload.candidate) {
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        else entry.pending.push(payload.candidate);
      }
    } catch (err) {
      this._emit('error', { message: `WebRTC (${media}, ${kind}): ${err.message}` });
    }
  }

  _closePC(media, peerId) {
    const map = media === 'video' ? this.videoPCs : this.audioPCs;
    const entry = map.get(peerId);
    if (!entry) return;
    map.delete(peerId);
    try { entry.dc?.close(); } catch (_) { /* ignore */ }
    try { entry.pc.close(); } catch (_) { /* ignore */ }
    if (media === 'audio') {
      const el = this.remoteAudio.get(peerId);
      if (el) { el.srcObject = null; el.remove(); this.remoteAudio.delete(peerId); }
    }
    this._emit('peer-left', { peerId, media });
  }

  /* ------------------------- демонстрация экрана ------------------------- */

  async startShare() {
    if (this.shareStream) return this.shareStream;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Демонстрация экрана не поддерживается этим браузером');
    const s = this.settings;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: Number(s.shareFps) || 60, max: 60 },
        width: { ideal: Number(s.shareWidth) || 1920, max: 3840 },
        height: { ideal: Number(s.shareHeight) || 1080, max: 2160 },
        cursor: 'always',
      },
      audio: s.shareSystemAudio !== false,
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
    });
    this.shareStream = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopShare());
    this._emit('local-video', { stream });
    for (const p of this.roster) await this._openVideoPC(p.id);
    this._emit('share-started', { stream });
    return stream;
  }

  async _openVideoPC(peerId) {
    if (!this.shareStream || this.videoPCs.has(peerId)) return;
    const entry = this._makePC(peerId, 'video');
    this.videoPCs.set(peerId, entry);
    for (const track of this.shareStream.getTracks()) entry.pc.addTrack(track, this.shareStream);
    try { await this._offer(peerId, 'video', entry); }
    catch (err) { this._emit('error', { message: 'Не удалось начать трансляцию: ' + err.message }); }
  }

  stopShare() {
    if (!this.shareStream) return;
    for (const t of this.shareStream.getTracks()) { try { t.stop(); } catch (_) { /* ignore */ } }
    this.shareStream = null;
    for (const id of [...this.videoPCs.keys()]) {
      this.signal(id, 'bye', {}, 'video');
      this._closePC('video', id);
    }
    this._emit('share-ended');
  }

  /* ------------------------- индикация речи и статистика ------------------------- */

  _setupSpeakingDetection(stream) {
    clearInterval(this.speakingTimer);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      let last = false;
      this.speakingTimer = setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const speaking = !this.muted && rms > 0.018;
        if (speaking !== last) {
          last = speaking;
          this._emit('speaking', { peerId: this.myId, speaking, self: true });
          const payload = JSON.stringify({ t: 'spk', v: speaking });
          for (const e of this.audioPCs.values()) {
            if (e.dc?.readyState === 'open') { try { e.dc.send(payload); } catch (_) { /* ignore */ } }
          }
        }
      }, 120);
    } catch (_) { /* индикация речи — необязательная функция */ }
  }

  resumeAudioContext() {
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    for (const el of this.remoteAudio.values()) el.play().catch(() => {});
  }

  async _collectStats() {
    let rtt = 0, loss = 0, jitter = 0, kbps = 0, count = 0;
    for (const entry of this.audioPCs.values()) {
      try {
        const report = await entry.pc.getStats();
        report.forEach((s) => {
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') {
            rtt = Math.max(rtt, s.currentRoundTripTime * 1000);
          }
          if (s.type === 'inbound-rtp' && s.kind === 'audio') {
            jitter = Math.max(jitter, (s.jitter || 0) * 1000);
            const recv = s.packetsReceived || 0;
            const lost = s.packetsLost || 0;
            if (recv + lost > 0) loss = Math.max(loss, (lost / (recv + lost)) * 100);
            kbps += ((s.bytesReceived || 0) * 8) / 1000 / 2;
          }
        });
        count++;
      } catch (_) { /* ignore */ }
    }
    this._emit('stats', { rtt: Math.round(rtt), loss: +loss.toFixed(1), jitter: Math.round(jitter), kbps: Math.round(kbps), peers: count });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.statsTimer);
    clearInterval(this.speakingTimer);
    for (const id of [...this.audioPCs.keys()]) this._closePC('audio', id);
    for (const id of [...this.videoPCs.keys()]) this._closePC('video', id);
    this.stopShare();
    if (this.localStream) for (const t of this.localStream.getTracks()) t.stop();
    this.localStream = null;
    if (this.audioCtx) this.audioCtx.close().catch(() => {});
    for (const el of this.remoteAudio.values()) el.remove();
    this.remoteAudio.clear();
  }
}
