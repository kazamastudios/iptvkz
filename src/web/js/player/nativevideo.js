// Player nativo do Android (Media3) para o que o WebView não toca: MKV, áudio AC3/E-AC3/DTS, H.265.
// O vídeo é desenhado pelo Android atrás da página; aqui o <video> do app passa a falar com ele,
// então o resto do player (controles, barra, menus, legendas) continua igual.
// A página fica transparente só onde está o player: os pais dele perdem o fundo e o que estiver
// por baixo dele na tela some enquanto o vídeo nativo toca.

const bridge = () => window.IPTVKZVideo;
export const nativeVideoAvailable = () => !!(bridge() && bridge().open);

const OWN = ['currentTime', 'duration', 'paused', 'readyState', 'volume', 'muted', 'videoWidth', 'videoHeight', 'buffered',
  'error', 'audioTracks', 'textTracks', 'currentSrc', 'play', 'pause', 'load', 'requestPictureInPicture', 'webkitAudioDecodedByteCount', 'getVideoPlaybackQuality'];
const EVENTS = new Set(['loadedmetadata', 'canplay', 'playing', 'waiting', 'play', 'pause', 'ended', 'resize']);

function realGet(v, k) {
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, k);
  return d && d.get ? d.get.call(v) : v[k];
}

export class NativeVideo {
  /** cb: { onError(kind), onTracks(), onCue(text) } */
  constructor(video, root, cb) {
    this.v = video;
    this.root = root;
    this.cb = cb;
    this.audio = [];
    this.text = [];
    this.cue = '';
    this.err = null;
    this.vol = realGet(video, 'volume');
    this.mute = realGet(video, 'muted');
    this.st = { t: 0, d: NaN, b: 0, p: false, r: 0, w: 0, h: 0 };
    this.rectKey = '';
    this.marked = [];
  }

  open(url, kind, startAt, audioLang) {
    const v = this.v;
    const st = this.st;
    st.t = startAt || 0;
    this.url = new URL(url, location.href).href;
    const self = this;
    const def = (k, get, set) => Object.defineProperty(v, k, { configurable: true, get, set });
    const fn = (k, f) => Object.defineProperty(v, k, { configurable: true, writable: true, value: f });
    let start = st.t > 1 ? st.t : null;
    def('currentTime', () => st.t, (s) => {
      // o ponto de partida já foi pedido na abertura: o "volta de onde parou" do player não pede de novo
      if (start != null && Math.abs(s - start) < 1) { start = null; return; }
      start = null;
      if (!Number.isFinite(s) || Math.abs(s - st.t) < 0.5) return;
      st.t = s;
      bridge().seek(s);
    });
    def('duration', () => (st.d < 0 ? Infinity : st.d));
    def('paused', () => st.p);
    def('readyState', () => st.r);
    def('videoWidth', () => st.w);
    def('videoHeight', () => st.h);
    def('currentSrc', () => self.url);
    def('error', () => self.err);
    def('webkitAudioDecodedByteCount', () => 1);
    def('buffered', () => ({ length: st.b > 0 ? 1 : 0, start: () => 0, end: () => st.b }));
    def('volume', () => self.vol, (x) => { self.vol = Math.max(0, Math.min(1, +x)); self._applyVolume(); });
    def('muted', () => self.mute, (m) => { self.mute = !!m; self._applyVolume(); });
    def('textTracks', () => ({ length: 0 }));
    def('audioTracks', () => self.audio.map((t) => ({
      label: t.ch && !t.name ? `${t.ch > 2 ? `${t.ch - 1}.1` : 'Estéreo'}` : t.name,
      language: t.lang,
      get enabled() { return t.on; },
      set enabled(on) { if (on && !t.on) { self.audio.forEach((a) => { a.on = a === t; }); bridge().track('audio', t.id); } },
    })));
    fn('play', () => { st.p = false; bridge().play(); return Promise.resolve(); });
    fn('pause', () => { st.p = true; bridge().pause(); });
    fn('load', () => {});
    fn('requestPictureInPicture', () => Promise.reject(new Error('pip')));
    // quadros do player nativo, no mesmo formato do navegador (para FPS e quadros perdidos)
    fn('getVideoPlaybackQuality', () => ({ totalVideoFrames: (st.fr || 0) + (st.fd || 0), droppedVideoFrames: st.fd || 0 }));

    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;visibility:hidden;pointer-events:none';
    document.body.append(this.probe);
    this.root.classList.add('native-video');
    window.__exo = (m) => this._msg(m);
    this._sendRect();
    this._rectT = setInterval(() => this._sendRect(), 300);
    bridge().open(this.url, kind, st.t, this.mute ? 0 : this.vol, audioLang || '');
  }

