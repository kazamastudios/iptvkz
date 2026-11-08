// Player: escolhe o motor (hls.js / mpegts.js / nativo), tenta de novo em falhas,
// controla áudio, legenda (renderizada pelo app), qualidade, versão e "Abrir no VLC".
import { h, ico, fmtTime, toast } from './util.js';
import { icon } from './icons.js';
import { S, setSetting, api } from './store.js';
import { readSubFile, cuesAt, subHtml } from './subs.js';
import { TV, focusEl } from './tv.js';

const LANGS = {
  pt: 'Português', por: 'Português', pob: 'Português (BR)', 'pt-br': 'Português (BR)', en: 'Inglês', eng: 'Inglês',
  es: 'Espanhol', spa: 'Espanhol', fr: 'Francês', fre: 'Francês', fra: 'Francês', de: 'Alemão', ger: 'Alemão', deu: 'Alemão',
  it: 'Italiano', ita: 'Italiano', ja: 'Japonês', jpn: 'Japonês', ko: 'Coreano', kor: 'Coreano', und: 'Indefinido',
};
const isPt = (t) => /^(pt|por|pob)/i.test(t.lang || '') || /portug|dublad|brasil/i.test(t.name || '');
const isEn = (t) => /^(en|eng)\b/i.test(t.lang || '') || /english|ingl[eê]s/i.test(t.name || '');

function trackLabel(t, i) {
  const lang = (t.lang || '').toLowerCase();
  const nice = LANGS[lang] || LANGS[lang.split('-')[0]];
  const name = t.name && !/^(audio|subs?|track)\s*\d*$/i.test(t.name) ? t.name : '';
  if (name && nice && !name.toLowerCase().includes(nice.toLowerCase().slice(0, 4))) return `${name} (${nice})`;
  return name || nice || `Faixa ${i + 1}`;
}

export function proxyUrl(url) {
  return '/proxy?url=' + encodeURIComponent(url);
}

function detectEngine(url, live) {
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.m3u8') || path.endsWith('.m3u')) return 'hls';
  if (path.endsWith('.ts') || path.endsWith('.mpegts')) return 'mpegts';
  if (live && !/\.[a-z0-9]{2,4}$/.test(path.split('/').pop())) return 'mpegts';
  if (live && /\.(mp4|webm|mkv|mov)$/.test(path)) return 'native';
  if (live) return 'hls';
  return 'native';
}

export class Player {
  /**
   * opts: { live, title, onBack, onEnded, onTime(t,d), next: {title} | null, onNext,
   *         versions: [{label,url}], version, onVersion(label, t), compact }
   */
  constructor(host, opts = {}) {
    this.opts = opts;
    this.host = host;
    this.hls = null;
    this.mts = null;
    this.engine = null;
    this.attempts = 0;
    this.usingAlt = false;
    this.subSource = null; // {type:'ext', cues, name} | {type:'hls', index}
    this.subDelay = 0;
    this.lastSubText = '';
    this.destroyed = false;
    this._build();
    this._bind();
  }

