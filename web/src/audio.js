/**
 * Raut audio engine.
 *
 * Цепочка микрофона:  mic → highpass(85 Гц) → нейродешум (GTCRN/Rnnoise, WASM)
 *                     → мягкий компрессор → gain → MediaStreamDestination
 * Это даёт «студийный» голос: убирает гул, шипение кулера, эхо клавиатуры,
 * выравнивает громкость. Плюс анализ уровня для индикатора «говорит».
 *
 * Всё работает локально: звук сжимается Opus (WebRTC) и шифруется DTLS-SRTP.
 */

const WORKLET_GTCRN = '/vendor/noise/gtcrn-worklet.js';
const WORKLET_RNNOISE = '/vendor/noise/rnnoise-worklet.js';
const WASM_GTCRN = '/vendor/noise/gtcrn.wasm';
const WASM_RNNOISE = '/vendor/noise/rnnoise.wasm';
const WASM_RNNOISE_SIMD = '/vendor/noise/rnnoise_simd.wasm';

const hasSimd = () => {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
};

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.micStream = null;
    this.rawStream = null;
    this.processedStream = null;
    this.nodes = {};
    this.denoiser = null;
    this.denoiserKind = null;
    this.denoiserLoading = null;
    this.analyser = null;
    this.levelBuf = null;
    this.speaking = false;
    this.speakingCb = null;
    this.levelCb = null;
    this.rafId = 0;
    this.settings = {
      denoise: 'gtcrn', // gtcrn | rnnoise | browser | off
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      micDeviceId: '',
      inputVolume: 1,
    };
    this.remoteAnalysers = new Map();
  }

  /* ------------------------------------------------------------ lifecycle */

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive', sampleRate: 48000 });
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch { /* браузер попросит жест */ }
    }
    return this.ctx;
  }

  get ready() {
    return !!this.processedStream;
  }

  /* ---------------------------------------------------------------- mic */

  async listDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Микрофон ${i + 1}` }));
    } catch {
      return [];
    }
  }

  async startMic(settings = this.settings) {
    this.settings = { ...this.settings, ...settings };
    const ctx = await this.ensureContext();
    this.stopMic();

    const audio = {
      echoCancellation: this.settings.echoCancellation,
      noiseSuppression: this.settings.noiseSuppression && this.settings.denoise === 'browser',
      autoGainControl: this.settings.autoGainControl,
      channelCount: 1,
      sampleRate: 48000,
    };
    if (this.settings.micDeviceId) audio.deviceId = { exact: this.settings.micDeviceId };

    const raw = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    this.rawStream = raw;

    const source = ctx.createMediaStreamSource(raw);
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85;
    highpass.Q.value = 0.7;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 22;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;

    const gain = ctx.createGain();
    gain.gain.value = this.settings.inputVolume;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;

    const dest = ctx.createMediaStreamDestination();

    let head = highpass;
    source.connect(highpass);

    const denoiser = await this.#getDenoiser(this.settings.denoise).catch(() => null);
    if (denoiser) {
      highpass.connect(denoiser);
      head = denoiser;
    }

    head.connect(compressor);
    compressor.connect(gain);
    gain.connect(analyser);
    gain.connect(dest);

    this.nodes = { source, highpass, compressor, gain, analyser, dest, denoise: denoiser || null };
    this.analyser = analyser;
    this.levelBuf = new Uint8Array(analyser.fftSize);
    this.micStream = dest.stream;

    // Если трек умер (микрофон выдернули) — пробуем перезапустить
    for (const track of raw.getAudioTracks()) {
      track.addEventListener('ended', () => {
        this.micStream = null;
        this.onDeviceLost?.();
      });
    }

    this.#startLevelLoop();
    return { stream: this.micStream, raw };
  }

  async #getDenoiser(kind) {
    if (kind === 'off' || kind === 'browser') return null;
    const ctx = this.ctx;
    if (!ctx || !ctx.audioWorklet) return null;
    if (this.denoiserKind === kind && this.denoiser) {
      this.denoiser.port?.postMessage?.('destroy');
      this.denoiser.disconnect();
      const fresh = await this.#makeDenoiser(kind);
      this.denoiser = fresh;
      return fresh;
    }
    if (this.denoiserLoading) {
      try {
        await this.denoiserLoading;
      } catch { /* ignore */ }
    }
    this.denoiserLoading = (async () => {
      const node = await this.#makeDenoiser(kind);
      this.denoiser = node;
      this.denoiserKind = kind;
      return node;
    })();
    try {
      return await this.denoiserLoading;
    } finally {
      this.denoiserLoading = null;
    }
  }

  async #makeDenoiser(kind) {
    const ctx = this.ctx;
    const urls =
      kind === 'rnnoise'
        ? [WORKLET_RNNOISE, hasSimd() ? WASM_RNNOISE_SIMD : WASM_RNNOISE, '@sapphi-red/web-noise-suppressor/rnnoise']
        : [WORKLET_GTCRN, WASM_GTCRN, '@sapphi-red/web-noise-suppressor/gtcrn'];
    const [workletUrl, wasmUrl, processorName] = urls;
    await ctx.audioWorklet.addModule(workletUrl);
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    const node = new AudioWorkletNode(ctx, processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { maxChannels: 1, wasmBinary },
    });
    node.onprocessorerror = () => {
      console.warn('[audio] работа дешумоподавителя упала');
    };
    return node;
  }

  stopMic() {
    if (this.nodes.gain) {
      try {
        this.nodes.gain.disconnect();
      } catch { /* ignore */ }
    }
    if (this.nodes.denoise) {
      try {
        this.nodes.denoise.port?.postMessage?.('destroy');
        this.nodes.denoise.disconnect();
      } catch { /* ignore */ }
    }
    if (this.nodes.source) {
      try {
        this.nodes.source.disconnect();
      } catch { /* ignore */ }
    }
    for (const stream of [this.rawStream]) {
      stream?.getTracks().forEach((t) => t.stop());
    }
    this.rawStream = null;
    this.micStream = null;
    this.nodes = {};
    this.analyser = null;
    cancelAnimationFrame(this.rafId);
  }

  setInputVolume(v) {
    this.settings.inputVolume = v;
    if (this.nodes.gain) this.nodes.gain.gain.value = v;
  }

  /* -------------------------------------------------------------- levels */

  #startLevelLoop() {
    cancelAnimationFrame(this.rafId);
    const loop = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(this.levelBuf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < this.levelBuf.length; i++) {
        const v = (this.levelBuf[i] - 128) / 128;
        sum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      const rms = Math.sqrt(sum / this.levelBuf.length);
      const level = Math.min(1, rms * 3.2);
      this.levelCb?.(level, peak);

      const nowSpeaking = this.speaking ? rms > 0.014 : rms > 0.028;
      if (nowSpeaking !== this.speaking) {
        this.speaking = nowSpeaking;
        this.speakingCb?.(nowSpeaking);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** Анализ громкости удалённого потока (для «кто говорит»). */
  attachRemoteAnalyser(stream, cb) {
    const ctx = this.ctx;
    if (!ctx) return () => {};
    let analyser;
    let source;
    try {
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    } catch {
      return () => {};
    }
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let speaking = false;
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = speaking ? rms > 0.012 : rms > 0.022;
      if (now !== speaking) {
        speaking = now;
        cb(now, rms);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
      } catch { /* ignore */ }
    };
  }

  /** Короткий приятный сигнал — проверка наушников/колонок. */
  async playTestTone() {
    const ctx = await this.ensureContext();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      osc.connect(g);
      g.connect(master);
      const t = now + i * 0.14;
      osc.start(t);
      osc.stop(t + 0.9);
    });
  }

  /** Звук «входящего звонка». */
  async playRing() {
    const ctx = await this.ensureContext();
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.5;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(660, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }
}

export const audio = new AudioEngine();

/* --------------------------------------------------------------- helpers */

export function attachAudioElement(stream, { volume = 1, muted = false } = {}) {
  const el = document.createElement('audio');
  el.autoplay = true;
  el.playsInline = true;
  el.srcObject = stream;
  el.volume = muted ? 0 : volume;
  el.dataset.raut = 'voice';
  el.style.display = 'none';
  document.body.appendChild(el);
  const play = () => el.play().catch(() => { /* автоплей заблокирован до жеста */ });
  el.addEventListener('canplay', play);
  play();
  return el;
}

export function formatBytes(n) {
  if (!n) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
