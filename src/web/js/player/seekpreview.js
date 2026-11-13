// Prévia da barra de tempo: mostra o quadro do ponto escolhido e os vizinhos (±10s e ±20s).
// Os quadros vêm de duas fontes: o que já foi assistido (capturado do próprio vídeo) e, quando a
// conta permite outra conexão, um segundo vídeo invisível que busca os pontos ainda não vistos.
import { h, fmtTime } from '../core/util.js';

const STEP = 10;
const OFFSETS = [-2, -1, 0, 1, 2];
const PRIORITY = [0, 1, -1, 2, -2];
const WIDTH = 240;
const HEIGHT = 135;
const IDLE_MS = 4000;
const SEEK_TIMEOUT = 6000;

export class SeekPreview {
  /** opts: { video, getUrl: () => url|null, canLoad: async () => boolean } */
  constructor(opts) {
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.slots = OFFSETS.map((o) => {
      const image = h('img', { alt: '' });
      const label = h('span');
      return { o, image, label, el: h('div.strip-frame' + (o === 0 ? '.main' : Math.abs(o) === 2 ? '.far' : ''), image, label) };
    });
    this.el = h('div.seek-strip.hidden', this.slots.map((s) => s.el));
    this.reset();
  }

  reset() {
    this._release();
    this.cache = new Map();
    this.failed = new Set();
    this.dark = 0;
    this.lastTry = null;
    this.allowed = undefined;
    this.center = null;
    this.busy = false;
    this.el.classList.add('hidden');
  }

  _bucket(t) {
    return Math.round(t / STEP) * STEP;
  }

  _draw(video, bucket) {
    if (!video.videoWidth) return;
    try {
      const g = this.canvas.getContext('2d');
      g.drawImage(video, 0, 0, WIDTH, HEIGHT);
      // em TVs o vídeo pode vir preto para o canvas: quadro todo escuro não serve de prévia
      const d = g.getImageData(0, 0, WIDTH, HEIGHT).data;
      let lit = false;
      for (let i = 0; i < d.length && !lit; i += 4 * 97) lit = d[i] + d[i + 1] + d[i + 2] > 45;
      if (!lit) return;
      this.cache.set(bucket, this.canvas.toDataURL('image/jpeg', 0.65));
    } catch {
      this.allowed = false; // o navegador não deixou ler o quadro
    }
  }

  // Chamado durante a reprodução: guarda os quadros de graça, sem nenhuma conexão extra.
  capture() {
    const v = this.opts.video;
    if (v.seeking || v.paused || this.noFrames()) return;
    const b = this._bucket(v.currentTime);
    if (this.cache.has(b) || b === this.lastTry || Math.abs(v.currentTime - b) >= 1) return;
    this.lastTry = b;
    this._draw(v, b);
    if (!this.cache.has(b)) this.dark++;
  }

  // Dois minutos só de quadros pretos: este aparelho não entrega o vídeo ao canvas, desiste.
  noFrames() {
    return this.dark >= 12 && this.cache.size === 0;
  }

  // load=false (arrastando a barra): mostra só o que já está guardado, sem buscar nada. Com load, só busca depois
  // que o ponteiro para por meio segundo: cada busca é uma conexão a mais com o provedor e disputava com o vídeo.
  show(time, ratio, seekWidth, load = true) {
    const d = this.opts.video.duration;
    if (!Number.isFinite(d)) return;
    clearTimeout(this._hideT);
    clearTimeout(this._idleT);
    this.center = this._bucket(time);
    this.time = time;
    this.duration = d;
    this.ratio = ratio;
    this.seekWidth = seekWidth;
    this._paint();
    clearTimeout(this._pumpT);
    if (load) this._pumpT = setTimeout(() => this._pump(), 500);
  }

  hide(delay = 0) {
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      this.center = null;
      this.el.classList.add('hidden');
      this.opts.onVisible && this.opts.onVisible(false);
      clearTimeout(this._idleT);
      this._idleT = setTimeout(() => this._release(), IDLE_MS);
    }, delay);
  }

  _times() {
    return OFFSETS.map((o) => this.center + o * STEP);
  }

  _valid(t) {
    return t >= 0 && t <= this.duration;
  }

  _paint() {
    if (this.center == null) return;
    const loading = this.allowed !== false;
    let any = false;
    for (const s of this.slots) {
      const t = this.center + s.o * STEP;
      const src = this._valid(t) ? this.cache.get(t) : null;
      const pending = this._valid(t) && !src && loading && !this.failed.has(t);
      s.el.classList.toggle('blank', !this._valid(t));
      s.el.classList.toggle('pending', pending);
      if (src) s.image.src = src;
      else s.image.removeAttribute('src');
      s.label.textContent = this._valid(t) ? fmtTime(s.o === 0 ? this.time : t) : '';
      if (src || pending) any = true;
    }
    // sem nenhum quadro para mostrar, fica só o tempo em cima da barra
    this.el.classList.toggle('hidden', !any);
    this.opts.onVisible && this.opts.onVisible(any);
    if (any) {
      const w = this.el.offsetWidth;
      const x = this.ratio * this.seekWidth - w / 2;
      this.el.style.left = Math.max(0, Math.min(this.seekWidth - w, x)) + 'px';
    }
  }

  async _pump() {
    if (this.busy || this.center == null || this.allowed === false) return;
    if (this.allowed === undefined) {
      this.busy = true;
      this.allowed = await this.opts.canLoad().catch(() => false);
      this.busy = false;
      this._paint();
      if (!this.allowed) return;
    }
    const next = PRIORITY.map((o) => this.center + o * STEP).find((t) => this._valid(t) && !this.cache.has(t) && !this.failed.has(t));
    if (next == null) return;
    this.busy = true;
    const ok = await this._seekTo(next);
    this.busy = false;
    if (!ok) this.failed.add(next);
    if (this.center != null) {
      this._paint();
      this._pump();
    }
  }

  _loader() {
    if (this.v) return this.v;
    const url = this.opts.getUrl();
    if (!url) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.addEventListener('error', () => {
      this.allowed = false; // formato não abre ou o servidor recusou: fica só com os quadros já vistos
      this._release();
      this._paint();
    });
    v.src = url;
    this.v = v;
    return v;
  }

  _seekTo(t) {
    const v = this._loader();
    if (!v) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (ok) => {
        clearTimeout(timer);
        v.removeEventListener('seeked', onSeeked);
        v.removeEventListener('loadedmetadata', go);
        resolve(ok);
      };
      const onSeeked = () => setTimeout(() => {
        this._draw(v, t);
        done(this.cache.has(t));
      }, 40);
      const go = () => {
        v.addEventListener('seeked', onSeeked);
        v.currentTime = Math.min(t, (v.duration || t) - 0.5);
      };
      const timer = setTimeout(() => done(false), SEEK_TIMEOUT);
      if (v.readyState >= 1) go();
      else v.addEventListener('loadedmetadata', go, { once: true });
    });
  }

  // Fecha a conexão extra assim que a prévia sai da tela.
  _release() {
    if (!this.v) return;
    try {
      this.v.removeAttribute('src');
      this.v.load();
    } catch {}
    this.v = null;
  }

  destroy() {
    clearTimeout(this._hideT);
    clearTimeout(this._idleT);
    this._release();
    this.center = null;
  }
}