  // ---------- DOM ----------
  _build() {
    const o = this.opts;
    this.video = h('video', { playsinline: true, preload: 'auto' });
    this.video.volume = S.settings.volume ?? 1;
    this.subsEl = h('div.subs');
    this.subSpan = h('span');
    this.subsEl.append(this.subSpan);
    this._applySubStyle();

    this.titleEl = h('div.ptitle', o.title || '');
    this.btnPlay = this._btn('pause', 'Reproduzir/Pausar (Espaço)', () => this.togglePlay());
    this.btnMute = this._btn('volume', 'Mudo (M)', () => this.toggleMute());
    this.volRange = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: this.video.volume });
    this.volRange.addEventListener('input', () => {
      this.video.volume = +this.volRange.value;
      this.video.muted = this.video.volume === 0;
    });
    this.btnFs = this._btn('fullscreen', 'Tela cheia (F)', () => this.toggleFullscreen());
    this.btnGear = this._btn('gear', 'Áudio, legenda e qualidade', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });
    this.btnPip = this._btn('pip', 'Picture-in-picture', () => this.togglePip());
    this.btnVlc = this._btn('external', 'Abrir no VLC', () => this.openVlc());
    this.timeEl = h('span.ptime');
    this.btnNext = o.next ? h('button.btn.small', { onclick: () => this._goNext(), title: 'Próximo episódio' }, ico('next'), 'Próximo') : null;

    let seek = null;
    if (!o.live) {
      this.seekFill = h('div.fill');
      this.seekBuf = h('div.buf');
      this.seekKnob = h('div.knob');
      this.seekTip = h('div.tip');
      seek = h('div.seek', h('div.track', this.seekBuf, this.seekFill), this.seekKnob, this.seekTip);
      this._bindSeek(seek);
    }

    const left = [this.btnPlay];
    if (!o.live) {
      left.push(this._btn('rew', 'Voltar 10s (←)', () => this.seekBy(-10)));
      left.push(this._btn('fwd', 'Avançar 10s (→)', () => this.seekBy(10)));
    }
    left.push(h('div.vol', this.btnMute, this.volRange));
    left.push(o.live ? h('span.badge.onair.live-badge', 'AO VIVO') : this.timeEl);

    this.bottom = h('div.pbottom', seek,
      h('div.prow', left, h('div.grow'), this.btnNext, this.btnGear, this.btnPip, S.vlc ? this.btnVlc : null, this.btnFs));

    const top = [];
    if (o.onBack) top.push(this._btn('back', 'Voltar (Esc)', () => o.onBack()));
    top.push(this.titleEl);
    this.top = h('div.ptop', top);

    this.center = h('div.center', h('div.spinner'));
    this.errorEl = h('div.perror.hidden');
    this.menu = h('div.pmenu.hidden');
    this.nextCard = null;

    this.root = h('div.player.ctrl-visible', this.video, this.subsEl, h('div.shade'), this.top, this.center, this.bottom, this.menu, this.errorEl);
    this.host.append(this.root);
  }

  _btn(name, title, fn) {
    const b = h('button.pbtn', { title, onclick: fn });
    b.innerHTML = icon(name);
    return b;
  }

  _setIcon(btn, name) {
    btn.innerHTML = icon(name);
  }

  _bind() {
    const v = this.video;
    const on = (ev, fn) => v.addEventListener(ev, fn);
    on('play', () => this._setIcon(this.btnPlay, 'pause'));
    on('pause', () => { this._setIcon(this.btnPlay, 'play'); this._showCtrl(); this._report(); });
    on('waiting', () => this._spin(true));
    on('playing', () => { this._spin(false); this.attempts = 0; this._hideError(); });
    on('canplay', () => this._spin(false));
    on('volumechange', () => {
      this._setIcon(this.btnMute, v.muted || v.volume === 0 ? 'mute' : 'volume');
      if (!v.muted) setSetting('volume', v.volume);
      this.volRange.value = v.muted ? 0 : v.volume;
    });
    on('timeupdate', () => this._onTime());
    on('progress', () => this._updateSeek());
    on('loadedmetadata', () => {
      if (this.resumeAt > 1 && Number.isFinite(v.duration) && this.resumeAt < v.duration - 5) v.currentTime = this.resumeAt;
      this.resumeAt = 0;
      this._updateSeek();
    });
    on('ended', () => this._onEnded());
    on('error', () => {
      if (this.engine !== 'native') return;
      const code = v.error && v.error.code;
      this._fail(code === 4 || code === 3 ? 'format' : 'network', this.gen);
    });
    v.addEventListener('click', () => {
      if (!this.menu.classList.contains('hidden')) return this.closeMenu();
      this.togglePlay();
    });
    v.addEventListener('dblclick', () => this.toggleFullscreen());

    this.root.addEventListener('mousemove', () => this._showCtrl());
    this.root.addEventListener('mouseleave', () => this._scheduleHide(600));
    this._onFs = () => this._setIcon(this.btnFs, document.fullscreenElement ? 'exitFs' : 'fullscreen');
    document.addEventListener('fullscreenchange', this._onFs);
    this._onDocClick = (e) => {
      if (!this.menu.contains(e.target) && e.target !== this.btnGear) this.closeMenu();
    };
    document.addEventListener('mousedown', this._onDocClick);

    this._subTimer = setInterval(() => this._renderSubs(), 100);
    this._watchdog = setInterval(() => this._checkStall(), 5000);
    this._showCtrl();
  }

  // ---------- carregamento ----------
  load(src) {
    this.src = src;
    this.attempts = 0;
    this.usingAlt = false;
    this.resumeAt = src.startAt || 0;
    this.subSource = null;
    this.subDelay = 0;
    this.autoPicked = false;
    this.titleEl.textContent = src.title || this.opts.title || '';
    this._hideError();
    this._removeNextCard();
    this.nextDismissed = false;
    this._start(src.url);
  }

  currentUrl() {
    return this.usingAlt && this.src.alt ? this.src.alt : this.src.url;
  }

  _teardown() {
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    if (this.mts) {
      try { this.mts.pause(); this.mts.unload(); this.mts.detachMediaElement(); this.mts.destroy(); } catch {}
      this.mts = null;
    }
    this.video.removeAttribute('src');
    try { this.video.load(); } catch {}
  }

  _start(url) {
    this._teardown();
    const gen = (this.gen = (this.gen || 0) + 1);
    this._spin(true);
    this.lastProgressAt = Date.now();
    this.lastTime = -1;
    const live = !!this.opts.live;
    let engine = detectEngine(url, live);
    if (engine === 'hls' && !(window.Hls && Hls.isSupported())) engine = 'native';
    if (engine === 'mpegts' && !(window.mpegts && mpegts.getFeatureList().mseLivePlayback)) engine = 'native';
    this.engine = engine;
    const purl = proxyUrl(url);
    const v = this.video;

    if (engine === 'hls') {
      const hls = new Hls({
        enableWorker: true,
        backBufferLength: live ? 30 : 90,
        maxBufferLength: 30,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        subtitleDisplay: false,
      });
      this.hls = hls;
      hls.subtitleDisplay = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setTimeout(() => this._autoPickTracks(), 0);
        v.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !this._recovered) {
          this._recovered = true;
          hls.recoverMediaError();
          return;
        }
        const fmt = d.type === Hls.ErrorTypes.MEDIA_ERROR || /codec|incompatible/i.test(d.details || '');
        this._fail(fmt ? 'format' : 'network', gen);
      });
      this._recovered = false;
      hls.loadSource(purl);
      hls.attachMedia(v);
    } else if (engine === 'mpegts') {
      const p = mpegts.createPlayer(
        { type: 'mpegts', isLive: true, url: new URL(purl, location.href).href },
        { enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 6, liveBufferLatencyMinRemain: 1.5 },
      );
      this.mts = p;
      p.on(mpegts.Events.ERROR, (type, detail) => {
        this._fail(type === mpegts.ErrorTypes.MEDIA_ERROR && /codec|unsupported|mse/i.test(String(detail)) ? 'format' : 'network', gen);
      });
      p.attachMediaElement(v);
      p.load();
      const pr = p.play();
      if (pr && pr.catch) pr.catch(() => {});
    } else {
      v.src = purl;
      v.play().catch(() => {});
    }
  }

  _fail(kind, gen) {
    // Cada _start() tem uma geração; erros atrasados de uma tentativa antiga são ignorados,
    // e cada tentativa só é tratada uma vez.
    if (this.destroyed || gen !== this.gen || this.failedGen === gen) return;
    this.failedGen = gen;
    const t = this.video.currentTime;
    if (!this.opts.live && t > 1) this.resumeAt = t;

    if (kind !== 'format' && this.attempts < 2) {
      this.attempts++;
      this._spin(true);
      clearTimeout(this._retryT);
      this._retryT = setTimeout(() => !this.destroyed && this._start(this.currentUrl()), 1200 * this.attempts);
      return;
    }
    if (this.src.alt && !this.usingAlt) {
      this.usingAlt = true;
      this.attempts = 0;
      this._start(this.src.alt);
      return;
    }
    this._teardown();
    this._spin(false);
    this._showError(kind);
  }

  _checkStall() {
    const v = this.video;
    if (this.destroyed || v.paused || !this.errorEl.classList.contains('hidden')) {
      this.lastProgressAt = Date.now();
      return;
    }
    if (v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime;
      this.lastProgressAt = Date.now();
      return;
    }
    if (Date.now() - this.lastProgressAt > 20000) {
      this.lastProgressAt = Date.now();
      this._fail('network', this.gen);
    }
  }

  _showError(kind) {
    const fmt = kind === 'format';
    const title = fmt ? 'O navegador não toca este formato' : this.opts.live ? 'Canal indisponível' : 'Não foi possível carregar';
    const text = fmt
      ? 'Isso é comum com MKV, áudio AC3/E-AC3 ou vídeo H.265. O VLC toca normalmente.'
      : 'O canal pode estar fora do ar, ou o servidor da lista recusou a conexão. Tente de novo em instantes.';
    this.errorEl.replaceChildren(
      ico('alert'),
      h('h3', title),
      h('p', text),
      h('div.acts',
        h('button.btn', { onclick: () => this.retry() }, ico('refresh'), 'Tentar de novo'),
        S.vlc ? h('button.btn.primary', { onclick: () => this.openVlc() }, ico('external'), 'Abrir no VLC') : null),
    );
    this.errorEl.classList.remove('hidden');
  }

  _hideError() {
    this.errorEl.classList.add('hidden');
  }

  retry() {
    this._hideError();
    this.attempts = 0;
    this.usingAlt = false;
    this._start(this.src.url);
  }

  _spin(on) {
    this.center.classList.toggle('hidden', !on);
  }

  // ---------- controles ----------
  togglePlay() {
    const v = this.video;
    if (v.paused) {
      if (this.opts.live && this.engine === 'mpegts' && this.mts) {
        // ao vivo: volta pra ponta da transmissão
        try { const b = v.buffered; if (b.length) v.currentTime = b.end(b.length - 1) - 1; } catch {}
      }
      v.play().catch(() => {});
    } else v.pause();
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    if (!this.video.muted && this.video.volume === 0) this.video.volume = 0.5;
  }

  seekBy(s) {
    const v = this.video;
    if (this.opts.live || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + s));
    this._showCtrl();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.root.requestFullscreen().catch(() => {});
  }

  async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      toast('Picture-in-picture indisponível para este vídeo', 'error');
    }
  }

  async openVlc() {
    try {
      await api('/api/vlc', { method: 'POST', body: JSON.stringify({ url: this.currentUrl(), title: this.titleEl.textContent }) });
      this.video.pause();
      toast('Abrindo no VLC…', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  _showCtrl() {
    this.root.classList.add('ctrl-visible');
    this.root.classList.remove('hide-cursor');
    this._scheduleHide(2800);
  }

  _scheduleHide(ms) {
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      if (this.video.paused || !this.menu.classList.contains('hidden')) return;
      if (this._ctrlFocused()) return this._scheduleHide(ms);
      this.root.classList.remove('ctrl-visible');
      this.root.classList.add('hide-cursor');
    }, ms);
  }

  _bindSeek(seek) {
    const ratioAt = (e) => {
      const r = seek.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    let dragging = false;
    seek.addEventListener('pointermove', (e) => {
      const d = this.video.duration;
      if (!Number.isFinite(d)) return;
      const ratio = ratioAt(e);
      this.seekTip.style.left = ratio * 100 + '%';
      this.seekTip.textContent = fmtTime(ratio * d);
      if (dragging) this._paintSeek(ratio);
    });
    seek.addEventListener('pointerdown', (e) => {
      dragging = true;
      seek.setPointerCapture(e.pointerId);
      this._paintSeek(ratioAt(e));
    });
    seek.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const d = this.video.duration;
      if (Number.isFinite(d)) this.video.currentTime = ratioAt(e) * d;
    });
    this._isDragging = () => dragging;
  }

  _paintSeek(ratio) {
    this.seekFill.style.width = ratio * 100 + '%';
    this.seekKnob.style.left = ratio * 100 + '%';
  }

  _updateSeek() {
    if (this.opts.live || !this.seekFill) return;
    const v = this.video;
    const d = v.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    if (!this._isDragging()) this._paintSeek(v.currentTime / d);
    try {
      const b = v.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= v.currentTime && b.end(i) >= v.currentTime) {
          this.seekBuf.style.width = (b.end(i) / d) * 100 + '%';
          break;
        }
      }
    } catch {}
  }

  _onTime() {
    const v = this.video;
    if (!this.opts.live) {
      this.timeEl.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
      this._updateSeek();
      const now = Date.now();
      if (!this._lastReport || now - this._lastReport > 10000) this._report();
      if (this.opts.next && !this.nextDismissed && !this.nextCard && Number.isFinite(v.duration) && v.duration > 300 && v.duration - v.currentTime < 25) {
        this._showNextCard(false);
      }
    }
  }

  _report() {
    this._lastReport = Date.now();
    const v = this.video;
    if (this.opts.onTime && !this.opts.live && Number.isFinite(v.duration) && v.currentTime > 0) {
      this.opts.onTime(v.currentTime, v.duration);
    }
  }

  _onEnded() {
    this._report();
    if (this.opts.next) this._showNextCard(S.settings.autoNext);
    else if (this.opts.onEnded) this.opts.onEnded();
  }

  // ---------- próximo episódio ----------
  _showNextCard(countdown) {
    this._removeNextCard();
    const btn = h('button.btn.primary.small.ring', { onclick: () => this._goNext() }, ico('play'), 'Assistir agora');
    const card = h('div.next-card',
      h('div.lbl', 'Próximo episódio'),
      h('div.t', this.opts.next.title),
      h('div.acts', btn, h('button.btn.ghost.small', { onclick: () => { this.nextDismissed = true; this._removeNextCard(); } }, 'Agora não')));
    this.root.append(card);
    this.nextCard = card;
    if (countdown) {
      let left = 8;
      btn.lastChild.textContent = `Assistir em ${left}s`;
      this._nextT = setInterval(() => {
        left--;
        btn.style.setProperty('--p', ((8 - left) / 8) * 100 + '%');
        btn.lastChild.textContent = `Assistir em ${left}s`;
        if (left <= 0) this._goNext();
      }, 1000);
    }
  }

  _removeNextCard() {
    clearInterval(this._nextT);
    if (this.nextCard) this.nextCard.remove();
    this.nextCard = null;
  }

  _goNext() {
    this._removeNextCard();
    this._report();
    if (this.opts.onNext) this.opts.onNext();
  }

  // ---------- áudio / legenda ----------
  audioTracks() {
    if (this.hls) return this.hls.audioTracks.map((t, i) => ({ i, label: trackLabel(t, i), on: this.hls.audioTrack === i, raw: t }));
    const at = this.video.audioTracks;
    if (at && at.length) return [...at].map((t, i) => ({ i, label: trackLabel({ name: t.label, lang: t.language }, i), on: t.enabled, raw: { name: t.label, lang: t.language } }));
    return [];
  }

  setAudio(i) {
    if (this.hls) this.hls.audioTrack = i;
    else if (this.video.audioTracks) [...this.video.audioTracks].forEach((t, j) => { t.enabled = j === i; });
  }

  subTracks() {
    if (!this.hls) return [];
    return this.hls.subtitleTracks.map((t, i) => ({ i, label: trackLabel(t, i), raw: t }));
  }

  setSub(src) {
    this.subSource = src;
    if (this.hls) this.hls.subtitleTrack = src && src.type === 'hls' ? src.index : -1;
    this.lastSubText = null;
    this._renderSubs();
  }

  _autoPickTracks() {
    if (this.autoPicked || !this.hls) return;
    this.autoPicked = true;
    const want = S.settings.audioLang;
    const audios = this.hls.audioTracks;
    if (audios.length > 1 && want !== 'orig') {
      const idx = audios.findIndex(want === 'en' ? isEn : isPt);
      if (idx >= 0 && idx !== this.hls.audioTrack) this.hls.audioTrack = idx;
    }
    const cur = audios[this.hls.audioTrack];
    const audioIsPt = cur && (cur.lang || cur.name) ? isPt(cur) : null;
    const subs = this.hls.subtitleTracks;
    const ptSub = subs.findIndex(isPt);
    const mode = S.settings.subMode;
    let pick = -1;
    if (mode === 'always' && ptSub >= 0) pick = ptSub;
    if (mode === 'auto' && audioIsPt === false && ptSub >= 0) pick = ptSub;
    this.setSub(pick >= 0 ? { type: 'hls', index: pick } : null);
  }

  _activeTextTrack() {
    const tt = this.video.textTracks;
    for (let i = 0; i < tt.length; i++) {
      const t = tt[i];
      if ((t.kind === 'subtitles' || t.kind === 'captions') && t.mode !== 'disabled') {
        if (t.mode === 'showing') t.mode = 'hidden';
        return t;
      }
    }
    return null;
  }

  _renderSubs() {
    const src = this.subSource;
    let text = '';
    if (src) {
      const t = this.video.currentTime - this.subDelay;
      if (src.type === 'ext') {
        text = cuesAt(src.cues, t).map((c) => c.text).join('\n');
      } else {
        const track = this._activeTextTrack();
        if (track && track.cues) text = cuesAt(track.cues, t, (c) => c.startTime, (c) => c.endTime).map((c) => c.text).join('\n');
      }
    }
    if (text !== this.lastSubText) {
      this.lastSubText = text;
      this.subSpan.innerHTML = subHtml(text);
      this.subSpan.style.display = text ? '' : 'none';
    }
  }

  _applySubStyle() {
    this.subsEl.className = `subs sz-${S.settings.subSize || 'M'} bg-${S.settings.subBg || 'shadow'}`;
  }

  async _pickSubFile() {
    const input = h('input', { type: 'file', accept: '.srt,.vtt,.sub,text/vtt' });
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const cues = await readSubFile(f);
        this.setSub({ type: 'ext', cues, name: f.name });
        toast(`Legenda carregada: ${f.name}`, 'ok');
      } catch (e) {
        toast(e.message, 'error');
      }
      this._renderMenu();
    };
    input.click();
  }

  // ---------- menu ⚙️ ----------
  toggleMenu() {
    if (this.menu.classList.contains('hidden')) {
      this._renderMenu();
      this.menu.classList.remove('hidden');
      this._showCtrl();
      if (TV.on) focusEl(this.menu.querySelector('.opt.on, .opt, button'));
    } else this.closeMenu();
  }

  closeMenu() {
    const wasOpen = !this.menu.classList.contains('hidden');
    this.menu.classList.add('hidden');
    if (wasOpen && TV.on && this.menu.contains(document.activeElement)) focusEl(this.btnGear);
  }

  _ctrlFocused() {
    const a = document.activeElement;
    return !!a && a !== this.video && this.root.contains(a) && (a.tagName === 'BUTTON' || a.tagName === 'INPUT');
  }

  _renderMenu() {
    const m = this.menu;
    m.replaceChildren();
    const opt = (label, on, fn) => {
      const b = h('button.opt', { onclick: fn }, h('span.ck', on ? ico('check') : ''), h('span', label));
      return b;
    };
    const seg = (values, cur, fn) =>
      h('div.seg', values.map(([v, l]) => h('button' + (v === cur ? '.on' : ''), { onclick: () => { fn(v); this._renderMenu(); } }, l)));

    // Versão (Dublado/Legendado)
    const vs = this.opts.versions;
    if (vs && vs.length > 1) {
      m.append(h('h4', 'Versão'));
      for (const v of vs) {
        m.append(opt(v.label, v.label === this.opts.version, () => {
          if (v.label === this.opts.version) return;
          this.closeMenu();
          this.opts.onVersion && this.opts.onVersion(v.label, this.video.currentTime);
        }));
      }
      m.append(h('div.sep'));
    }

    // Áudio
    m.append(h('h4', 'Áudio'));
    const audios = this.audioTracks();
    if (audios.length > 1) {
      for (const a of audios) m.append(opt(a.label, a.on, () => { this.setAudio(a.i); this._renderMenu(); }));
    } else if (this.engine === 'hls') {
      m.append(h('div.note', 'Este stream tem uma faixa de áudio só.'));
    } else {
      const note = h('div.note', 'O navegador não deixa escolher o áudio neste formato. ');
      if (S.vlc) note.append(h('a', { onclick: () => this.openVlc() }, 'Abrir no VLC'), ' pra trocar a faixa.');
      m.append(note);
    }

    // Legenda
    m.append(h('div.sep'), h('h4', 'Legenda'));
    const cur = this.subSource;
    m.append(opt('Desligada', !cur, () => { this.setSub(null); this._renderMenu(); }));
    for (const s of this.subTracks()) {
      m.append(opt(s.label, cur && cur.type === 'hls' && cur.index === s.i, () => { this.setSub({ type: 'hls', index: s.i }); this._renderMenu(); }));
    }
    if (cur && cur.type === 'ext') m.append(opt(cur.name, true, () => {}));
    m.append(h('button.opt', { onclick: () => this._pickSubFile() }, h('span.ck', ico('upload')), h('span', 'Carregar arquivo .srt / .vtt…')));
    if (!this.hls && this.engine !== 'mpegts') {
      m.append(h('div.note', 'Legendas embutidas em MP4/MKV não aparecem no navegador; use um arquivo .srt ou o VLC.'));
    }

    if (cur) {
      m.append(h('h4', 'Atraso da legenda'));
      const val = h('span', `${this.subDelay > 0 ? '+' : ''}${this.subDelay.toFixed(1)}s`);
      const step = (d) => { this.subDelay = Math.round((this.subDelay + d) * 10) / 10; this.lastSubText = null; this._renderMenu(); };
      m.append(h('div.delay', h('button', { onclick: () => step(-0.5), title: 'Legenda mais cedo' }, '−'), val, h('button', { onclick: () => step(0.5), title: 'Legenda mais tarde' }, '+')));
    }
    m.append(h('h4', 'Tamanho'));
    m.append(seg([['P', 'P'], ['M', 'M'], ['G', 'G'], ['GG', 'GG']], S.settings.subSize, (v) => { setSetting('subSize', v); this._applySubStyle(); }));
    m.append(h('h4', 'Fundo'));
    m.append(seg([['none', 'Nenhum'], ['shadow', 'Sombra'], ['box', 'Caixa']], S.settings.subBg, (v) => { setSetting('subBg', v); this._applySubStyle(); }));

    // Qualidade
    if (this.hls && this.hls.levels.length > 1) {
      m.append(h('div.sep'), h('h4', 'Qualidade'));
      const auto = this.hls.autoLevelEnabled;
      m.append(opt('Automática', auto, () => { this.hls.currentLevel = -1; this._renderMenu(); }));
      const levels = this.hls.levels.map((l, i) => ({ i, l })).sort((a, b) => (b.l.height || 0) - (a.l.height || 0) || b.l.bitrate - a.l.bitrate);
      const heights = levels.map((x) => x.l.height);
      for (const { i, l } of levels) {
        const kbps = l.bitrate >= 1e6 ? `${(l.bitrate / 1e6).toFixed(1)} Mbps` : `${Math.round(l.bitrate / 1000)} kbps`;
        const dup = l.height && heights.filter((x) => x === l.height).length > 1;
        const label = l.height ? (dup ? `${l.height}p · ${kbps}` : `${l.height}p`) : kbps;
        m.append(opt(label, !auto && this.hls.currentLevel === i, () => { this.hls.currentLevel = i; this._renderMenu(); }));
      }
    }
  }

  // ---------- teclado ----------
  handleKey(e) {
    const k = e.key;
    const code = e.keyCode;
    // teclas de mídia do controle remoto
    if (k === 'MediaPlayPause' || code === 179) { this.togglePlay(); this._showCtrl(); return true; }
    if (k === 'MediaPlay' || code === 415) { this.video.play().catch(() => {}); this._showCtrl(); return true; }
    if (k === 'MediaPause' || code === 19) { this.video.pause(); return true; }
    if (k === 'MediaFastForward' || code === 417) { this.seekBy(30); return true; }
    if (k === 'MediaRewind' || code === 412) { this.seekBy(-30); return true; }
    if (k === 'MediaStop' || code === 413) { if (this.opts.onBack) this.opts.onBack(); else this.video.pause(); return true; }
    if (TV.on) {
      // com um botão dos controles em foco, as setas/OK navegam entre os botões
      if (this._ctrlFocused() || !this.menu.classList.contains('hidden')) { this._showCtrl(); return false; }
      if (k === 'Enter') { this.togglePlay(); this._showCtrl(); return true; }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        this._showCtrl();
        focusEl(this.btnPlay);
        return true;
      }
      if (this.opts.live && (k === 'ArrowLeft' || k === 'ArrowRight')) return false;
    }
    if (k === ' ' || k === 'k' || k === 'K') { this.togglePlay(); return true; }
    if (k === 'f' || k === 'F') { this.toggleFullscreen(); return true; }
    if (k === 'm' || k === 'M') { this.toggleMute(); return true; }
    if (!this.opts.live && k === 'ArrowLeft') { this.seekBy(-10); return true; }
    if (!this.opts.live && k === 'ArrowRight') { this.seekBy(10); return true; }
    if (!this.opts.live && k === 'ArrowUp') { this.video.volume = Math.min(1, this.video.volume + 0.05); return true; }
    if (!this.opts.live && k === 'ArrowDown') { this.video.volume = Math.max(0, this.video.volume - 0.05); return true; }
    return false;
  }

  destroy() {
    this._report();
    this.destroyed = true;
    clearInterval(this._subTimer);
    clearInterval(this._watchdog);
    clearTimeout(this._retryT);
    clearTimeout(this._hideT);
    this._removeNextCard();
    document.removeEventListener('fullscreenchange', this._onFs);
    document.removeEventListener('mousedown', this._onDocClick);
    if (document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {});
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    this._teardown();
    this.root.remove();
  }
}
