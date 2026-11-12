// Player: escolhe o motor (hls.js / mpegts.js / nativo), tenta de novo em falhas,
// controla áudio, legenda (renderizada pelo app), qualidade e versão.
import { h, ico, fmtTime, toast } from '../core/util.js';
import { icon } from '../core/icons.js';
import { flushSaves, S, C, setSetting, api, learnAudio, versionNames } from '../core/store.js';
import { SeekPreview } from './seekpreview.js';
import { claimScreen, heartbeat, endScreen } from './sessions.js';
import { readSubFile, cuesAt, subHtml } from './subs.js';
import { TV, focusEl, syncFocus } from '../tv/tv.js';
import { NativeVideo, nativeVideoAvailable } from './nativevideo.js';
import { debugSection, tone } from '../core/debug.js';
import { remuxStatus, remuxReady, remuxOffered, remuxSize, installRemux, probeMedia, browserAudio, RemuxVideo } from './remux.js';

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

// Os tocadores de HLS e de TS (uns 630 KB) só carregam quando um vídeo vai tocar: ler os dois a cada abertura do
// app pesava, principalmente na TV. O ?v= da build deixa o aparelho guardar em cache até a próxima versão.
let libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error(src)); };
    document.head.append(s);
  });
}
export function playerLibs() {
  if (window.Hls && window.mpegts) return Promise.resolve();
  if (!libsPromise) {
    const v = encodeURIComponent((S.build && (S.build.build || S.build.commit || S.build.version)) || '');
    libsPromise = Promise.all([loadScript(`/vendor/hls.min.js?v=${v}`), loadScript(`/vendor/mpegts.js?v=${v}`)])
      .catch((e) => { libsPromise = null; throw e; });
  }
  return libsPromise;
}

// É a própria TV (sem tela de toque)? O app no celular também liga o modo TV, mas lá mandar para a TV faz sentido.
const onRealTv = () => TV.on && !(navigator.maxTouchPoints > 0);

// Celular/tablet: sem mouse; o toque mostra ou esconde os controles.
const isTouch = () => !TV.on && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

