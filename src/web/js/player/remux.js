// PC: vídeo com áudio que o navegador não toca (AC3, DTS...) passa pelo componente de vídeo do servidor
// (FFmpeg reduzido, baixado uma vez), que copia a imagem e converte só o áudio. O <video> do app toca o resultado;
// aqui ele ganha a duração real, a busca (que recomeça a conversão do ponto pedido) e a troca de faixa de áudio.

let status = null;

// Estado do componente no servidor: { available, installed, size, installing, progress, error }
export async function remuxStatus(force = false) {
  if (status && !force) return status;
  try {
    const r = await fetch('/api/ffmpeg', { cache: 'no-store' });
    status = r.ok ? await r.json() : { available: false };
  } catch {
    status = { available: false };
  }
  return status;
}
export const remuxReady = () => !!(status && status.installed);
export const remuxOffered = () => !!(status && status.available);
export const remuxSize = () => (status && status.size) || 0; // bytes

export async function installRemux(onProgress) {
  await fetch('/api/ffmpeg/install', { method: 'POST' });
  for (;;) {
    const s = await remuxStatus(true);
    if (onProgress) onProgress(s);
    if (s.installed) return true;
    if (s.error && !s.installing) throw new Error(s.error);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Faixas e duração do arquivo: { duration, video: {codec}, audio: [{lang, codec, channels}] }
export async function probeMedia(url) {
  const r = await fetch('/api/ffmpeg/probe?url=' + encodeURIComponent(url), { cache: 'no-store' });
  if (!r.ok) throw new Error('probe');
  return r.json();
}

// Áudio que o navegador toca sem ajuda.
export const browserAudio = (codec) => /^(aac|mp3|mp2|opus|vorbis|flac)$/.test(codec || '');

const OWN = ['currentTime', 'duration', 'buffered', 'audioTracks', 'webkitAudioDecodedByteCount'];
const REAL = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
const CODEC = { ac3: 'AC3', eac3: 'E-AC3', dts: 'DTS', truehd: 'TrueHD', aac: 'AAC', mp3: 'MP3', opus: 'Opus', flac: 'FLAC', vorbis: 'Vorbis' };

export class RemuxVideo {
  constructor(video, info) {
    this.v = video;
    this.info = info;
    this.offset = 0;
    this.audio = 0;
  }

  open(url, start = 0) {
    const v = this.v;
    const self = this;
    this.url = url;
    const def = (k, get, set) => Object.defineProperty(v, k, { configurable: true, get, set });
    let first = start > 1 ? start : null;
    def('currentTime', () => self.offset + REAL.get.call(v), (s) => {
      // o ponto de partida já foi pedido na abertura: o "volta de onde parou" do player não pede de novo
      if (first != null && Math.abs(s - first) < 1) { first = null; return; }
      first = null;
      if (!Number.isFinite(s)) return;
      const d = self.info.duration;
      self._load(Math.max(0, d ? Math.min(s, d - 1) : s), !v.paused);
    });
    def('duration', () => (self.info.duration ? self.info.duration : Infinity));
    def('buffered', () => {
      const b = HTMLMediaElement.prototype.__lookupGetter__('buffered').call(v);
      return { length: b.length, start: (i) => self.offset + b.start(i), end: (i) => self.offset + b.end(i) };
    });
    def('webkitAudioDecodedByteCount', () => 1);
    def('audioTracks', () => self.info.audio.map((a, i) => ({
      label: [CODEC[a.codec] || a.codec.toUpperCase(), a.channels > 2 ? `${a.channels - 1}.1` : ''].filter(Boolean).join(' '),
      language: a.lang,
      get enabled() { return i === self.audio; },
      set enabled(on) { if (on && i !== self.audio) { self.audio = i; self._load(v.currentTime, !v.paused); } },
    })));
    this._load(start, true);
  }

  _load(start, play) {
    const v = this.v;
    this.offset = start;
    const hevc = this.info.video && /hevc|h265/.test(this.info.video.codec) ? '&hevc=1' : '';
    v.src = `/remux?url=${encodeURIComponent(this.url)}&start=${start.toFixed(2)}&audio=${this.audio}${hevc}`;
    if (play) v.play().catch(() => {});
  }

  // Para a linha "Reprodução" do menu.
  describe() {
    const a = this.info.audio[this.audio];
    const vc = this.info.video && this.info.video.codec;
    const name = { h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4' }[vc] || (vc || '').toUpperCase();
    return ['componente de vídeo do PC', name, a ? `áudio ${CODEC[a.codec] || a.codec} convertido` : ''].filter(Boolean).join(' · ');
  }

  close() {
    for (const k of OWN) delete this.v[k];
    this.v.removeAttribute('src');
    try { this.v.load(); } catch {}
  }
}
