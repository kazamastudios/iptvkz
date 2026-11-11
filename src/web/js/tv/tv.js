// Modo TV: interface maior e navegação pelas setas/OK/Voltar do controle remoto.
// A escolha é por aparelho (localStorage), não vai para o servidor.
import { glideTo, glideTarget } from '../core/smoothscroll.js';
import { ringTo } from './focusring.js';

const KEY = 'iptvkz.tv';

// Quem pediu ao sistema menos animação recebe os saltos diretos de antes.
const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

export const TV = { on: false };

// Modo teclado no PC: setas e Tab andam pelos itens como o controle na TV, com o mesmo destaque (moldura,
// zoom, tela acompanhando). Liga ao usar o teclado e desliga ao usar o mouse; o foco fica onde estava.
export const KB = { on: false };
export function setKbNav(on) {
  if (TV.on || KB.on === on) return;
  KB.on = on;
  document.documentElement.classList.toggle('kb-nav', on);
  if (on) return syncFocus();
  if (marked) marked.classList.remove('tv-focus');
  marked = null;
  ringTo(null);
}
const keyNav = () => TV.on || KB.on;

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
  // Toda TV com o mesmo layout, de ~1420px de largura: a LG (1920px) amplia ~35%; o Android TV, que mostra
  // 1080p com densidade 2 (o app vê só 960px), reduz. Antes só ampliava, e no Android TV tudo saía grande
  // demais: título do destaque cortado, nomes dos filmes fora da tela.
  // Com toque (o APK num celular também liga o modo TV) não reduz: lá vale o layout de celular.
  const touch = navigator.maxTouchPoints > 0;
  const fit = window.innerWidth / 1420;
  const zoom = TV.on ? Math.min(2, touch ? Math.max(1, fit) : Math.max(0.5, fit)) : 1;
  html.style.zoom = TV.on ? zoom.toFixed(2) : '';
  // as regras de tela estreita do CSS (@media max-width) olham a largura real, não a com zoom: na TV
  // sem toque o layout já é o largo, então elas ficam desligadas (html.tv-wide no app.css)
  html.classList.toggle('tv-wide', TV.on && !touch);
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
  '.ch-card', '.poster', '.cat-item', '.ep', '.g-prog', '.g-ch', '.switch', '[data-focus]',
].join(',');

const NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/;
const CARD = '.ch-card, .poster, .ep, .g-ch';
const LAZY_BLOCK = '.shelf'; // blocos com content-visibility: auto (ver app.css)

// Onde a navegação acontece: menu do player > modal > player de filme > gaveta de canais > app.
export function navScope() {
  return (
    document.querySelector('.tvkb') ||
    document.querySelector('.status-pop') ||
    document.querySelector('.list-menu:not(.hidden)') ||
    document.querySelector('.pmenu:not(.hidden)') ||
    [...document.querySelectorAll('.modal-back .modal')].pop() ||
    document.querySelector('.vod-overlay') ||
    document.querySelector('.live.tvfull.drawer .side-list') ||
    document.getElementById('app')
  );
}

// Blocos com content-visibility (as fileiras do Início) não são montados fora da tela. Medir um item lá dentro
// obriga o navegador a montar o bloco inteiro: com dezenas de fileiras, cada tecla custava ~400ms.
// Esta checagem mede o bloco (barato) e diz se tudo dentro dele pode ser ignorado. Uma por busca: guarda as medidas.
function farCheck() {
  const far = new Map();
  return (el) => {
    const box = el.closest(LAZY_BLOCK);
    if (!box) return false;
    let v = far.get(box);
    if (v === undefined) {
      const b = box.getBoundingClientRect();
      // uma tela de folga para cima e para baixo basta para achar a fileira vizinha
      v = b.bottom <= -window.innerHeight || b.top >= window.innerHeight * 2;
      far.set(box, v);
    }
    return v;
  };
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
  if (marked && keyNav()) marked.classList.add('tv-focus');
  ringTo(keyNav() && !reducedMotion() ? marked : null);
  // aviso próprio de "o foco do controle/teclado chegou aqui": o focusin do navegador não dispara quando a
  // janela não está em foco, e quem reage ao foco (ex.: o destaque do Streaming) não pode depender disso
  if (marked && keyNav()) marked.dispatchEvent(new CustomEvent('navfocus', { bubbles: true }));
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
    if (androidKeyboard()) return !!window.IPTVKZAndroid.isKeyboardVisible();
    const sys = window.webOSSystem || window.PalmSystem;
    const v = sys && sys.isKeyboardVisible;
    return typeof v === 'function' ? v.call(sys) : v;
  } catch {
    return undefined;
  }
}

