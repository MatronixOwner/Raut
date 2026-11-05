/**
 * WebRTC-меш для голоса/видео: 1:1 и небольшие группы (до ~8 человек).
 * Сигналинг идёт через наш WebSocket, медиа — напрямую между клиентами
 * (STUN от Google; при желании добавьте TURN в настройках сервера).
 *
 * Инициатор соединения — тот, чей connId лексикографически больше,
 * чтобы не было «glare» с двумя офферами одновременно.
 */

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export class Mesh {
  constructor({ sendSignal, onPeer, onTrack, onState, iceServers }) {
    this.sendSignal = sendSignal;
    this.onPeer = onPeer || (() => {});
    this.onTrack = onTrack || (() => {});
    this.onState = onState || (() => {});
    this.peers = new Map(); // connId -> RTCPeerConnection
    this.info = new Map(); // connId -> {userId, displayName, voice}
    this.pendingIce = new Map();
    this.localStream = null;
    this.localVideo = null;
    this.screenStream = null;
    this.iceServers = iceServers || ICE_SERVERS;
    this.selfConnId = null;
    this.channelId = null;
  }

  setSelf(connId) {
    this.selfConnId = connId;
  }

  setLocalStream(stream) {
    this.localStream = stream;
    for (const [, pc] of this.peers) this.#syncAudioSenders(pc);
  }

  /** Возвращает список peer-ов, для которых надо создать оффер. */
  sync(peers) {
    const seen = new Set();
    const toOffer = [];
    for (const peer of peers) {
      if (peer.connId === this.selfConnId) continue;
      seen.add(peer.connId);
      this.info.set(peer.connId, peer);
      let pc = this.peers.get(peer.connId);
      if (!pc) {
        const self = this.selfConnId || '';
        const initiate = self > peer.connId;
        pc = this.#createPeer(peer.connId, initiate);
        this.peers.set(peer.connId, pc);
        this.onPeer(peer.connId, peer);
        if (initiate) toOffer.push(peer.connId);
      } else {
        this.info.set(peer.connId, peer);
      }
    }
    for (const [connId, pc] of [...this.peers]) {
      if (!seen.has(connId)) {
        this.removePeer(connId);
      }
    }
    return toOffer;
  }

  #createPeer(connId, initiate) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    pc.rautInitiate = initiate;
    pc.rautConnId = connId;

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        sender.rautKind = 'audio';
      }
    }
    if (this.localVideo) {
      for (const track of this.localVideo.getVideoTracks()) {
        const sender = pc.addTrack(track, this.localVideo);
        sender.rautKind = 'video';
      }
    }
    if (!this.localStream && !this.localVideo) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal(connId, { type: 'ice', candidate: ev.candidate.toJSON() });
    };

    pc.ontrack = (ev) => {
      this.onTrack(connId, ev.streams[0] || new MediaStream([ev.track]), ev.track);
    };

    pc.onconnectionstatechange = () => {
      this.onState(connId, pc.connectionState);
      if (pc.connectionState === 'failed') {
        try {
          pc.restartIce();
        } catch { /* ignore */ }
      }
    };

    pc.onnegotiationneeded = async () => {
      if (pc.signalingState !== 'stable' || pc.rautMakingOffer) return;
      try {
        pc.rautMakingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(connId, { type: 'desc', description: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn('[rtc] offer failed', err.message);
      } finally {
        pc.rautMakingOffer = false;
      }
    };

    if (initiate) {
      // offer уйдёт по negotiationneeded; для recvonly-сценария создаём вручную
      queueMicrotask(async () => {
        if (pc.signalingState !== 'stable' || pc.currentLocalDescription) return;
        try {
          pc.rautMakingOffer = true;
          await pc.setLocalDescription();
          this.sendSignal(connId, { type: 'desc', description: pc.localDescription.toJSON() });
        } catch { /* ignore */ } finally {
          pc.rautMakingOffer = false;
        }
      });
    }

    return pc;
  }

  #syncAudioSenders(pc) {
    const audioTracks = this.localStream ? this.localStream.getAudioTracks() : [];
    const senders = pc.getSenders().filter((s) => s.rautKind === 'audio' || s.track?.kind === 'audio');
    const current = senders.find((s) => s.track);
    if (!audioTracks.length) {
      if (current) {
        try {
          current.replaceTrack(null);
        } catch { /* ignore */ }
      }
      return;
    }
    if (current) {
      current.replaceTrack(audioTracks[0]).catch(() => {});
    } else {
      const sender = pc.addTrack(audioTracks[0], this.localStream);
      sender.rautKind = 'audio';
    }
  }

  async handleSignal(connId, data) {
    if (!data || !this.channelId) return;
    let pc = this.peers.get(connId);
    const peerWasKnown = !!pc;
    if (!pc) {
      if (data.type === 'desc' && data.description?.type === 'answer') return;
      pc = this.#createPeer(connId, false);
      this.peers.set(connId, pc);
      this.onPeer(connId, this.info.get(connId) || { connId });
    }
    try {
      if (data.type === 'desc') {
        const desc = data.description;
        const offerCollision = desc.type === 'offer' && (pc.rautMakingOffer || pc.signalingState !== 'stable');
        if (offerCollision) {
          // вежливость: уступает тот, у кого connId больше
          const polite = (this.selfConnId || '') > connId;
          if (!polite) return;
          await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        }
        await pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          this.sendSignal(connId, { type: 'desc', description: pc.localDescription.toJSON() });
        }
        const queued = this.pendingIce.get(connId) || [];
        this.pendingIce.delete(connId);
        for (const cand of queued) await pc.addIceCandidate(cand).catch(() => {});
      } else if (data.type === 'ice' && data.candidate) {
        if (!pc.remoteDescription || pc.remoteDescription.type === '') {
          const list = this.pendingIce.get(connId) || [];
          list.push(data.candidate);
          this.pendingIce.set(connId, list);
          return;
        }
        await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (err) {
      if (!peerWasKnown) console.warn('[rtc] signal error', err.message);
    }
  }

  async setVideo(stream) {
    this.localVideo = stream;
    for (const [, pc] of this.peers) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video' || s.rautKind === 'video');
      const track = stream ? stream.getVideoTracks()[0] : null;
      if (sender) {
        try {
          await sender.replaceTrack(track);
        } catch { /* ignore */ }
      } else if (track) {
        const s = pc.addTrack(track, stream);
        s.rautKind = 'video';
      }
    }
  }

  /** Демонстрация экрана заменяет видеотрек; выключение возвращает камеру. */
  async setScreen(stream) {
    this.screenStream = stream;
    if (stream) {
      await this.setVideo(stream);
    } else {
      await this.setVideo(this.cameraStream || null);
    }
  }

  setCamera(stream) {
    this.cameraStream = stream;
    if (!this.screenStream) return this.setVideo(stream);
    return Promise.resolve();
  }

  removePeer(connId) {
    const pc = this.peers.get(connId);
    if (!pc) return;
    try {
      pc.close();
    } catch { /* ignore */ }
    this.peers.delete(connId);
    this.pendingIce.delete(connId);
    this.info.delete(connId);
    this.onState(connId, 'closed');
  }

  close() {
    for (const connId of [...this.peers.keys()]) this.removePeer(connId);
    this.localStream = null;
    this.localVideo = null;
    this.screenStream = null;
    this.channelId = null;
  }
}
