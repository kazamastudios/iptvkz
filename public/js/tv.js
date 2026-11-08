// Modo TV: interface maior e navegação pelas setas/OK/Voltar do controle remoto.
// A escolha é por aparelho (localStorage), não vai para o servidor.
const KEY = 'iptvkz.tv';

export const TV = { on: false };

function stored() {
  try { return localStorage.getItem(KEY) ?? localStorage.getItem('minhatv.tv'); } catch { return null; }
}

// Chromium < 84 não tem "gap" em flexbox; o CSS compensa com margens.
function flexGapSupported() {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  d.appendChild(document.createElement('div'));
  d.appendChild(document.createElement('div'));
  document.body.appendChild(d);
  const ok = d.scrollHeight === 1;
  d.remove();
  return ok;
}

export function detectTv() {
  document.documentElement.classList.toggle('no-flexgap', !flexGapSupported());
  const q = new URLSearchParams(location.search);
  if (q.has('tv')) {
    try { localStorage.setItem(KEY, q.get('tv') === '0' ? '0' : '1'); } catch {}
  }
  const s = stored();
  TV.on = s != null ? s === '1' : /web0s|webos|smart-?tv|netcast|tizen|hbbtv|appletv|crkey|aft[a-z]/i.test(navigator.userAgent);
  applyTv();
}

export function setTvMode(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  TV.on = on;
  applyTv();
}

export function applyTv() {
  const html = document.documentElement;
  html.classList.toggle('tv', TV.on);
  // Tela de TV vista do sofá: tudo ~35% maior em 1080p.
  html.style.zoom = TV.on ? String(Math.max(1, Math.min(2, window.innerWidth / 1420)).toFixed(2)) : '';
}

// ---------- navegação espacial ----------

const FOCUSABLE = [
  'button:not([disabled])', 'a[href]', 'input', 'select', 'textarea',
  '.ch-card', '.poster', '.cat-item', '.ep', '.g-prog', '.g-ch', '[data-focus]',
].join(',');

const NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/;
const CARD = '.ch-card, .poster, .ep, .list-card, .g-ch';

// Onde a navegação acontece: menu do player > modal > player de filme > gaveta de canais > app.
export function navScope() {
  return (
    document.querySelector('.pmenu:not(.hidden)') ||
    [...document.querySelectorAll('.modal-back .modal')].pop() ||
    document.querySelector('.vod-overlay') ||
    document.querySelector('.live.tvfull.drawer .side-list') ||
    document.getElementById('app')
  );
}

function visible(el) {
  if (el.closest('.hidden')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && r.bottom > -2000 && r.top < window.innerHeight + 2000;
}

export function focusEl(el, { center = false } = {}) {
  if (!el) return;
  if (!NATIVE.test(el.tagName) && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  try {
    el.scrollIntoView({ block: center ? 'center' : 'nearest', inline: 'nearest' });
  } catch {
    el.scrollIntoView(false);
  }
  // scrollIntoView também rola contêineres com overflow:hidden (a página inteira "sobe"); desfaz isso.
  for (const c of [document.documentElement, document.body, document.getElementById('app'), document.querySelector('.main')]) {
    if (c && (c.scrollTop || c.scrollLeft)) { c.scrollTop = 0; c.scrollLeft = 0; }
  }
}

function region(el) {
  return el.closest('.sidebar') ? 'side' : 'main';
}

export function focusFirst(root) {
  const scope = root || navScope();
  const els = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  // de preferência um cartão do conteúdo; campos de texto abririam o teclado da TV
  const inView = (sel) => els.find((el) => el.matches(sel) && el.closest('#view') && el.getBoundingClientRect().top >= 0);
  focusEl(inView('.ch-card, .poster, .ep, .g-prog') || inView('.cat-item.on, .btn.primary') || inView('*') || els[0]);
}

// Botões dentro de um cartão (ex.: ★) só são alcançáveis a partir do próprio cartão.
function reachable(el, cur) {
  const card = el.parentElement && el.parentElement.closest(CARD);
  return !card || card === cur || card.contains(cur);
}

// dir: 'left' | 'right' | 'up' | 'down'. Retorna true se mudou o foco.
export function move(dir) {
  const scope = navScope();
  const cur = document.activeElement;
  if (!cur || cur === document.body || !scope.contains(cur)) {
    focusFirst(scope);
    return true;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const curRegion = region(cur);
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of scope.querySelectorAll(FOCUSABLE)) {
    if (el === cur || (cur.contains(el) && !cur.matches(CARD)) || !visible(el) || !reachable(el, cur)) continue;
    // ↑/↓ não saltam entre a barra lateral e o conteúdo
    if ((dir === 'up' || dir === 'down') && region(el) !== curRegion) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let primary;
    let overlap;
    if (dir === 'right') { if (r.left < a.right - 4 && cx <= ax + 2) continue; primary = Math.max(0, r.left - a.right); overlap = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top); }
    else if (dir === 'left') { if (r.right > a.left + 4 && cx >= ax - 2) continue; primary = Math.max(0, a.left - r.right); overlap = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top); }
    else if (dir === 'down') { if (r.top < a.bottom - 4 && cy <= ay + 2) continue; primary = Math.max(0, r.top - a.bottom); overlap = Math.min(a.right, r.right) - Math.max(a.left, r.left); }
    else { if (r.bottom > a.top + 4 && cy >= ay - 2) continue; primary = Math.max(0, a.top - r.bottom); overlap = Math.min(a.right, r.right) - Math.max(a.left, r.left); }
    const side = dir === 'left' || dir === 'right' ? Math.abs(cy - ay) : Math.abs(cx - ax);
    const score = primary + (overlap > 0 ? 0 : side * 2) + side * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    focusEl(best);
    return true;
  }
  return false;
}

export const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

export function isNative(el) {
  return !!el && NATIVE.test(el.tagName);
}
