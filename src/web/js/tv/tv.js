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
  const zoom = TV.on ? Math.max(1, Math.min(2, window.innerWidth / 1420)) : 1;
  html.style.zoom = TV.on ? zoom.toFixed(2) : '';
  // Com zoom, 100vh passa da tela e corta o rodapé; a altura real vem daqui.
  html.style.setProperty('--app-h', `${window.innerHeight / Number(zoom.toFixed(2))}px`);
}

// Fecha o app da TV (só o app: o servidor no computador continua ligado).
export function exitApp() {
  window.close();
  // platformBack faz a LG perguntar de novo: só se o close não tiver fechado
  setTimeout(() => {
    try {
      const sys = window.webOSSystem || window.PalmSystem;
      if (sys && sys.platformBack) sys.platformBack();
    } catch {}
  }, 800);
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
    document.querySelector('.tvkb') ||
    document.querySelector('.status-pop') ||
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

// Destaque por classe: quando o foco está na barra do navegador da TV, o :focus do CSS não aparece.
let marked = null;
export function syncFocus(el = document.activeElement) {
  const next = el && el !== document.body && document.contains(el) ? el : null;
  if (marked === next) return;
  if (marked) marked.classList.remove('tv-focus');
  marked = next;
  if (marked && TV.on) marked.classList.add('tv-focus');
}

// Teclas do controle: algumas TVs mandam nomes antigos ou só o código numérico.
const KEY_NAMES = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', OK: 'Enter', Select: 'Enter' };
const KEY_CODES = { 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter' };
export function normKey(e) {
  if (e.key && e.key !== 'Unidentified') return KEY_NAMES[e.key] || e.key;
  return KEY_CODES[e.keyCode] || e.key;
}

// Diagnóstico: abrir com ?debug=1 mostra na tela o que o controle está enviando.
export function initKeyDebug() {
  if (!/[?&]debug=1/.test(location.search)) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;padding:8px 12px;background:#000;color:#0f0;font:16px monospace;white-space:pre;border:1px solid #0f0';
  document.body.appendChild(box);
  const log = [];
  window.addEventListener('keydown', (e) => {
    setTimeout(() => {
      const a = document.activeElement;
      log.unshift(`key=${e.key} code=${e.keyCode} -> ${normKey(e)} | foco=${a ? a.tagName + '.' + String(a.className).slice(0, 24) : '-'} | pagina focada=${document.hasFocus()}`);
      log.length = Math.min(log.length, 6);
      box.textContent = `TV=${TV.on} ${window.innerWidth}x${window.innerHeight} ${navigator.userAgent.slice(0, 70)}
${log.join(String.fromCharCode(10))}`;
    }, 0);
  }, true);
  box.textContent = 'Aperte as setas do controle';
}

// A LG abre o teclado do sistema assim que um campo recebe foco. Somente leitura ela não abre;
// quem escreve no campo é o nosso teclado, com OK.
const TEXT_TYPES = /^(text|search|url|email|password|tel|number)$/;
export function lockInput(el) {
  if (!TV.on || !el || el.tagName !== 'INPUT' || !TEXT_TYPES.test(el.type) || el.readOnly || el.disabled || el.dataset.native) return;
  el.readOnly = true;
  el.dataset.tvlock = '1';
}

// Teclado do próprio aparelho (na LG, com voz e edição). O campo só destrava quando a pessoa aperta OK.
let nativeInput = null;
export function endNativeInput() {
  if (!nativeInput) return;
  const el = nativeInput;
  nativeInput = null;
  delete el.dataset.native;
  lockInput(el);
}

// O sistema da TV consegue dizer se o teclado abriu? undefined = não sabe dizer.
function systemKeyboardVisible() {
  try {
    const sys = window.webOSSystem || window.PalmSystem;
    const v = sys && sys.isKeyboardVisible;
    return typeof v === 'function' ? v.call(sys) : v;
  } catch {
    return undefined;
  }
}

// TVs com teclado próprio para páginas. onFail: abrir o teclado do app quando o nativo não apareceu.
export function hasNativeKeyboard() {
  return /web0s|webos|tizen/i.test(navigator.userAgent);
}

export function startNativeInput(input, onFail) {
  endNativeInput();
  input.blur(); // o campo já estava em foco: sem isso o sistema não abre o teclado
  nativeInput = input;
  kbOpen = true;
  input.dataset.native = '1';
  input.readOnly = false;
  delete input.dataset.tvlock;
  input.removeAttribute('inputmode');
  input.addEventListener('blur', endNativeInput, { once: true });
  input.focus({ preventScroll: true });
  syncFocus(input);
  setTimeout(() => {
    if (nativeInput !== input || systemKeyboardVisible() !== false) return;
    endNativeInput();
    onFail(input);
  }, 1200);
}

// O teclado some enquanto a LG escuta a voz: por isso fechar não trava o campo, senão o texto ditado
// não entra. O campo só trava quando a pessoa sai dele.
let kbOpen = false;
document.addEventListener('keyboardStateChange', (e) => {
  if (e.detail && typeof e.detail.visibility === 'boolean') kbOpen = e.detail.visibility;
});

export function nativeKeyboardOpen() {
  const v = systemKeyboardVisible();
  return v === undefined ? kbOpen : !!v;
}

export function focusEl(el, { center = false } = {}) {
  if (!el) return;
  if (el !== nativeInput) endNativeInput();
  lockInput(el);
  if (!NATIVE.test(el.tagName) && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  syncFocus(el);
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
  return el.closest('.sidebar') ? 'side' : el.closest('.cats') ? 'cats' : 'main';
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

let lastMove = 0;

// dir: 'left' | 'right' | 'up' | 'down'. Retorna true se mudou o foco.
export function move(dir) {
  // tecla segurada: repetir mais rápido que a TV desenha só acumula atraso
  const now = Date.now();
  if (now - lastMove < 90) return true;
  lastMove = now;
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
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || r.bottom <= -2000 || r.top >= window.innerHeight + 2000) continue;
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
    if (score >= bestScore) continue;
    // as checagens que sobem pela árvore ficam por último: só para quem pode ganhar
    if ((cur.contains(el) && !cur.matches(CARD)) || el.closest('.hidden') || !reachable(el, cur)) continue;
    // ↑/↓ não saltam entre a barra lateral e o conteúdo
    if ((dir === 'up' || dir === 'down') && region(el) !== curRegion) continue;
    bestScore = score;
    best = el;
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
