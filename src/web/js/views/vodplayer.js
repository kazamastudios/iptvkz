// Player de filmes/episódios em tela cheia na janela, com progresso e próximo episódio.
import { h } from '../core/util.js';
import { Player } from '../player/player.js';
import { setProgress, getProgress, setSetting, versionNames } from '../core/store.js';
import { TV, focusFirst } from '../tv/tv.js';

let active = null; // { player, el, close }

export function isOverlayOpen() {
  return !!active;
}

export function overlayKey(e) {
  if (!active) return false;
  if (e.key === 'Escape' && !document.fullscreenElement) {
    active.close();
    return true;
  }
  return active.player.handleKey(e);
}

function open({ title, versions, version, startAt, onTime, next, onNext, onVersion, onClose }) {
  if (active) active.close(true);
  const el = h('div.vod-overlay');
  document.getElementById('overlayRoot').append(el);
  const state = { closed: false };
  const prevFocus = document.activeElement;
  if (prevFocus && prevFocus.blur) prevFocus.blur();
  const close = (silent) => {
    if (state.closed) return;
    state.closed = true;
    player.destroy();
    el.remove();
    if (active && active.el === el) active = null;
    if (!silent && onClose) onClose();
    if (!silent && TV.on) {
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      else if (!document.activeElement || document.activeElement === document.body) focusFirst();
    }
  };
  const player = new Player(el, {
    live: false,
    title,
    onBack: () => close(),
    onEnded: () => close(),
    onTime,
    next,
    onNext,
    versions,
    version: version.label,
    onVersion,
  });
  active = { player, el, close };
  player.load({ url: version.url, title, startAt });
  return active;
}

function resumePoint(id) {
  const p = getProgress(id);
  return p && p.t > 1 && (!p.d || p.t / p.d < 0.95) ? p.t : 0;
}

export function playMovie(movie, version, { fromStart = false, onClose } = {}) {
  const startAt = fromStart ? 0 : resumePoint(movie.id);
  open({
    title: movie.name + (movie.versions.length > 1 ? ` · ${versionNames(movie.versions)[version.label]}` : ''),
    versions: movie.versions,
    version,
    startAt,
    onTime: (t, d) => setProgress(movie.id, { kind: 'movie', t, d }),
    onVersion: (label, t) => {
      setSetting('versionPref', label);
      const v = movie.versions.find((x) => x.label === label);
      setProgress(movie.id, { kind: 'movie', t, d: getProgress(movie.id)?.d || 0 });
      playMovie(movie, v, { onClose });
    },
    onClose,
  });
}

// seasons: [{num, eps:[{id,num,title,versions}]}]
export function playEpisode(serie, seasons, seasonNum, epId, { versionLabel, fromStart = false, onClose } = {}) {
  const flat = [];
  for (const s of seasons) for (const ep of s.eps) flat.push({ season: s.num, ep });
  const idx = flat.findIndex((x) => x.ep.id === epId && x.season === seasonNum);
  if (idx < 0) return;
  const { ep, season } = flat[idx];
  const version = ep.versions.find((v) => v.label === versionLabel) || ep.versions[0];
  const nxt = flat[idx + 1];
  const label = (s, e) => `T${s}:E${e.num}`;
  const title = `${serie.name} · ${label(season, ep)} · ${ep.title}`;

  setProgress('s:' + serie.id, { kind: 'serie-last', ep: ep.id, season, num: ep.num, title: ep.title, version: versionLabel });
  open({
    title,
    versions: ep.versions,
    version,
    startAt: fromStart ? 0 : resumePoint(ep.id),
    onTime: (t, d) => {
      setProgress(ep.id, { kind: 'ep', t, d });
      setProgress('s:' + serie.id, { kind: 'serie-last', ep: ep.id, season, num: ep.num, title: ep.title, version: versionLabel, done: !nxt && t / d >= 0.95 });
    },
    next: nxt ? { title: `${label(nxt.season, nxt.ep)} · ${nxt.ep.title}` } : null,
    onNext: () => nxt && playEpisode(serie, seasons, nxt.season, nxt.ep.id, { versionLabel, fromStart: true, onClose }),
    onVersion: (lbl, t) => {
      setSetting('versionPref', lbl);
      setProgress(ep.id, { kind: 'ep', t, d: getProgress(ep.id)?.d || 0 });
      playEpisode(serie, seasons, season, ep.id, { versionLabel: lbl, onClose });
    },
    onClose,
  });
}
