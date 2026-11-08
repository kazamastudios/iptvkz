// Helpers de DOM e formatação.
import { icon } from './icons.js';

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
  const im = new Image();
  im.loading = 'lazy';
  im.decoding = 'async';
  im.alt = '';
  im.referrerPolicy = 'no-referrer';
  im.onerror = () => {
    im.remove();
    fallback();
  };
  im.src = src;
  box.append(im);
  return box;
}

// Renderiza uma lista grande aos poucos conforme o usuário rola.
export function incremental(container, items, renderItem, { batch = 120, root = null, onBatch } = {}) {
  let i = 0;
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
export function modal(title, body, { wide = false, onClose, locked = false } = {}) {
  const root = $('#overlayRoot');
  const box = h('div.modal' + (wide ? '.wide' : ''),
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

export function confirmDialog(title, text, okLabel = 'Confirmar', danger = false) {
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
        h('button.btn.ghost', { onclick: () => finish(false) }, 'Cancelar'),
        h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => finish(true) }, okLabel)),
    ], { onClose: () => finish(false) });
  });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