// Pede só o primeiro byte do vídeo: erro HTTP ou página no lugar do vídeo é recusa do servidor, não formato.
async function sourceRefused(src) {
  if (!src) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(src, { headers: { Range: 'bytes=0-0' }, signal: ctl.signal, cache: 'no-store' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    return !r.ok || /text\/html|application\/json/.test(ct);
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
    ctl.abort(); // não mantém a conexão com a lista aberta
  }
}

// Quanto esperar pelo primeiro quadro de cada tentativa (a TV demora mais para abrir o decodificador).
const START_TIMEOUT = 20000;
const START_TIMEOUT_TV = 25000;

export function proxyUrl(url) {
  return '/proxy?url=' + encodeURIComponent(url);
}

// No Android, estes vão direto ao player nativo: o WebView não abre o contêiner ou costuma tocar sem som.
const NATIVE_FIRST = /\.(mkv|avi|wmv|flv)$/;

// Nomes curtos dos formatos para a linha "Reprodução" do menu.
const CODECS = {
  'video/avc': 'H.264', 'video/hevc': 'H.265', 'video/dolby-vision': 'Dolby Vision', 'video/av01': 'AV1', 'video/x-vnd.on2.vp9': 'VP9',
  'video/mpeg2': 'MPEG-2', 'video/mp4v-es': 'MPEG-4',
  'audio/mp4a-latm': 'AAC', 'audio/ac3': 'AC3', 'audio/eac3': 'E-AC3', 'audio/eac3-joc': 'E-AC3 Atmos', 'audio/vnd.dts': 'DTS',
  'audio/vnd.dts.hd': 'DTS-HD', 'audio/true-hd': 'TrueHD', 'audio/mpeg': 'MP3', 'audio/opus': 'Opus', 'audio/vorbis': 'Vorbis', 'audio/flac': 'FLAC',
};
const channels = (n) => (n > 2 ? `${n - 1}.1` : n === 2 ? 'estéreo' : n === 1 ? 'mono' : '');

function detectEngine(url, live) {
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.m3u8') || path.endsWith('.m3u')) return 'hls';
  if (path.endsWith('.ts') || path.endsWith('.mpegts')) return 'mpegts';
  if (live && !/\.[a-z0-9]{2,4}$/.test(path.split('/').pop())) return 'mpegts';
  if (live && /\.(mp4|webm|mkv|mov)$/.test(path)) return 'native';
  if (live) return 'hls';
  return 'native';
}

// App Android no celular: as telas ficam em pé e o vídeo em tela cheia deita, como nos apps de streaming.
// Na TV e fora do app Android não faz nada.
function videoLandscape(on) {
  try { if (window.IPTVKZAndroid && window.IPTVKZAndroid.setVideoLandscape) window.IPTVKZAndroid.setVideoLandscape(!!on); } catch {}
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
    if (!nativeVideoAvailable()) remuxStatus(); // PC: o componente de vídeo já está instalado? (pergunta uma vez)
    this._build();
    this._bind();
  }

  // ---------- DOM ----------
  _build() {
    const o = this.opts;
    // pôster transparente: sem ele, o WebView do Android mostra um botão de play gigante
    this.video = h('video', { playsinline: true, preload: 'auto', poster: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' });
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
    this.btnGear = this._btn('audioLang', 'Versão, áudio e qualidade', (e) => {
      e.stopPropagation();
      this.toggleMenu('settings');
    });
    // como nos streamings: legenda num botão próprio, ao lado da engrenagem (versão e áudio), perto do volume
    this.btnAV = this._btn('cc', 'Legendas', (e) => {
      e.stopPropagation();
      this.toggleMenu('av');
    });
    this.btnPip = this._btn('pip', 'Picture-in-picture', () => this.togglePip());
    // PC e celular: mandar o vídeo para uma TV da rede (Chromecast/Android TV pelo Cast, LG e outras pelo DLNA)
    this.btnCast = this._btn('cast', 'Assistir na TV', (e) => {
      e.stopPropagation();
      this.toggleMenu('cast');
    });
    this.timeEl = h('span.ptime');
    this.btnNext = o.next ? h('button.btn.small', { onclick: () => this._goNext(), title: 'Próximo episódio' }, ico('next'), 'Próximo') : null;

    let seek = null;
    if (!o.live) {
      this.seekFill = h('div.fill');
      this.seekBuf = h('div.buf');
      this.seekKnob = h('div.knob');
      this.seekTip = h('div.tip');
      seek = h('div.seek', { 'data-focus': '' }, h('div.track', this.seekBuf, this.seekFill), this.seekKnob, this.seekTip);
      this.preview = new SeekPreview({
        video: this.video,
        getUrl: () => (this.src ? proxyUrl(this.currentUrl()) : null),
        canLoad: () => this._previewAllowed(),
        onVisible: (on) => this.root && this.root.classList.toggle('has-strip', on),
      });
      seek.append(this.preview.el);
      this._seekEl = seek;
      this._bindSeek(seek);
    }

    const left = [this.btnPlay];
    if (!o.live) {
      left.push(this._holdBtn('back10', 'Voltar 10 segundos (segure para ir mais rápido)', -1));
      left.push(this._holdBtn('fwd10', 'Avançar 10 segundos (segure para ir mais rápido)', 1));
    }
    // ao vivo na TV já é tela cheia, e o menu seria quase só legenda, que canais não têm
    const liveTv = TV.on && o.live;
    left.push(h('div.vol', this.btnMute, this.volRange));
    if (!liveTv) left.push(this.btnAV, this.btnGear);
    left.push(o.live ? h('span.badge.onair.live-badge', 'AO VIVO') : this.timeEl);

    // filmes e séries já abrem ocupando a tela: tela cheia só no ao vivo, que no PC toca numa janela ao lado da lista
    this.prow = h('div.prow', left, h('div.grow'), this.btnNext, onRealTv() ? null : this.btnCast, TV.on || isTouch() ? null : this.btnPip, o.live && !liveTv ? this.btnFs : null);
    this.bottom = h('div.pbottom', seek, this.prow);

    const top = [];
    if (o.onBack) top.push(this._btn('back', 'Voltar (Esc)', () => o.onBack()));
    top.push(this.titleEl);
    this.top = h('div.ptop', top);

    // Antes do primeiro quadro: fundo escuro com a logo pequena do menu e o anel girando (diferente da splash,
    // para não parecer que o app reabriu). Some com um fade quando o vídeo começa. Depois, nas travadinhas, só o anel.
    this.cover = h('div.pl-cover', h('img', { src: '/img/logo-sidebar.webp', alt: '' }), h('div.spinner'));
    this.center = h('div.center', h('div.spinner'));
    this.errorEl = h('div.perror.hidden');
    this.menu = h('div.pmenu.hidden');
    this.nextCard = null;

    this.flashEl = h('div.seek-flash');
    this.ppEl = h('div.pp-flash'); // ícone de play/pause no centro, só ao apertar
    // Internet lenta: aviso discreto no canto, para não parecer defeito do player. Some quando o vídeo volta a fluir.
    this.netTag = h('div.net-tag.hidden', h('i'), h('span', 'Internet lenta'));
    this.noImageEl = h('div.no-image.hidden', h('b', 'Este canal está sem imagem neste aparelho'), h('span', 'O áudio continua tocando.'));
    this.root = h('div.player.ctrl-visible', this.video, this.subsEl, h('div.shade'), this.netTag, this.noImageEl, this.cover, this.top, this.center, this.flashEl, this.ppEl, this.bottom, this.menu, this.errorEl);
    this.root._player = this; // o Voltar do app acha o player em tela cheia por aqui
    if (!this.opts.live) videoLandscape(true); // filme e série: o player já abre deitado no celular
    this.host.append(this.root);
  }

  _btn(name, title, fn) {
    const b = h('button.pbtn', { title, onclick: fn });
    b.innerHTML = icon(name);
    return b;
  }

  // Clique pula 10s; segurando, a barra acelera como nas setas.
  _holdBtn(name, title, dir) {
    let timer = null;
    let repeat = null;
    let held = false;
    const stop = () => {
      clearTimeout(timer);
      clearInterval(repeat);
      if (held) this._commitScrub();
    };
    const b = this._btn(name, title, () => {
      if (held) { held = false; return; } // foi segurado: o clique do fim não conta
      this.seekBy(dir * 10);
    });
    b.addEventListener('pointerdown', () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        this._scrubKey(dir);
        repeat = setInterval(() => { this._showCtrl(); this._scrubKey(dir); }, 100);
      }, 350);
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', () => { stop(); held = false; });
    b.addEventListener('pointerleave', () => { stop(); held = false; });
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
    on('waiting', () => { this._spin(true); this._netStall(true); if (this.hadFrame) this.stalls = (this.stalls || 0) + 1; });
    on('playing', () => {
      this._spin(false);
      this._netStall(false);
      this.root.classList.remove('awaiting');
      this._clearStartTimer();
      if (this.playFrom == null) this.playFrom = v.currentTime;
      this.hadFrame = true;
      if (this.openMs == null && this.loadAt) this.openMs = Math.round(performance.now() - this.loadAt);
      this._hideError();
      setTimeout(() => !this.destroyed && this._learnAudio(), 1500);
    });
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
      if (this.engine === 'remux' && this.remux) return this._fail('network', this.gen);
      if (this.engine !== 'native') return;
      const code = v.error && v.error.code;
      const gen = this.gen;
      if (code === 3) return this._fail('format', gen);
      if (code !== 4) return this._fail('network', gen);
      // O navegador dá o mesmo código para "formato não suportado" e "o servidor recusou"
      // (limite de conexões da lista, link expirado). Pergunta ao servidor antes de culpar o formato.
      sourceRefused(v.currentSrc || v.src).then((refused) => this._fail(refused ? 'network' : 'format', gen));
    });
    v.addEventListener('click', () => {
      if (!this.menu.classList.contains('hidden')) return this.closeMenu();
      if (!isTouch()) return this.togglePlay();
      if (this.root.classList.contains('ctrl-visible')) {
        clearTimeout(this._hideT);
        this.root.classList.remove('ctrl-visible');
      } else this._showCtrl();
    });
    v.addEventListener('dblclick', () => { if (!isTouch()) this.toggleFullscreen(); });

    // no toque o navegador simula um mousemove, que reabriria os controles
    this.root.addEventListener('mousemove', () => { if (!isTouch()) this._showCtrl(); });
    this.root.addEventListener('mouseleave', () => this._scheduleHide(600));
    this._onFs = () => this._setIcon(this.btnFs, document.fullscreenElement ? 'exitFs' : 'fullscreen');
    document.addEventListener('fullscreenchange', this._onFs);
    this._onDocClick = (e) => {
      if (!this.menu.contains(e.target) && !this.btnGear.contains(e.target) && !this.btnAV.contains(e.target) && !this.btnCast.contains(e.target)) this.closeMenu();
    };
    document.addEventListener('mousedown', this._onDocClick);
    this._onKeyUp = (e) => {
      if (!this.scrub || !(e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Left' || e.key === 'Right' || e.keyCode === 37 || e.keyCode === 39)) return;
      // algumas TVs mandam "soltou" entre as repetições: só confirma se nenhuma tecla vier logo depois
      clearTimeout(this._scrubT);
      this._scrubT = setTimeout(() => this._commitScrub(), 220);
    };
    document.addEventListener('keyup', this._onKeyUp);
    // Home ou outro app na frente: grava o ponto na hora, a TV pode fechar o app depois
    this._onHide = () => { if (document.hidden) { this._report(); flushSaves(); } };
    document.addEventListener('visibilitychange', this._onHide);

    this._subTimer = setInterval(() => this._renderSubs(), 100);
    this._perfTimer = setInterval(() => this._samplePerf(), 1000);
    this._watchdog = setInterval(() => { this._checkStall(); this._checkImage(); this._checkSound(); }, 5000);
    this._showCtrl();
    debugSection('player', () => this._debugRows());
  }

  // ---------- carregamento ----------
  load(src) {
    this.src = src;
    this.loadAt = performance.now(); // para o "abriu em N ms" do menu
    this.stalls = 0;
    this.openMs = null;
    this.perf = null;
    this.hadFrame = false;
    this.attempts = 0;
    this.usingAlt = false;
    this.resumeAt = src.startAt || 0;
    this.subSource = null;
    this.subDelay = 0;
    this.autoPicked = false;
    this.useNative = false;
    this.useRemux = false;
    this.remuxChecked = false;
    this.remuxDeclined = false;
    this.titleEl.textContent = src.title || this.opts.title || '';
    if (this.preview) this.preview.reset();
    this._hideError();
    this._removeNextCard();
    this.nextDismissed = false;
    this._resetImage();
    this._claimAndStart(src);
  }

  // ---------- ao vivo com som e sem imagem (vídeo em formato que este caminho não abre) ----------
  _resetImage() {
    this.forceNative = false;
    this.imgAltTried = false;
    this.imgNativeTried = false;
    this.imgTrying = false;
    this.imgDone = false;
    this.imgFromAlt = null;
    this.noImgTicks = 0;
    this.noImageEl.classList.add('hidden');
  }

  _checkImage() {
    const v = this.video;
    if (!this.opts.live || this.destroyed || this.imgDone || v.paused || !this.errorEl.classList.contains('hidden')) return;
    if (v.videoWidth > 0) {
      this.imgTrying = false;
      this.noImgTicks = 0;
      return;
    }
    const moved = v.currentTime > this.noImgTime;
    this.noImgTime = v.currentTime;
    this.noImgTicks = moved ? this.noImgTicks + 1 : 0;
    if (this.noImgTicks >= 2) this._nextImageRoute();
  }

  // No Android, vídeo andando sem nenhum áudio decodificado é áudio que o WebView não abre (AC3, DTS):
  // passa para o player nativo, que tem o decodificador.
  _checkSound() {
    const v = this.video;
    const fix = nativeVideoAvailable() ? 'native' : remuxOffered() && !this.remuxDeclined ? 'remux' : null;
    if (!fix || this.engine === 'exo' || this.engine === 'remux' || this.destroyed || v.paused || typeof v.webkitAudioDecodedByteCount !== 'number') return;
    const silent = v.currentTime > 2 && v.webkitAudioDecodedByteCount === 0 && v.webkitVideoDecodedByteCount > 0;
    this.silentTicks = silent ? (this.silentTicks || 0) + 1 : 0;
    if (this.silentTicks >= 2) {
      this.silentTicks = 0;
      if (fix === 'native') this._toNative();
      else this._toRemux();
    }
  }

  // Link alternativo, depois o decodificador da TV; sem imagem em nenhum, volta ao áudio com aviso.
  _nextImageRoute() {
    if (this.imgFromAlt === null) this.imgFromAlt = this.usingAlt;
    this.imgTrying = true;
    if (this.src.alt && !this.usingAlt && !this.imgAltTried) {
      this.imgAltTried = true;
      this.usingAlt = true;
      return this._start(this.src.alt);
    }
    if ((TV.on || nativeVideoAvailable()) && !this.imgNativeTried) {
      this.imgNativeTried = true;
      if (nativeVideoAvailable()) {
        this.useNative = true;
        return this._start(this.currentUrl());
      }
      this.forceNative = true;
      // o player da TV lida melhor com HLS do que com .ts puro
      const hlsUrl = [this.src.url, this.src.alt].find((u) => u && /\.m3u8(\?|$)/i.test(u));
      if (hlsUrl) this.usingAlt = hlsUrl === this.src.alt && hlsUrl !== this.src.url;
      return this._start(this.currentUrl());
    }
    this.imgTrying = false;
    this.imgDone = true;
    this.forceNative = false;
    this.useNative = false;
    this.usingAlt = this.imgFromAlt;
    this._start(this.currentUrl());
    this.noImageEl.classList.remove('hidden');
  }

  // Confere o limite de telas da conta antes de abrir o vídeo.
  async _claimAndStart(src) {
    const token = (this._loadToken = (this._loadToken || 0) + 1);
    this.root.classList.add('awaiting'); // a logo só aparece até o primeiro quadro, não nas travadinhas
    this._spin(true);
    this.netTag.classList.add('hidden');
    this._netStall(true); // demorando muito para abrir também mostra o aviso
    // o limite de telas e os tocadores ao mesmo tempo; sem os tocadores, o vídeo vai pelo player do navegador
    const [ok] = await Promise.all([claimScreen(), playerLibs().catch(() => {})]);
    if (this.destroyed || token !== this._loadToken) return;
    if (!ok) {
      this._spin(false);
      const leave = this.opts.onCancel || this.opts.onBack;
      if (leave) leave();
      return;
    }
    this._beat();
    this._start(src.url);
  }

  _beat() {
    clearInterval(this._beatT);
    const send = () => heartbeat(this.titleEl.textContent).then((r) => {
      if (r && r.stop && !this.destroyed) this._stoppedElsewhere(r.by);
    }).catch(() => {});
    send();
    this._beatT = setInterval(send, 5000);
  }

  // Outra tela assumiu a conta: para aqui e oferece retomar.
  _stoppedElsewhere(by) {
    clearInterval(this._beatT);
    const at = this.video.currentTime;
    this._teardown();
    this._spin(false);
    this.errorEl.replaceChildren(
      ico('tv'),
      h('h3', `Agora está tocando em ${by}`),
      h('p', 'A conta foi usada em outro aparelho e a reprodução parou aqui.'),
      h('div.acts',
        this.opts.onBack ? h('button.btn', { onclick: () => this.opts.onBack() }, 'Voltar') : null,
        h('button.btn.primary', { onclick: () => this.load({ ...this.src, startAt: this.opts.live ? 0 : at }) }, ico('play'), 'Assistir aqui')),
    );
    this.errorEl.classList.remove('hidden');
    if (TV.on) focusEl(this.errorEl.querySelector('.btn.primary'));
  }

  currentUrl() {
    return this.usingAlt && this.src.alt ? this.src.alt : this.src.url;
  }

  _teardown() {
    if (this.exo) { this.exo.close(); this.exo = null; }
    if (this.remux) { this.remux.close(); this.remux = null; }
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
    this._perfPrev = null;
    this.perf = null;
    const gen = (this.gen = (this.gen || 0) + 1);
    this._spin(true);
    this.lastProgressAt = Date.now();
    this.lastTime = -1;
    this.noImgTicks = 0;
    this.noImgTime = -1;
    this.playFrom = null;
    this._armStartTimer(gen);
    const live = !!this.opts.live;
    let engine = detectEngine(url, live);
    if (engine === 'hls' && !(window.Hls && Hls.isSupported())) engine = 'native';
    if (engine === 'mpegts' && !(window.mpegts && mpegts.getFeatureList().mseLivePlayback)) engine = 'native';
    if (this.forceNative) engine = 'native';
    const kind = engine;
    // No Android, filme e série vão sempre ao player nativo: ele desenha o vídeo direto na camada de vídeo do aparelho.
    // Pelo WebView, cada quadro (4K principalmente) é reduzido pela GPU para caber na página, e a imagem trava.
    if (nativeVideoAvailable() && (this.useNative || !live || NATIVE_FIRST.test(String(url).split(/[?#]/)[0].toLowerCase()))) engine = 'exo';
    // PC com o componente de vídeo: MKV/AVI etc. passam por ele (o navegador abre o MKV, mas sem som se o áudio
    // for AC3/DTS); antes, lê as faixas, e se o navegador tocar tudo, segue pelo caminho normal.
    const ext = NATIVE_FIRST.test(String(url).split(/[?#]/)[0].toLowerCase());
    if (engine !== 'exo' && remuxReady() && (this.useRemux || (ext && !this.remuxChecked))) engine = 'remux';
    this.engine = engine;
    const purl = proxyUrl(url);
    const v = this.video;

    if (engine === 'hls') {
      const hls = new Hls({
        enableWorker: true,
        // na TV a memória de vídeo é curta: guarda pouco do que já passou para sobrar reserva à frente
        backBufferLength: TV.on ? (live ? 8 : 30) : (live ? 30 : 90),
        maxBufferLength: 30,
        liveSyncDurationCount: 4, // um segmento a mais de reserva no ao vivo
        maxBufferHole: 0.5,
        nudgeMaxRetry: 6,
        manifestLoadingMaxRetry: 2,
        levelLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        subtitleDisplay: false,
        capLevelToPlayerSize: true, // no automático, não baixa resolução maior do que a tela consegue mostrar
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
        {
          enableWorker: true,
          lazyLoad: false,
          // folga maior: em bitrate alto, pular para perto do ao vivo esvazia a reserva e causa novas travadas
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 20,
          liveBufferLatencyMinRemain: 8,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 20,
          autoCleanupMinBackwardDuration: 8,
        },
      );
      this.mts = p;
      p.on(mpegts.Events.ERROR, (type, detail) => {
        this._fail(type === mpegts.ErrorTypes.MEDIA_ERROR && /codec|unsupported|mse/i.test(String(detail)) ? 'format' : 'network', gen);
      });
      p.attachMediaElement(v);
      p.load();
      const pr = p.play();
      if (pr && pr.catch) pr.catch(() => {});
    } else if (engine === 'remux') {
      this._startRemux(url, gen);
    } else if (engine === 'exo') {
      // a "tela cheia" do navegador cobriria o vídeo nativo: o player só passa a ocupar a tela toda
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        this.root.classList.add('pseudo-fs');
      }
      const exo = new NativeVideo(v, this.root, {
        onError: (k) => this._fail(k, gen),
        onTracks: () => this._syncNativeTracks(),
        onCue: () => { this.lastSubText = null; this._renderSubs(); },
      });
      this.exo = exo;
      exo.open(purl, kind === 'hls' ? 'hls' : 'auto', this.resumeAt > 1 ? this.resumeAt : 0, S.settings.audioLang);
    } else {
      v.src = purl;
      v.play().catch(() => {});
    }
  }

  async _startRemux(url, gen) {
    let info;
    try {
      info = await probeMedia(url);
    } catch {
      return this._fail('network', gen);
    }
    if (this.destroyed || gen !== this.gen) return;
    if (!this.useRemux && info.audio.every((a) => browserAudio(a.codec))) {
      this.remuxChecked = true; // o navegador toca este arquivo sozinho
      return this._start(url);
    }
    this.useRemux = true;
    this.remux = new RemuxVideo(this.video, info);
    this.remux.open(url, this.resumeAt > 1 ? this.resumeAt : 0);
  }

  // PC: o navegador não toca o áudio (ou o arquivo). Com o componente de vídeo, continua do mesmo ponto;
  // sem ele, oferece baixar (uma vez só, alguns MB).
  _toRemux() {
    const t = this.video.currentTime;
    if (!this.opts.live && t > 1) this.resumeAt = t;
    if (remuxReady()) {
      this.useRemux = true;
      this.attempts = 0;
      return this._start(this.currentUrl());
    }
    this._offerRemux();
  }

  _offerRemux() {
    this._teardown();
    this._clearStartTimer();
    this._spin(false);
    const mb = Math.round(remuxSize() / 1048576);
    const bar = h('div.dl-bar', h('i'));
    const msg = h('p', `O áudio deste vídeo (AC3, DTS ou parecido) não toca no navegador. O IPTVKZ pode baixar um componente de vídeo${mb > 1 ? ` de ${mb} MB` : ''}, uma vez só, e vídeos assim passam a tocar aqui mesmo.`);
    const go = h('button.btn.primary', {
      onclick: async () => {
        go.disabled = true;
        later.disabled = true;
        msg.textContent = 'Baixando o componente de vídeo...';
        bar.classList.add('on');
        try {
          await installRemux((st) => { bar.firstChild.style.transform = `scaleX(${st.progress || 0})`; });
          if (this.destroyed) return;
          this._hideError();
          this.useRemux = true;
          this.attempts = 0;
          this._start(this.currentUrl());
        } catch (err) {
          msg.textContent = `Não deu para baixar o componente: ${err.message}`;
          go.disabled = false;
          later.disabled = false;
        }
      },
    }, ico('download'), 'Baixar e tocar');
    const later = h('button.btn', {
      onclick: () => {
        this.remuxDeclined = true;
        this._hideError();
        this._start(this.currentUrl()); // segue sem som / mostra o erro de formato
      },
    }, 'Agora não');
    this.errorEl.replaceChildren(ico('download'), h('h3', 'Falta um componente para este vídeo'), msg, bar, h('div.acts', later, go));
    this.errorEl.classList.remove('hidden');
    if (TV.on) focusEl(go);
  }

  // O WebView recusou o formato (ou toca sem som): continua do mesmo ponto no player nativo do Android.
  _toNative() {
    const t = this.video.currentTime;
    if (!this.opts.live && t > 1) this.resumeAt = t;
    this.useNative = true;
    this.attempts = 0;
    this._start(this.currentUrl());
  }

  // O servidor da lista pode aceitar a conexão e nunca mandar o vídeo (sobrecarga, link travado).
  // Sem isso o carregamento girava sem fim: o vigia de travadas não age com o vídeo ainda pausado.
  _armStartTimer(gen) {
    this._clearStartTimer();
    this._startT = setTimeout(() => {
      this._startT = null;
      const v = this.video;
      if (this.destroyed || gen !== this.gen || this.playFrom != null) return;
      if (v.paused && v.readyState >= 2) return; // já tem imagem, só está pausado
      this._fail('timeout', gen);
    }, TV.on ? START_TIMEOUT_TV : START_TIMEOUT);
  }

  _clearStartTimer() {
    clearTimeout(this._startT);
    this._startT = null;
  }

  _fail(kind, gen) {
    // Cada _start() tem uma geração; erros atrasados de uma tentativa antiga são ignorados,
    // e cada tentativa só é tratada uma vez.
    if (this.destroyed || gen !== this.gen || this.failedGen === gen) return;
    this.failedGen = gen;
    this._clearStartTimer();
    if (this.imgTrying) return this._nextImageRoute(); // a tentativa de recuperar a imagem falhou: próxima
    if (kind === 'format' && this.engine !== 'exo' && nativeVideoAvailable()) return this._toNative();
    if (kind === 'format' && this.engine !== 'remux' && !this.remuxDeclined && remuxOffered()) return this._toRemux();
    const t = this.video.currentTime;
    if (!this.opts.live && t > 1) this.resumeAt = t;

    if (kind !== 'format' && this.attempts < (kind === 'timeout' ? 1 : 2)) {
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
    if (this.destroyed || v.paused || this._startT || !this.errorEl.classList.contains('hidden')) {
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
    const slow = kind === 'timeout';
    const title = fmt ? 'Este aparelho não toca este formato' : this.opts.live ? 'Canal indisponível' : slow ? 'O servidor da lista não mandou o vídeo' : 'Não foi possível carregar';
    const text = fmt
      ? 'Isso é comum com MKV, áudio AC3/E-AC3 ou vídeo H.265. Tente outra versão do título, se houver, ou assista em outro aparelho.'
      : slow
        ? 'O servidor aceitou o pedido, mas o vídeo não chegou. Costuma ser sobrecarga do provedor ou link fora do ar. Tente de novo em instantes.'
        : 'O canal pode estar fora do ar, ou o servidor da lista recusou a conexão. Tente de novo em instantes.';
    this.errorEl.replaceChildren(
      ico('alert'),
      h('h3', title),
      h('p', text),
      h('div.acts',
        h('button.btn', { onclick: () => this.retry() }, ico('refresh'), 'Tentar de novo')),
    );
    this.errorEl.classList.remove('hidden');
    clearTimeout(this._netT);
    this.netTag.classList.add('hidden');
    if (TV.on) focusEl(this.errorEl.querySelector('.btn')); // senão o controle fica preso atrás do player
  }

  _hideError() {
    this.errorEl.classList.add('hidden');
  }

  retry() {
    this._hideError();
    if (!this.hadFrame) this.root.classList.add('awaiting');
    this._resetImage();
    this.attempts = 0;
    this.usingAlt = false;
    this._start(this.src.url);
  }

  _spin(on) {
    this.center.classList.toggle('hidden', !on);
  }

  // O vídeo parou esperando dados (ou demora a abrir): depois de um tempo, mostra "Internet lenta" no canto.
  // Sem internet nenhuma, o texto diz isso. Ao voltar a tocar, o aviso fica mais uns segundos e some.
  _netStall(waiting) {
    clearTimeout(this._netT);
    if (waiting) {
      this._netT = setTimeout(async () => {
        if (this.destroyed || !this.errorEl.classList.contains('hidden')) return;
        let offline = navigator.onLine === false;
        try { offline = offline || (await api('/api/net')).online === false; } catch {}
        if (this.destroyed) return;
        this.netTag.lastChild.textContent = offline ? 'Sem internet' : 'Internet lenta';
        this.netTag.classList.remove('hidden');
      }, this.hadFrame ? 4000 : 12000); // folga: travadinhas curtas e servidores lentos para abrir não são internet ruim
    } else if (!this.netTag.classList.contains('hidden')) {
      this._netT = setTimeout(() => this.netTag.classList.add('hidden'), 3000);
    }
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
      this._flashPlay(true);
    } else {
      v.pause();
      this._flashPlay(false);
    }
  }

  // Confirma no meio da tela o que o aperto fez (como no YouTube): ▶ ao continuar, ❚❚ ao pausar.
  _flashPlay(playing) {
    const el = this.ppEl;
    el.innerHTML = icon(playing ? 'play' : 'pause');
    el.classList.remove('on');
    void el.offsetWidth; // recomeça a animação a cada aperto
    el.classList.add('on');
    clearTimeout(this._ppT);
    this._ppT = setTimeout(() => el.classList.remove('on'), 700);
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    if (!this.video.muted && this.video.volume === 0) this.video.volume = 0.5;
  }

  // Aviso no meio da tela ao pular; apertos seguidos somam (+10s, +20s...).
  _flashSeek(s) {
    const now = Date.now();
    const f = this._flash;
    const sum = f && now - f.at < 1000 && Math.sign(f.sum) === Math.sign(s) ? f.sum + s : s;
    this._flash = { sum, at: now };
    const el = this.flashEl;
    el.className = `seek-flash ${s < 0 ? 'left' : 'right'}`;
    el.innerHTML = `${icon(s < 0 ? 'rew' : 'fwd')}<span>${s < 0 ? '−' : '+'}${Math.abs(sum)}s</span>`;
    void el.offsetWidth; // recomeça a animação a cada aperto
    el.classList.add('on');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => el.classList.remove('on'), 900);
  }

  seekBy(s) {
    const v = this.video;
    if (this.opts.live || !Number.isFinite(v.duration)) return;
    const target = Math.max(0, Math.min(v.duration - 1, v.currentTime + s));
    v.currentTime = target;
    this._flashSeek(s);
    if (this.preview) {
      this.preview.show(target, target / v.duration, this._seekEl.offsetWidth);
      this.preview.hide(2200);
    }
    this._showCtrl();
  }

  toggleFullscreen() {
    // app Android: a tela cheia é da própria página (a do WebView não é confiável), e no celular ela deita a tela
    if (this.exo || window.IPTVKZAndroid) {
      const on = this.root.classList.toggle('pseudo-fs');
      if (this.opts.live) videoLandscape(on);
      return this._setIcon(this.btnFs, on ? 'exitFs' : 'fullscreen');
    }
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    // iPhone: só o próprio vídeo entra em tela cheia
    if (!this.root.requestFullscreen) return this.video.webkitEnterFullscreen && this.video.webkitEnterFullscreen();
    this.root.requestFullscreen().then(() => {
      if (isTouch() && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }

  async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      toast('Picture-in-picture indisponível para este vídeo', 'error');
    }
  }

  _showCtrl() {
    this.root.classList.add('ctrl-visible');
    this.root.classList.remove('hide-cursor');
    this._scheduleHide(TV.on && this.opts.live ? 5000 : 2800);
  }

  focusControls() {
    this._showCtrl();
    focusEl(this.btnPlay);
  }

  leaveControls() {
    if (document.activeElement) document.activeElement.blur();
    syncFocus();
  }

  _scheduleHide(ms) {
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => {
      if (this.video.paused || !this.menu.classList.contains('hidden')) return;
      if (this._ctrlFocused()) {
        // no ao vivo as setas trocam de canal: sem uso, o foco solta dos botões
        if (!(TV.on && this.opts.live)) return this._scheduleHide(ms);
        this.leaveControls();
      }
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
    // Arrastar: a bolinha e o tempo seguem o dedo/mouse na hora; o vídeo só busca ao soltar, e até ele chegar lá
    // a tela fica no ponto escolhido (_seekTo), sem voltar para a posição antiga enquanto carrega.
    const show = (ratio) => {
      const d = this.video.duration;
      this._paintSeek(ratio);
      if (Number.isFinite(d)) this.timeEl.textContent = `${fmtTime(ratio * d)} / ${fmtTime(d)}`;
      clearTimeout(this._hideT); // controles não somem no meio do arraste
    };
    const finish = (e) => {
      if (!dragging) return;
      dragging = false;
      const d = this.video.duration;
      if (!Number.isFinite(d)) return;
      const t = ratioAt(e) * d;
      this._seekTo = { t, at: Date.now() };
      show(t / d);
      this._scheduleHide(3000);
      setTimeout(() => { this.video.currentTime = t; }, 0); // o pedido segue depois do desenho
    };
    seek.addEventListener('pointermove', (e) => {
      const d = this.video.duration;
      if (!Number.isFinite(d)) return;
      const ratio = ratioAt(e);
      this.seekTip.style.left = ratio * 100 + '%';
      this.seekTip.textContent = fmtTime(ratio * d);
      this.preview.show(ratio * d, ratio, seek.getBoundingClientRect().width / (parseFloat(document.documentElement.style.zoom) || 1));
      if (dragging) show(ratio);
    });
    seek.addEventListener('pointerleave', () => this.preview.hide(150));
    seek.addEventListener('pointerdown', (e) => {
      dragging = true;
      seek.setPointerCapture(e.pointerId);
      show(ratioAt(e));
    });
    seek.addEventListener('pointerup', finish);
    seek.addEventListener('pointercancel', finish);
    this._isDragging = () => dragging;
  }

  _paintSeek(ratio) {
    this.seekFill.style.width = ratio * 100 + '%';
    this.seekKnob.style.left = ratio * 100 + '%';
  }

  // Tempo mostrado na tela: logo depois de soltar a barra, o ponto escolhido, até o vídeo chegar lá (ou 8 s)
  // O player nativo diz que já está no ponto novo logo ao pedir, e depois ainda informa a posição antiga por um
  // instante: a tela só solta o ponto escolhido quando o vídeo estiver nele por pelo menos 1,2 s (ou depois de 10 s).
  _shownTime() {
    const v = this.video;
    const s = this._seekTo;
    if (!s) return v.currentTime;
    const near = Math.abs(v.currentTime - s.t) < 2;
    const age = Date.now() - s.at;
    if (age < 10000 && (!near || age < 1200)) return near ? v.currentTime : s.t;
    this._seekTo = null;
    return v.currentTime;
  }

  _updateSeek() {
    if (this.opts.live || !this.seekFill) return;
    const v = this.video;
    const d = v.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    if (!this._isDragging() && !this.scrub) this._paintSeek(this._shownTime() / d);
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
    // só depois de tocar de verdade (10s) as tentativas voltam a zero; antes, contam para desistir
    if (this.attempts && this.playFrom != null && v.currentTime - this.playFrom > 10) this.attempts = 0;
    if (!this.opts.live) {
      this.preview.capture();
      if (!this.scrub && !this._isDragging()) this.timeEl.textContent = `${fmtTime(this._shownTime())} / ${fmtTime(v.duration)}`;
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
    // sem duração conhecida (alguns MKV e streams), salva só o ponto, com duração 0
    if (this.opts.onTime && !this.opts.live && v.currentTime > 0) {
      this.opts.onTime(v.currentTime, Number.isFinite(v.duration) ? v.duration : 0);
    }
  }

  _onEnded() {
    this._report();
    if (this.opts.next) this._showNextCard(S.settings.autoNext);
    else if (this.opts.onEnded) this.opts.onEnded();
  }

  // Prévia busca quadros com uma conexão a mais: só quando o formato e a conta permitem,
  // para não derrubar o vídeo principal em contas de conexão única.
  async _previewAllowed() {
    // TVs têm um só decodificador: um segundo vídeo derruba o principal e ele volta ao ponto anterior.
    if (TV.on || this.engine !== 'native') return false;
    const r = await api(`/api/list-status?list=${encodeURIComponent(C().listId)}`);
    return r.maxCons == null || r.maxCons - (r.activeCons || 0) >= 1;
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
    if (this.exo) return this.exo.text.map((t, i) => ({ i, label: trackLabel(t, i), raw: t }));
    if (!this.hls) return [];
    return this.hls.subtitleTracks.map((t, i) => ({ i, label: trackLabel(t, i), raw: t }));
  }

  setSub(src) {
    this.subSource = src;
    if (this.hls) this.hls.subtitleTrack = src && src.type === 'hls' ? src.index : -1;
    if (this.exo) {
      const t = src && src.type === 'hls' ? this.exo.text[src.index] : null;
      this.exo.setText(t ? t.id : null);
    }
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

  // Faixas do player nativo: na primeira vez segue a preferência de legenda; numa nova tentativa, repete a escolha.
  _syncNativeTracks() {
    this._learnAudio();
    const exo = this.exo;
    if (!exo || exo.synced || (!exo.audio.length && !exo.text.length)) return;
    exo.synced = true;
    if (this.autoPicked) {
      if (this.subSource && this.subSource.type === 'hls') this.setSub(this.subSource);
      return;
    }
    this.autoPicked = true;
    const cur = exo.audio.find((a) => a.on);
    const audioIsPt = cur && (cur.lang || cur.name) ? isPt(cur) : null;
    const ptSub = exo.text.findIndex(isPt);
    const mode = S.settings.subMode;
    let pick = -1;
    if (mode === 'always' && ptSub >= 0) pick = ptSub;
    if (mode === 'auto' && audioIsPt === false && ptSub >= 0) pick = ptSub;
    if (pick >= 0) this.setSub({ type: 'hls', index: pick });
  }

  // Guarda os idiomas de áudio desta versão: nos próximos acessos, "Versão 2" aparece como "Português".
  _learnAudio() {
    if (!this.src || this.learnedGen === this.gen) return;
    let langs = [];
    if (this.exo) langs = this.exo.audio.map((a) => a.lang);
    else if (this.hls) langs = this.hls.audioTracks.map((t) => t.lang);
    else if (this.video.audioTracks) langs = [...this.video.audioTracks].map((t) => t.language);
    langs = langs.filter((l) => l && !/^und/i.test(l));
    if (!langs.length) return;
    this.learnedGen = this.gen;
    learnAudio(this.currentUrl(), langs);
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
      } else if (this.exo) {
        text = this.exo.cue;
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
  toggleMenu(mode = 'av') {
    const open = !this.menu.classList.contains('hidden');
    if (!open || this.menuMode !== mode) {
      this.menuMode = mode;
      this.menu.classList.toggle('left', mode !== 'cast'); // legenda e áudio ficam perto do volume; a TV, à direita
      this._renderMenu();
      this.menu.classList.remove('hidden');
      this._showCtrl();
      if (TV.on) focusEl(this.menu.querySelector('.opt.on, .opt, button'));
    } else this.closeMenu();
  }

  closeMenu() {
    const wasOpen = !this.menu.classList.contains('hidden');
    this.menu.classList.add('hidden');
    if (wasOpen && TV.on && this.menu.contains(document.activeElement)) focusEl(this.menuMode === 'av' ? this.btnAV : this.btnGear);
  }

  _ctrlFocused() {
    const a = document.activeElement;
    return !!a && a !== this.video && this.root.contains(a) && (a.tagName === 'BUTTON' || a.tagName === 'INPUT' || a === this._seekEl);
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

    if (this.menuMode === 'settings') return this._renderSettings(m, seg, opt);
    if (this.menuMode === 'cast') return this._renderCast(m, opt);

    // Botão de legenda: só a legenda
    m.append(h('h4', 'Legenda'));
    const cur = this.subSource;
    m.append(opt('Desligada', !cur, () => { this.setSub(null); this._renderMenu(); }));
    for (const s of this.subTracks()) {
      m.append(opt(s.label, cur && cur.type === 'hls' && cur.index === s.i, () => { this.setSub({ type: 'hls', index: s.i }); this._renderMenu(); }));
    }
    if (cur && cur.type === 'ext') m.append(opt(cur.name, true, () => {}));
    m.append(h('button.opt', { onclick: () => this._pickSubFile() }, h('span.ck', ico('upload')), h('span', 'Carregar arquivo .srt / .vtt...')));
    if (!this.hls && !this.exo && this.engine !== 'mpegts') {
      m.append(h('div.note', 'Legendas embutidas em MP4/MKV não aparecem aqui; use um arquivo .srt ou .vtt.'));
    }

    if (cur) {
      m.append(h('h4', 'Atraso da legenda'));
      const val = h('span', `${this.subDelay > 0 ? '+' : ''}${this.subDelay.toFixed(1)}s`);
      const step = (d) => { this.subDelay = Math.round((this.subDelay + d) * 10) / 10; this.lastSubText = null; this._renderMenu(); };
      m.append(h('div.delay', h('button', { onclick: () => step(-0.5), title: 'Legenda mais cedo' }, '−'), val, h('button', { onclick: () => step(0.5), title: 'Legenda mais tarde' }, '+')));
    }
    m.append(h('div.sep'), h('h4', 'Tamanho'));
    m.append(seg([['P', 'P'], ['M', 'M'], ['G', 'G'], ['GG', 'GG']], S.settings.subSize, (v) => { setSetting('subSize', v); this._applySubStyle(); }));
    m.append(h('h4', 'Fundo'));
    m.append(seg([['none', 'Nenhum'], ['shadow', 'Sombra'], ['box', 'Caixa']], S.settings.subBg, (v) => { setSetting('subBg', v); this._applySubStyle(); }));
  }

  // ---------- Assistir na TV ----------
  async _renderCast(m, opt) {
    m.append(h('h4', 'Assistir na TV'));
    const box = h('div', h('div.note', 'Procurando TVs na rede...'));
    m.append(box);
    const fresh = this._castFresh;
    this._castFresh = false;
    let list = [];
    try { list = await api(`/api/cast/devices${fresh ? '?fresh=1' : ''}`); } catch {}
    if (this.menuMode !== 'cast' || !m.contains(box)) return;
    const again = h('button.opt', { onclick: () => { this._castFresh = true; this._renderMenu(); } }, h('span.ck', ico('refresh')), h('span', 'Procurar de novo'));
    if (!list.length) {
      box.replaceChildren(h('div.note', 'Nenhuma TV encontrada. Ela precisa estar ligada e no mesmo Wi-Fi. Funciona com Android TV, Google TV, Chromecast e TVs com DLNA (LG, Samsung e outras).'), again);
      return;
    }
    box.replaceChildren(...list.map((d) => opt(d.name + (d.model && d.model !== d.name ? ` (${d.model})` : ''), false, () => this._castTo(d))), again);
  }

  // Assistir na TV: manda o endereço do vídeo direto para a TV e pronto. A TV busca e toca sozinha, sem depender
  // deste aparelho (pode fechar o app). Aqui o vídeo para, e o filme/série fecha o player.
  async _castTo(dev) {
    this.closeMenu();
    const v = this.video;
    const at = this.opts.live ? 0 : v.currentTime;
    toast(`Abrindo na TV ${dev.name}...`, 'info', 2500);
    try {
      await api('/api/cast/play', { method: 'POST', body: JSON.stringify({ id: dev.id, url: this.currentUrl(), title: this.titleEl.textContent, live: !!this.opts.live, startAt: at }) });
    } catch (err) {
      toast(`Não deu para tocar na TV: ${err.message}`, 'error');
      return;
    }
    v.pause();
    toast(`Tocando na TV ${dev.name}. Pode fechar o app.`, 'ok', 5000);
    if (!this.opts.live && this.opts.onBack) this.opts.onBack();
  }


  // Botão de áudio (onda sonora): versão, faixa de áudio, qualidade e o que está tocando.
  _renderSettings(m, seg, opt) {
    // Versão (Dublado/Legendado): nomes com o idioma que o app já viu tocando
    const vs = this.opts.versions;
    if (vs && vs.length > 1) {
      const names = versionNames(vs);
      m.append(h('h4', 'Versão'));
      for (const v of vs) {
        m.append(opt(names[v.label], v.label === this.opts.version, () => {
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
      m.append(h('div.note', vs && vs.length > 1 ? 'Este vídeo tem um áudio só. Para outro idioma, troque a versão acima.' : 'Este vídeo tem um áudio só.'));
    }



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

  // FPS real e quadros perdidos, medidos a cada segundo enquanto o vídeo anda. Funciona igual no navegador e no
  // player do Android (que manda os contadores no mesmo formato). Na LG o player da TV costuma não informar.
  _samplePerf() {
    const v = this.video;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    if (!q || v.paused || !q.totalVideoFrames) return;
    const now = performance.now();
    const prev = this._perfPrev;
    this._perfPrev = { at: now, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    if (!prev || q.totalVideoFrames < prev.total) return;
    const dt = (now - prev.at) / 1000;
    const shown = (q.totalVideoFrames - q.droppedVideoFrames) - (prev.total - prev.dropped);
    const fps = dt > 0 ? shown / dt : 0;
    // média curta: um segundo isolado oscila
    this.perf = { fps: this.perf ? this.perf.fps * 0.6 + fps * 0.4 : fps, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
  }

  // Modo de depuração (Configurações, no Beta): o que importa do vídeo, com cor no que pode estar ruim.
  _debugRows() {
    const v = this.video;
    const nf = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
    let ahead = 0;
    try {
      const b = v.buffered;
      for (let k = 0; k < b.length; k++) if (b.start(k) <= v.currentTime + 0.5 && b.end(k) > v.currentTime) ahead = b.end(k) - v.currentTime;
    } catch {}
    const state = this.castEl && !this.castEl.classList.contains('hidden') ? 'tocando na TV'
      : !this.errorEl.classList.contains('hidden') ? 'erro na tela'
        : v.paused ? 'pausado' : !this.center.classList.contains('hidden') ? 'carregando' : 'tocando';
    const p = this.perf;
    const lost = p && p.total ? (p.dropped / p.total) * 100 : NaN;
    const rows = [
      ['Reprodução', this._playingInfo()],
      ['Vídeo', p && p.fps > 0.5 ? `${nf(p.fps, 1)} fps · ${nf(1000 / p.fps, 1)} ms/quadro` : 'FPS não informado', '',
        p && p.total ? `${nf(p.dropped)} de ${nf(p.total)} perdidos (${nf(lost, 1)}%)` : '', tone(lost, 1, 5)],
      ['Abriu em', this.openMs != null ? `${nf(this.openMs)} ms` : '—', tone(this.openMs, 1500, 4000), state, state === 'erro na tela' ? 'bad' : ''],
      ['Tempo', `${fmtTime(v.currentTime || 0)}${Number.isFinite(v.duration) ? ' / ' + fmtTime(v.duration) : this.opts.live ? ' (ao vivo)' : ''}`, '',
        `reserva ${nf(ahead, 1)} s`, tone(ahead, 10, 3, true)],
    ];
    const lvl = this.hls && this.hls.levels && this.hls.levels[this.hls.currentLevel];
    const lvlTxt = lvl && (lvl.height || lvl.bitrate) ? `${lvl.height ? lvl.height + 'p ' : ''}${lvl.bitrate ? nf(lvl.bitrate / 1e6, 1) + ' Mbps' : ''}${this.hls.autoLevelEnabled ? ' auto' : ''} · ` : '';
    rows.push(['Rede', this.hls ? `${lvlTxt}banda ${nf(this.hls.bandwidthEstimate / 1e6, 1)} Mbps` : `tentativas ${this.attempts || 0}${this.usingAlt ? ' · link alternativo' : ''}`, '',
      `travadas ${this.stalls || 0}`, tone(this.stalls || 0, 0, 2)]);
    // só o servidor e o tipo do arquivo: o endereço das listas leva usuário e senha
    try {
      const u = new URL(this.currentUrl());
      rows.push(['Fonte', `${u.hostname} · ${(u.pathname.match(/[.]([a-z0-9]{2,5})$/i) || [])[1] || 'sem extensão'} · ${this.engine || '—'}`]);
    } catch {}
    return rows;
  }

  _perfInfo() {
    const nf = (n, d = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const parts = [];
    const p = this.perf;
    if (p && p.fps > 0.5) {
      parts.push(`${nf(p.fps, 1)} fps`, `${nf(1000 / p.fps, 1)} ms por quadro`);
      const pct = p.total ? (p.dropped / p.total) * 100 : 0;
      parts.push(`${nf(p.dropped)} de ${nf(p.total)} quadros perdidos${p.dropped ? ` (${nf(pct, 1)}%)` : ''}`);
    } else parts.push('FPS não informado por este player');
    if (this.openMs != null) parts.push(`abriu em ${nf(this.openMs)} ms`);
    return `Desempenho: ${parts.join(' · ')}`;
  }

  // Quem está tocando (navegador ou player do Android) e, quando se sabe, os formatos de vídeo e áudio.
  _playingInfo() {
    const v = this.video;
    if (this.exo) {
      const p = this.exo.playing || {};
      const name = (mime) => CODECS[mime] || (mime && mime !== 'null' ? mime.split('/').pop().toUpperCase() : '');
      const audio = [name(p.audio), channels(p.ch)].filter(Boolean).join(' ');
      return ['player do Android', name(p.video), p.height > 0 ? `${p.height}p` : '', audio].filter(Boolean).join(' · ');
    }
    if (this.remux) return [this.remux.describe(), v.videoHeight > 0 ? `${v.videoHeight}p` : ''].filter(Boolean).join(' · ');
    const how = { hls: 'navegador (HLS)', mpegts: 'navegador (MPEG-TS)', native: TV.on ? 'player da TV' : 'navegador' }[this.engine] || 'navegador';
    return [how, v.videoHeight > 0 ? `${v.videoHeight}p` : ''].filter(Boolean).join(' · ');
  }

  // ---------- avançar/voltar segurando a seta (TV) ----------
  // Só a barra anda enquanto a tecla está pressionada; o vídeo pula ao soltar.
  _scrubKey(dir) {
    const v = this.video;
    if (!Number.isFinite(v.duration)) return;
    const now = Date.now();
    if (!this.scrub) this.scrub = { t: v.currentTime, start: now, last: 0 };
    const s = this.scrub;
    clearTimeout(this._scrubT); // enquanto chegam teclas, nada de pular o vídeo
    this._scrubT = setTimeout(() => this._commitScrub(), 1500); // caso a TV não avise que soltou a tecla
    if (now - s.last < 150) return; // a repetição da tecla é rápida demais
    const elapsed = s.last ? Math.min(2, (now - s.last) / 150) : 1; // TVs repetem a tecla em ritmos diferentes
    s.last = now;
    const held = now - s.start;
    let step = 10;
    if (held >= 3000) {
      // Aceleração gradual proporcional ao filme: de 1% a 4% da duração por passo, em 3 segundos.
      const ramp = Math.min(1, (held - 3000) / 3000);
      const pct = 0.01 + 0.03 * ramp;
      step = Math.ceil(Math.max(30, v.duration * pct) * elapsed / 10) * 10;
    } else if (held >= 1000) step = 30;
    s.t = Math.max(0, Math.min(v.duration - 1, s.t + dir * step));
    this._paintSeek(s.t / v.duration);
    this.timeEl.textContent = `${fmtTime(s.t)} / ${fmtTime(v.duration)}`;
    this.preview.show(s.t, s.t / v.duration, this._seekEl.offsetWidth);
    if (TV.on) {
      // a TV não consegue gerar miniaturas: o tempo aparece grande em cima do ponto escolhido
      this.seekTip.style.left = (s.t / v.duration) * 100 + '%';
      this.seekTip.textContent = fmtTime(s.t);
      this.seekTip.classList.add('on');
    }
  }

  _commitScrub() {
    clearTimeout(this._scrubT);
    if (!this.scrub) return;
    this.video.currentTime = this.scrub.t;
    this.scrub = null;
    this.seekTip.classList.remove('on');
    this.preview.hide(1200);
    this._showCtrl();
  }

  // ---------- teclado ----------
  handleKey(e) {
    const k = e.key;
    const code = e.keyCode;
    // teclas de mídia do controle remoto
    if (k === 'MediaPlayPause' || code === 179) { this.togglePlay(); this._showCtrl(); return true; }
    if (k === 'MediaPlay' || code === 415) { this.video.play().catch(() => {}); this._flashPlay(true); this._showCtrl(); return true; }
    if (k === 'MediaPause' || code === 19) { this.video.pause(); this._flashPlay(false); return true; }
    if (k === 'MediaFastForward' || code === 417) { this.seekBy(30); return true; }
    if (k === 'MediaRewind' || code === 412) { this.seekBy(-30); return true; }
    if (k === 'MediaStop' || code === 413) { if (this.opts.onBack) this.opts.onBack(); else this.video.pause(); return true; }
    if (TV.on) {
      const horizontal = k === 'ArrowLeft' || k === 'ArrowRight';
      if (!this.opts.live && document.activeElement === this._seekEl) {
        this._showCtrl();
        if (k === 'ArrowDown') { focusEl(this.btnPlay); return true; }
        if (k === 'ArrowUp') return true;
        if (k === 'Enter') { this.togglePlay(); return true; }
        if (horizontal) { this._scrubKey(k === 'ArrowRight' ? 1 : -1); return true; }
      }
      // ←/→ andam em ordem pela fileira de botões (a barra de tempo, por ser larga, roubava o foco)
      if (horizontal && this.menu.classList.contains('hidden') && document.activeElement.tagName === 'BUTTON' && this.prow.contains(document.activeElement)) {
        this._showCtrl();
        const btns = [...this.prow.querySelectorAll('button')].filter((b) => b.offsetWidth > 0);
        const next = btns[btns.indexOf(document.activeElement) + (k === 'ArrowRight' ? 1 : -1)];
        if (next) focusEl(next);
        return true;
      }
      // com um botão dos controles em foco, as setas/OK navegam entre os botões
      if (this._ctrlFocused() || !this.menu.classList.contains('hidden')) { this._showCtrl(); return false; }
      if (k === 'Enter') { this.togglePlay(); this._showCtrl(); return true; }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        this._showCtrl();
        focusEl(k === 'ArrowUp' && this._seekEl ? this._seekEl : this.btnPlay);
        return true;
      }
      if (this.opts.live && horizontal) return false;
      if (horizontal) { this._showCtrl(); this._scrubKey(k === 'ArrowRight' ? 1 : -1); return true; }
    }
    if (k === ' ' || k === 'k' || k === 'K') { this.togglePlay(); return true; }
    if (k === 'f' || k === 'F') { this.toggleFullscreen(); return true; }
    if (k === 'm' || k === 'M') { this.toggleMute(); return true; }
    if (!this.opts.live && k === 'ArrowLeft') { this._showCtrl(); this._scrubKey(-1); return true; }
    if (!this.opts.live && k === 'ArrowRight') { this._showCtrl(); this._scrubKey(1); return true; }
    if (!this.opts.live && k === 'ArrowUp') { this.video.volume = Math.min(1, this.video.volume + 0.05); return true; }
    if (!this.opts.live && k === 'ArrowDown') { this.video.volume = Math.max(0, this.video.volume - 0.05); return true; }
    return false;
  }

  destroy() {
    this._report();
    this.destroyed = true;
    videoLandscape(false);
    clearInterval(this._subTimer);
    clearInterval(this._perfTimer);
    clearInterval(this._castT); // a TV continua tocando se o player fechar; dá para parar pela TV
    debugSection('player', null);
    clearTimeout(this._netT);
    clearInterval(this._watchdog);
    clearTimeout(this._retryT);
    this._clearStartTimer();
    clearTimeout(this._hideT);
    this._removeNextCard();
    document.removeEventListener('fullscreenchange', this._onFs);
    document.removeEventListener('mousedown', this._onDocClick);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('visibilitychange', this._onHide);
    clearTimeout(this._scrubT);
    if (document.pictureInPictureElement === this.video) document.exitPictureInPicture().catch(() => {});
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    if (this.preview) this.preview.destroy();
    clearInterval(this._beatT);
    endScreen();
    this._teardown();
    this.root.remove();
  }
}