  close() {
    clearInterval(this._rectT);
    if (window.__exo) window.__exo = null;
    try { bridge().close(); } catch {}
    for (const k of OWN) delete this.v[k];
    this.v.volume = this.vol;
    this.v.muted = this.mute;
    this._unmark();
    this.root.classList.remove('native-video');
    if (this.probe) this.probe.remove();
  }

  setText(id) {
    this.cue = '';
    bridge().track('text', id == null ? 'off' : id);
  }

  _applyVolume() {
    bridge().volume(this.mute ? 0 : this.vol);
    this.v.dispatchEvent(new Event('volumechange'));
  }

  _msg(m) {
    const v = this.v;
    if (m.e === 'error') {
      this.err = { code: m.kind === 'format' ? 3 : 2 };
      this.cb.onError(m.kind, m.code);
      return;
    }
    if (m.e === 'tracks') {
      this.audio = m.audio || [];
      this.text = m.text || [];
      this.playing = m.playing || {};
      this.cb.onTracks();
      return;
    }
    if (m.e === 'cue') {
      this.cue = m.text || '';
      this.cb.onCue(this.cue);
      return;
    }
    const st = this.st;
    const moved = m.t !== st.t;
    const grew = m.b !== st.b;
    Object.assign(st, { t: m.t, d: m.d === 0 && m.r < 4 ? NaN : m.d, b: m.b, p: m.p, r: m.r, w: m.w, h: m.h, fr: m.fr, fd: m.fd });
    if (EVENTS.has(m.e)) v.dispatchEvent(new Event(m.e));
    if (moved) v.dispatchEvent(new Event('timeupdate'));
    if (grew) v.dispatchEvent(new Event('progress'));
  }

  // Manda ao Android onde o player está (em frações da tela) e abre a página nessa área.
  _sendRect() {
    const r = this.root.getBoundingClientRect();
    const s = this.probe.getBoundingClientRect();
    if (!s.width || !s.height) return;
    const f = [(r.left - s.left) / s.width, (r.top - s.top) / s.height, r.width / s.width, r.height / s.height];
    const key = f.map((n) => n.toFixed(4)).join(',');
    if (key === this.rectKey) return;
    this.rectKey = key;
    this._mark(r);
    bridge().rect(f[0], f[1], f[2], f[3]);
  }

  // Pais do player sem fundo; o que estiver embaixo dele na tela (a página atrás do player de filmes) fica oculto.
  _mark(r) {
    this._unmark();
    const add = (el, cls) => { el.classList.add(cls); this.marked.push([el, cls]); };
    for (let el = this.root; el && el !== document.documentElement; el = el.parentElement) {
      add(el, 'exo-hole');
      const parent = el.parentElement;
      if (!parent) break;
      // só o que vem antes na página fica por baixo; avisos e menus abertos depois continuam por cima
      for (const sib of parent.children) {
        if (sib === el) break;
        const b = sib.getBoundingClientRect();
        if (b.width && b.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) add(sib, 'exo-under');
      }
    }
    add(document.documentElement, 'exo-hole');
  }

  _unmark() {
    for (const [el, cls] of this.marked) el.classList.remove(cls);
    this.marked = [];
  }
}