// TVs com teclado próprio para páginas. onFail: abrir o teclado do app quando o nativo não apareceu.
export function hasNativeKeyboard() {
  return /web0s|webos|tizen/i.test(navigator.userAgent) || androidKeyboard();
}

// O app Android abre o teclado do sistema (com voz) a partir do APK que traz showKeyboard.
// Os APKs anteriores continuam com o teclado do app.
function androidKeyboard() {
  const a = window.IPTVKZAndroid;
  return !!a && typeof a.showKeyboard === 'function' && typeof a.isKeyboardVisible === 'function';
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
  if (androidKeyboard()) window.IPTVKZAndroid.showKeyboard(); // no Android, focar o campo não basta
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

// Blocos que aparecem inteiros quando o foco entra neles (ver revealSmooth).
const REVEAL_UNIT = '.shelf, .list-card, [data-reveal-unit]';

// Leva o item para dentro da área visível deslizando, em vez do pulo do scrollIntoView.
// Sobe pelas áreas com rolagem (a fileira anda para o lado, a página desce) e respeita o scroll-padding.
function revealSmooth(el, center) {
  // Item dentro de algo fixo na tela (sticky/fixed, ex.: o destaque do Streaming) já está sempre visível:
  // rolar a área por causa dele só tiraria do lugar o que está embaixo (o catálogo subia ao andar nos botões).
  let pinnedInside = false;
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    const cs = getComputedStyle(box);
    if (cs.position === 'sticky' || cs.position === '-webkit-sticky' || cs.position === 'fixed') { pinnedInside = true; continue; }
    if (pinnedInside) return;
    const canX = box.scrollWidth > box.clientWidth + 1 && /auto|scroll/.test(cs.overflowX);
    const canY = box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(cs.overflowY);
    if (!canX && !canY) continue;
    const br = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const z = br.width / box.offsetWidth || 1; // o zoom da TV: retângulos vêm ampliados, a rolagem não
    const at = glideTarget(box); // compara com onde a área vai parar, não com o meio do caminho
    // a: posição do item no conteúdo; pos: início da janela visível; view: tamanho dela
    // data-reveal="start" na área: o item sempre para no início dela (as fileiras do Streaming sobem até logo
    // abaixo do destaque, como nos apps de streaming); sem isso, rola só o necessário para o item aparecer
    const start = box.dataset.reveal === 'start';
    const axis = (a, size, view, pos, padA, padB, toStart) => {
      if (center) return a + size / 2 - view / 2;
      if (toStart) return Math.abs(a - padA - pos) > 1 ? a - padA : null;
      if (a < pos + padA) return a - padA;
      if (a + size > pos + view - padB) return a + size - view + padB;
      return null;
    };
    const x = canX ? axis((r.left - br.left) / z - box.clientLeft + box.scrollLeft, r.width / z, box.clientWidth, at.x,
      parseFloat(cs.scrollPaddingLeft) || 0, parseFloat(cs.scrollPaddingRight) || 0) : null;
    // Na vertical, o item leva junto o bloco dele (a fileira com o título, o cartão da lista em Configurações):
    // subindo, aparece o bloco desde o topo, e não só o botão ou a capa sem o título de cima. Só se o bloco couber.
    let top = r.top;
    const unit = canY && !start && el.closest(REVEAL_UNIT);
    if (unit && box.contains(unit) && unit !== box) {
      const u = unit.getBoundingClientRect();
      const pads = (parseFloat(cs.scrollPaddingTop) || 0) + (parseFloat(cs.scrollPaddingBottom) || 0);
      if ((r.bottom - u.top) / z <= box.clientHeight - pads) top = u.top;
    }
    const y = canY ? axis((top - br.top) / z - box.clientTop + box.scrollTop, (r.bottom - top) / z, box.clientHeight, at.y,
      parseFloat(cs.scrollPaddingTop) || 0, parseFloat(cs.scrollPaddingBottom) || 0, start) : null;
    if (x != null || y != null) glideTo(box, x, y, holding);
  }
}

