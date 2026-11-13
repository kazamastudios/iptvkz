// Helpers de DOM e formatação.
import { icon } from './icons.js';
import { TV, focusEl, navIdle } from '../tv/tv.js';

// TVs antigas (Chromium < 86) não têm replaceChildren.
if (!Element.prototype.replaceChildren) {
  const rc = function (...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  };
  Element.prototype.replaceChildren = rc;
  DocumentFragment.prototype.replaceChildren = rc;
}

// append/replaceChildren/... ignoram null/false e aceitam arrays (renderização condicional).
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
    const orig = proto[m];
    if (!orig || orig.__clean) continue;
    const fn = function (...args) {
      return orig.apply(this, args.flat(Infinity).filter((x) => x != null && x !== false));
    };
    fn.__clean = true;
    proto[m] = fn;
  }
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// h('div.card', {onclick}, filhos...) — cria elementos sem framework.
export function h(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.');
  const e = document.createElement(t || 'div');
  if (cls.length) e.className = cls.join(' ');
  if (props && (props instanceof Node || typeof props !== 'object' || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className += (e.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'value' || k === 'checked' || k === 'selected') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : String(c));
  }
  return e;
}

export function ico(name, cls) {
  const s = document.createElement('span');
  s.className = 'ico' + (cls ? ' ' + cls : '');
  s.innerHTML = icon(name);
  return s;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Todas as palavras da busca precisam aparecer no texto.
export function matcher(query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (text) => {
    const t = norm(text);
    return words.every((w) => t.includes(w));
  };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDur(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
}

export function fmtClock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtAgo(ts) {
  if (!ts) return 'nunca';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}

export function initials(name) {
  const words = String(name || '?')
    .replace(/[^0-9A-Za-zÀ-ɏ ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0] || '?')[0] + (words[1] ? words[1][0] : '')).toUpperCase();
}

// Com o controle (ou as setas do teclado) segurado, as capas novas esperam a pessoa parar: cada fileira que passava trazia
// dezenas de imagens para decodificar em 4K, mais rápido do que a placa de vídeo dava conta, e o app travava.
// Enquanto isso o cartão mostra o fundo de carregamento.
const heldBack = [];
let tHeld = 0;
// Na TV, logo depois de trocar de tela as imagens também esperam (settleImages): primeiro a TV desenha a tela,
// depois decodifica as capas. Juntas, elas eram boa parte do engasgo de abrir Filmes e Séries na LG.
let settleUntil = 0;
export function settleImages(ms) { settleUntil = performance.now() + ms; }
const imagesFree = () => navIdle() && performance.now() >= settleUntil;
function releaseHeld() {
  tHeld = 0;
  if (!imagesFree()) { tHeld = setTimeout(releaseHeld, 120); return; }
  for (const go of heldBack.splice(0)) go();
}
function setSrcWhenIdle(im, src) {
  if (imagesFree()) { im.src = src; return; } // mouse e toque não mexem em navIdle: só controle e teclado esperam
  heldBack.push(() => { if (im.isConnected) im.src = src; });
  if (!tHeld) tHeld = setTimeout(releaseHeld, 120);
}

// Imagem com carregamento preguiçoso e fallback com iniciais.
export function img(src, name, cls = '') {
  const box = h('div.thumb' + (cls ? '.' + cls.split(' ').join('.') : ''));
  const fallback = () => {
    box.classList.add('noimg');
    box.textContent = initials(name);
  };
  if (!src) {
    fallback();
    return box;
  }
  box.classList.add('loading');
  const im = new Image();
  im.onload = () => box.classList.remove('loading');
  im.loading = 'lazy';
  im.decoding = 'async';
  im.alt = '';
  im.referrerPolicy = 'no-referrer';
  im.onerror = () => {
    box.classList.remove('loading');
    im.remove();
    fallback();
  };
  setSrcWhenIdle(im, src);
  box.append(im);
  return box;
}

// Blocos de carregamento (não recebem foco na TV: não usam as classes dos cartões).
const times = (n, fn) => Array.from({ length: n }, fn);
export const skPosters = (n) => times(n, () => h('div.sk-poster', h('div.sk-box.sk-cover'), h('div.sk-box.sk-text'), h('div.sk-box.sk-text.short')));
export const skChannels = (n) => times(n, () => h('div.sk-channel', h('div.sk-box.sk-logo'), h('div.sk-col', h('div.sk-box.sk-text'), h('div.sk-box.sk-text.short')))) ;
export const skEpisodes = (n) => times(n, () => h('div.sk-ep', h('div.sk-box.sk-still'), h('div.sk-col', h('div.sk-box.sk-text'), h('div.sk-box.sk-text.short'), h('div.sk-box.sk-text')))) ;
export const skLines = (n) => times(n, (_, i) => h('div.sk-box.sk-text' + (i === n - 1 ? '.short' : '')));

// Renderiza uma lista grande aos poucos conforme o usuário rola.
export function incremental(container, items, renderItem, { batch = 120, root = null, onBatch } = {}) {
  let i = 0;
  if (TV.on) batch = Math.min(batch, 40); // menos cartões de uma vez: a troca de tela não engasga
  const sentinel = h('div.sentinel');
  let io;
  const more = () => {
    const frag = document.createDocumentFragment();
    const slice = items.slice(i, i + batch);
    for (const it of slice) frag.append(renderItem(it));
    i += slice.length;
    sentinel.before(frag);
    if (onBatch && slice.length) onBatch(slice);
    if (i >= items.length) {
      io && io.disconnect();
      sentinel.remove();
    }
  };
  container.append(sentinel);
  io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) more();
  }, { root, rootMargin: '800px' });
  more();
  if (i < items.length) io.observe(sentinel);
  return {
    destroy: () => io && io.disconnect(),
    rendered: () => i,
    ensure(n) {
      while (i < Math.min(n, items.length)) more();
    },
  };
}

// Como incremental, mas só mantém no documento as linhas próximas da área visível: rolar uma lista
// de 40 mil itens não acumula cartões. Espaçadores ocupam o lugar do resto e a barra de rolagem fica certa.
export function windowed(container, items, renderItem, { root, batch = 60, onBatch }) {
  const OVERSCAN = 4;
  if (TV.on) batch = Math.min(batch, 40);
  const len = items.length;
  const spacer = () => h('div', { style: { gridColumn: '1 / -1', display: 'none' } });
  const top = spacer();
  const bottom = spacer();
  const nodes = new Map();
  let first = 0;
  let end = Math.min(batch, len);
  let cols = 0;
  let rowH = 0;
  let gap = 0;
  let scale = 1;
  let dead = false;
  let frame = 0;

  // A guia é pedida em lotes: rolar não pode virar uma requisição por linha.
  let pending = [];
  let flushT = null;
  const report = (slice) => {
    if (!onBatch || !slice.length) return;
    pending.push(...slice);
    clearTimeout(flushT);
    flushT = setTimeout(() => { const s = pending; pending = []; onBatch(s); }, 300);
  };
  const build = (from, to) => {
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
      const n = renderItem(items[i]);
      nodes.set(i, n);
      frag.append(n);
    }
    return frag;
  };

  container.append(top, build(0, end), bottom);
  if (onBatch && end) onBatch(items.slice(0, end));

  const measure = () => {
    const a = nodes.get(first);
    if (!a || !a.isConnected) return false;
    const box = a.getBoundingClientRect();
    if (!box.height) return false;
    const cs = getComputedStyle(container);
    const tpl = cs.gridTemplateColumns;
    cols = tpl && tpl !== 'none' ? tpl.split(' ').length : 1;
    gap = parseFloat(cs.rowGap || cs.gridRowGap) || 0;
    // Com o zoom da TV, navegadores novos medem já aumentado e os antigos não; o estilo é sempre sem zoom.
    const zoom = parseFloat(document.documentElement.style.zoom) || 1;
    const ratio = box.height / a.offsetHeight;
    scale = Math.abs(ratio - zoom) < Math.abs(ratio - 1) ? 1 / zoom : 1;
    const b = nodes.get(first + cols);
    rowH = b ? b.getBoundingClientRect().top - box.top : box.height + gap / scale;
    return rowH > 0;
  };
  const setGap = (el, rows) => {
    el.style.display = rows > 0 ? 'block' : 'none';
    if (rows > 0) el.style.height = `${rows * rowH * scale - gap}px`;
  };

  // Posição da área visível, medida pela tela (não muda com o zoom da TV).
  const scrollY = () => {
    const a = nodes.get(first);
    return a ? root.getBoundingClientRect().top - a.getBoundingClientRect().top + (first / cols) * rowH : 0;
  };

  function update() {
    frame = 0;
    if (dead || !len || (!rowH && !measure())) return;
    const y = scrollY();
    const total = Math.ceil(len / cols);
    const fromRow = Math.max(0, Math.min(total - 1, Math.floor(y / rowH)) - OVERSCAN);
    const toRow = Math.min(total, Math.ceil((y + root.getBoundingClientRect().height) / rowH) + OVERSCAN);
    let a = fromRow * cols;
    let b = Math.min(len, toRow * cols);
    // folga para não trocar cartões a cada pixel
    if (a > first && a - first < cols * 2) a = first;
    if (b < end && end - b < cols * 2) b = end;
    // na TV o item em foco fica no documento, a não ser que a rolagem tenha ido para longe dele
    if (TV.on) {
      const active = document.activeElement;
      for (const [i, n] of nodes) {
        if (!n.contains(active)) continue;
        const row = Math.floor(i / cols);
        if (row < fromRow - 20 || row > toRow + 20) break;
        a = Math.min(a, row * cols);
        b = Math.max(b, Math.min(len, (row + 1) * cols));
        break;
      }
    }
    for (const [i, n] of nodes) {
      if (i < a || i >= b) { n.remove(); nodes.delete(i); }
    }
    const added = [];
    if (a < first) {
      const to = Math.min(first, b);
      top.after(build(a, to));
      added.push(...items.slice(a, to));
    }
    if (b > end) {
      const from = Math.max(end, a);
      bottom.before(build(from, b));
      added.push(...items.slice(from, b));
    }
    first = a;
    end = b;
    setGap(top, a / cols);
    setGap(bottom, total - Math.ceil(b / cols));
    report(added);
  }

  const onScroll = () => { if (!frame) frame = setTimeout(update, 40); };
  const onResize = () => { rowH = 0; onScroll(); };
  root.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  // A lista nasce antes de entrar no documento: mede assim que aparecer.
  let tries = 50;
  let waitT = null;
  const waitForLayout = () => {
    update();
    if (!rowH && !dead && tries-- > 0) waitT = setTimeout(waitForLayout, 100);
  };
  waitT = setTimeout(waitForLayout, 0);

  return {
    destroy() {
      dead = true;
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      clearTimeout(flushT);
      clearTimeout(waitT);
      clearTimeout(frame);
    },
    rendered: () => end,
    ensure(n) {
      const idx = Math.min(n, len) - 1;
      if (idx < 0 || (idx >= first && idx < end)) return;
      if (!rowH && !measure()) {
        // ainda fora do documento: só dá para acrescentar até lá
        bottom.before(build(end, idx + 1));
        report(items.slice(end, idx + 1));
        end = idx + 1;
        return;
      }
      root.scrollTop += (Math.floor(idx / cols) * rowH - scrollY()) * scale;
      update();
    },
  };
}