export function focusEl(el, { center = false } = {}) {
  if (!el) return;
  if (el !== nativeInput) endNativeInput();
  lockInput(el);
  if (!NATIVE.test(el.tagName) && !el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  syncFocus(el);
  if (keyNav() && !reducedMotion()) {
    revealSmooth(el, center);
    return;
  }
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
  return el.closest('.sidebar') ? 'side' : el.closest('.cats') ? 'cats' : el.closest('.topbar') ? 'top' : 'main';
}

export function focusFirst(root) {
  const scope = root || navScope();
  const isFar = farCheck();
  const els = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => !isFar(el) && visible(el) && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  // de preferência um cartão do conteúdo; campos de texto abririam o teclado da TV
  // só o que já está na tela: um botão principal lá embaixo (ex.: em Configurações) fazia a tela abrir rolada até o fim
  const inView = (sel, top = false) => els.find((el) => {
    if (!el.matches(sel) || !el.closest('#view')) return false;
    if (top && el.getBoundingClientRect().top > window.innerHeight * 0.5) return false; // botão principal: só na metade de cima
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  focusEl(inView('.ch-card, .poster, .ep, .g-prog') || inView('.cat-item.on, .btn.primary', true) || inView('*') || els[0]);
}

// Botões dentro de um cartão (ex.: ★) só são alcançáveis a partir do próprio cartão.
function reachable(el, cur) {
  const card = el.parentElement && el.parentElement.closest(CARD);
  return !card || card === cur || card.contains(cur);
}

let lastMove = 0;
let holding = false; // a seta está sendo segurada (repetições seguidas)

// Navegação parada há pelo menos ms (o controle/teclado não está sendo segurado). Usado para adiar trabalho
// pesado, como encher as fileiras de capas, enquanto a pessoa passa por elas.
export function navIdle(ms = 350) {
  return Date.now() - lastMove >= ms;
}

// Cabeçalho das fileiras (título, "Ver tudo", setas de página): fica fora do caminho normal do controle,
// para ↑/↓ pularem direto de uma fileira de capas para a outra.
const NAV_SKIP = '.shelf-head, [data-nav-skip]';

// Atalho declarado no HTML: data-up="seletor" num bloco (a fileira) leva ao item do seletor mais próximo
// (procurado subindo pelos pais), ex. as setas e o "Ver tudo" do título da fileira. Para não atrapalhar quem só
// está passando pelas fileiras, ele só vale com o gesto ↑ ↓ ↑: subiu desta fileira, voltou para ela e subiu de
// novo em até 3 s. ↓ de lá volta ao cartão de onde veio, se ele ainda estiver à vista.
let upJump = null; // { from, to }
const trail = []; // últimos movimentos: { dir, from, to, t } (from/to = fileira de origem e de destino)
const zoneOf = (el) => (el && el.closest ? el.closest('[data-up]') : null);
function armed(zone) {
  const [a, b] = trail.slice(-2);
  return !!(a && b && a.dir === 'up' && a.from === zone && b.dir === 'down' && b.to === zone && Date.now() - a.t < 3000);
}
function remember(dir, from, to) {
  trail.push({ dir, from: zoneOf(from), to: zoneOf(to), t: Date.now() });
  if (trail.length > 4) trail.shift();
}

function visibleIn(el) {
  const r = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const b = p.getBoundingClientRect();
    if (r.left < b.left - 2 || r.right > b.right + 2 || r.top < b.top - 2 || r.bottom > b.bottom + 2) return false;
  }
  return r.width > 2;
}

function declaredJump(dir, cur) {
  if (dir === 'down' && upJump && upJump.to.contains(cur) && upJump.from.isConnected && visibleIn(upJump.from)) return upJump.from;
  if (dir !== 'up') return null;
  const zone = zoneOf(cur);
  if (!zone || !armed(zone)) return null;
  const sel = zone.dataset.up;
  for (let p = zone.parentElement; p && p !== document.body; p = p.parentElement) {
    if (!p.querySelector(sel)) continue;
    const opts = [...p.querySelectorAll(sel)].filter((el) => !el.classList.contains('off') && el.getBoundingClientRect().width > 2);
    if (!opts.length) return null; // nada para onde ir (ex.: a fileira cabe inteira na tela)
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const dist = (el) => { const r = el.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - ax); };
    return opts.sort((x, y) => dist(x) - dist(y))[0];
  }
  return null;
}

// dir: 'left' | 'right' | 'up' | 'down'. Retorna true se mudou o foco.
export function move(dir) {
  // tecla segurada: repetir mais rápido que a TV desenha só acumula atraso. Na vertical da TV o limite é maior:
  // cada fileira nova traz capas para decodificar em 4K, e segurando ↓ elas chegavam mais rápido do que a placa
  // de vídeo dava conta, até o app travar por segundos.
  const now = Date.now();
  const gap = dir === 'up' || dir === 'down' ? 260 : 90; // TV, Android TV e teclado do PC
  if (now - lastMove < gap) return true;
  // seta segurada (a anterior foi há pouco): a tela pula direto, sem deslizar. Cada deslize faz a TV redesenhar
  // a tela em 4K quadro a quadro; com a tecla segurada, um atrás do outro, ela não dava conta.
  holding = now - lastMove < 450;
  lastMove = now;
  const scope = navScope();
  const cur = document.activeElement;
  if (!cur || cur === document.body || !scope.contains(cur)) {
    focusFirst(scope);
    return true;
  }
  // Área presa (data-nav-trap): as setas só andam dentro dela. Ao chegar na borda, a própria área decide o que
  // fazer (el._navExit(dir)), por ex. o destaque aberto do Streaming devolve o foco ao card de onde se veio.
  const trap = cur.closest && cur.closest('[data-nav-trap]');
  const jump = trap ? null : declaredJump(dir, cur);
  if (jump) {
    // o cabeçalho inteiro (Ver tudo + setas) é a área de onde ↓ volta ao cartão
    upJump = dir === 'up' ? { from: cur, to: jump.closest(NAV_SKIP) || jump.parentElement } : null;
    remember(dir, cur, jump);
    trail.length = 0; // usado: o próximo acesso ao cabeçalho pede o gesto de novo
    focusEl(jump);
    return true;
  }
  // ←/→ numa fileira de capas: a vizinha é a próxima capa da própria fileira. Sem medir nada: medir todos os
  // itens da tela a cada tecla custava 60–120 ms na TV. Na primeira capa, ← segue a busca normal (vai ao menu).
  if (!trap && (dir === 'left' || dir === 'right') && cur.matches(CARD)) {
    const row = zoneOf(cur);
    if (row) {
      const cards = row.querySelectorAll(CARD);
      const i = Array.prototype.indexOf.call(cards, cur);
      const next = i >= 0 ? cards[i + (dir === 'right' ? 1 : -1)] : null;
      if (next) {
        remember(dir, cur, next);
        focusEl(next);
        return true;
      }
      if (i >= 0 && dir === 'right') return true; // última capa: fica onde está
    }
  }
  // ↑/↓ numa fileira de capas: vai sempre para a fileira vizinha (na capa mais próxima na horizontal), mesmo que
  // ela tenha poucas capas e fora do alinhamento. Só da primeira/última fileira o foco sai para o resto da tela.
  if (!trap && (dir === 'up' || dir === 'down')) {
    const row = zoneOf(cur);
    if (row) {
      const rows = [...scope.querySelectorAll('[data-up]')];
      const ax0 = (() => { const a0 = cur.getBoundingClientRect(); return a0.left + a0.width / 2; })();
      for (let i = rows.indexOf(row) + (dir === 'down' ? 1 : -1); i >= 0 && i < rows.length; i += dir === 'down' ? 1 : -1) {
        const cards = [...rows[i].querySelectorAll(CARD)];
        // fileira vizinha ainda sem capas (carrega quando chega perto da tela): rola até ela, o próximo aperto entra
        if (!cards.length) { revealSmooth(rows[i]); return true; }
        const dist = (el) => { const r = el.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - ax0); };
        const target = cards.sort((x, y) => dist(x) - dist(y))[0];
        remember(dir, cur, target);
        focusEl(target);
        return true;
      }
    }
  }
  const curSkip = cur.closest && cur.closest(NAV_SKIP);
  const across = dir === 'left' || dir === 'right';
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const curRegion = region(cur);
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  // A barra do topo (busca, seletor de visualização) é o último recurso do ↑: com a página rolada, os itens de
  // cima ficam fora da tela e a busca, fixa no topo, parecia mais perto. Só vai para ela sem nada acima na página.
  let bestTop = null;
  let topScore = Infinity;
  const isFar = farCheck();
  for (const el of (trap || scope).querySelectorAll(FOCUSABLE)) {
    if (el === cur || isFar(el)) continue;
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
    // ↑/↓ não escolhem quem está ao lado, na mesma altura (ex.: o cartão vizinho)
    if (!across && overlap <= 0 && Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top) > 4) continue;
    const side = across ? Math.abs(cy - ay) : Math.abs(cx - ax);
    // sem alinhamento, pesa o vão entre as bordas: um item largo não pode perder para outro bem mais distante
    const gap = across ? Math.max(0, r.top - a.bottom, a.top - r.bottom) : Math.max(0, r.left - a.right, a.left - r.right);
    const score = primary + (overlap > 0 ? 0 : gap * 2) + side * 0.1;
    const toTop = dir === 'up' && curRegion !== 'top' && region(el) === 'top';
    if (score >= (toTop ? topScore : bestScore)) continue;
    // as checagens que sobem pela árvore ficam por último: só para quem pode ganhar
    if ((cur.contains(el) && !cur.matches(CARD)) || el.closest('.hidden') || !reachable(el, cur)) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue; // invisível mas no layout (ex.: textos no modo trailer)
    // cabeçalho de fileira: só se o foco já estiver nele (andar entre "Ver tudo" e as setas)
    if (!(curSkip && curSkip.contains(el)) && el.closest(NAV_SKIP)) continue;
    // dentro do cabeçalho, ←/→ só andam entre os itens dele
    if (curSkip && across && !curSkip.contains(el)) continue;
    if (toTop) { topScore = score; bestTop = el; continue; }
    // ↑/↓ não saltam entre a barra lateral e o conteúdo (da barra do topo, ↓ desce para o conteúdo)
    const elRegion = region(el);
    // ←/→ não atravessam entre a barra do topo e o conteúdo: do seletor de visualização, → vai ao "Conectado",
    // não a um campo da página; de um campo da página, → não sobe para a busca. O menu lateral continua alcançável.
    if (across && elRegion !== 'side' && curRegion !== 'side' && (elRegion === 'top') !== (curRegion === 'top')) continue;
    if ((dir === 'up' || dir === 'down') && elRegion !== curRegion && !(curRegion === 'top' && elRegion === 'main')) continue;
    bestScore = score;
    best = el;
  }
  if (!best && bestTop) {
    // nada mais acima na página, mas ela ainda está rolada (o topo do item aparece cortado): este ↑ só rola até
    // o topo, para a pessoa ver o que há ali; o próximo ↑ vai para a barra do topo
    for (let box = cur.parentElement; box && box !== document.body; box = box.parentElement) {
      if (box.scrollTop > 1 && /auto|scroll/.test(getComputedStyle(box).overflowY)) {
        glideTo(box, null, 0);
        return true;
      }
    }
    best = bestTop;
  }
  if (best) {
    remember(dir, cur, best);
    focusEl(best);
    return true;
  }
  if (trap) {
    if (trap._navExit) trap._navExit(dir);
    return true; // presa: a tecla não escapa (nem rola a página)
  }
  if (curSkip && across) return true; // ponta do cabeçalho: fica onde está
  return false;
}

export const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

export function isNative(el) {
  return !!el && NATIVE.test(el.tagName);
}