// action opcional: { label, fn } — vira um botão no aviso (ex.: "Desfazer").
export function toast(msg, type = 'info', ms = 3500, action = null) {
  const root = $('#toasts');
  const hide = () => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  };
  const t = h('div.toast.' + type, msg,
    action ? h('button.toast-act', { onclick: () => { hide(); action.fn(); } }, action.label) : null);
  root.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(hide, action ? Math.max(ms, 6000) : ms);
}

// Tecla "Voltar": Esc no PC, Back (461) no controle da LG, BrowserBack em outras TVs.
export function isBack(e) {
  return e.keyCode === 461 || e.key === 'GoBack' || e.key === 'BrowserBack' || e.key === 'Escape' || e.keyCode === 10009;
}

const modalStack = [];
export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (!top) return false;
  if (!top.locked) top();
  return true;
}

// Modal genérico. Retorna { el, close }.
// locked: sem botão de fechar, sem Esc/Voltar e sem clique fora (ex.: aceite dos termos).
export function modal(title, body, { wide = false, cls = '', onClose, locked = false } = {}) {
  const root = $('#overlayRoot');
  const box = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''),
    h('div.modal-head', h('h2', title), locked ? null : h('button.icon-btn', { title: 'Fechar', onclick: () => close() }, ico('close'))),
    h('div.modal-body', body));
  const back = h('div.modal-back', box);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back && !locked) close();
  });
  const onKey = (e) => {
    if (locked && isBack(e)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (isBack(e) && !(e.key === 'Escape' && e.target && e.target.tagName === 'SELECT')) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  root.append(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const prevFocus = document.activeElement;
  close.locked = locked;
  modalStack.push(close);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const i = modalStack.indexOf(close);
    if (i >= 0) modalStack.splice(i, 1);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    document.removeEventListener('keydown', onKey, true);
    back.classList.remove('show');
    setTimeout(() => back.remove(), 200);
    onClose && onClose();
  }
  return { el: box, close };
}

// Resolve true (ok), false (o outro botão) ou null (fechou sem escolher; para quem só testa "sim", é um não).
export function confirmDialog(title, text, okLabel = 'Confirmar', danger = false, cancelLabel = 'Cancelar') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal(title, [
      h('p.muted', text),
      h('div.form-actions',
        h('button.btn.ghost', { onclick: () => finish(false) }, cancelLabel),
        h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => finish(true) }, okLabel)),
    ], { onClose: () => finish(null) });
    // no controle, o foco já começa na resposta (em ações perigosas, no Cancelar)
    if (TV.on) setTimeout(() => focusEl(m.el.querySelector(danger ? '.form-actions .btn.ghost' : '.form-actions .btn:last-child')), 60);
  });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
