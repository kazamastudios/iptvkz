// Rolagem suave da rodinha do mouse, no estilo do ScrollSmoother do GSAP ou do Lenis, sem biblioteca.
// A rodinha não rola direto: ela move um "alvo", e a área de rolagem persegue esse alvo a cada quadro,
// cobrindo uma fração da distância que falta. O resultado é uma rolagem que acelera e freia sozinha.
// Só no PC: a TV rola pelo foco do controle, e no celular o dedo já tem embalo próprio.

import { TV } from '../tv/tv.js';

const EASE = 0.14; // fração da distância percorrida por quadro (60 Hz): menor = mais macio, maior = mais rápido
const LINE = 40; // px por "linha" quando o sistema informa a rodinha em linhas (Firefox)

// Enquanto algo desliza, o hover das capas fica desligado (classe no <html>): sem isso, cada capa que passa por
// baixo do mouse parado acende e apaga a borda e o zoom, várias animações começando e parando a cada quadro.
let busyTimer = 0;
export function scrolling() {
  document.documentElement.classList.add('is-scrolling');
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => document.documentElement.classList.remove('is-scrolling'), 160);
}

let el = null; // área que está rolando
let target = 0;
let frame = 0;
let last = 0;

// A área de rolagem vertical mais próxima do ponteiro que ainda consegue andar nesse sentido.
function scrollerFor(start, dy) {
  for (let n = start; n && n !== document.documentElement; n = n.parentElement) {
    if (n.scrollHeight <= n.clientHeight + 1) continue;
    const oy = getComputedStyle(n).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') continue;
    const max = n.scrollHeight - n.clientHeight;
    if ((dy > 0 && n.scrollTop < max - 1) || (dy < 0 && n.scrollTop > 1)) return n;
  }
  return null;
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  el = null;
}

function tick(now) {
  // corrige pela duração real do quadro: em tela de 120 Hz ou num quadro atrasado o ritmo é o mesmo
  const dt = Math.min(64, now - last);
  last = now;
  const before = el.scrollTop;
  const diff = target - before;
  if (Math.abs(diff) < 0.5 || !el.isConnected) {
    el.scrollTop = target;
    return stop();
  }
  el.scrollTop = before + diff * (1 - Math.pow(1 - EASE, dt / 16.7));
  scrolling();
  // não andou (a página encolheu e o alvo ficou fora de alcance): para, em vez de tentar para sempre
  if (el.scrollTop === before) return stop();
  frame = requestAnimationFrame(tick);
}

function onWheel(e) {
  // modo TV (o Magic Remote da LG também tem rodinha), zoom (ctrl), rolagem lateral e campos ficam com o navegador
  if (TV.on || e.defaultPrevented || e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [data-native-wheel]')) return;
  const dy = e.deltaMode === 1 ? e.deltaY * LINE : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
  const box = scrollerFor(e.target, dy);
  if (!box) return;
  e.preventDefault();
  if (box !== el) {
    stop();
    el = box;
    target = box.scrollTop;
  }
  target = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, target + dy));
  if (!frame) {
    last = performance.now() - 16.7;
    frame = requestAnimationFrame(tick);
  }
}

// ---------- deslizar até uma posição (usado pelo foco do controle e do teclado) ----------
// Usa a rolagem suave do próprio navegador (scrollTo com behavior: 'smooth'). Ela roda na placa de vídeo, fora
// do código do app: continua lisa mesmo quando a página está montando as fileiras que entram na tela. Antes o
// app movia a rolagem a cada quadro, e na TV cada passo esperava o layout da página inteira.
// Várias áreas ao mesmo tempo (a fileira anda para o lado enquanto a página desce); um novo destino no meio do
// caminho só muda o alvo, o movimento não quebra.

const glides = new Map(); // área → { x, y, snap, timer }
const glideEndFns = new Set();
const SETTLE = 160; // ms sem eventos de rolagem = chegou

// Para onde a área está indo (ou onde está, se parada).
export function glideTarget(box) {
  const g = glides.get(box);
  return { x: g && g.x != null ? g.x : box.scrollLeft, y: g && g.y != null ? g.y : box.scrollTop };
}

function finish(box) {
  const g = glides.get(box);
  if (!g) return;
  clearTimeout(g.timer);
  box.removeEventListener('scroll', g.onScroll);
  box.style.scrollSnapType = g.snap;
  glides.delete(box);
  if (!glides.size) glideEndFns.forEach((fn) => fn());
}

// instant: pula direto (ex.: seta segurada na TV), sem a animação.
export function glideTo(box, x, y, instant = false) {
  let g = glides.get(box);
  if (!g) {
    // o encaixe dos cartões puxaria o movimento para outro lugar; volta quando o deslize termina
    g = { x: null, y: null, snap: box.style.scrollSnapType, timer: 0 };
    g.onScroll = () => {
      if (!TV.on) scrolling(); // no PC, o hover das capas fica desligado enquanto a área anda
      clearTimeout(g.timer);
      g.timer = setTimeout(() => finish(box), SETTLE);
    };
    box.style.scrollSnapType = 'none';
    box.addEventListener('scroll', g.onScroll, { passive: true });
    glides.set(box, g);
  }
  if (x != null) g.x = Math.max(0, Math.min(box.scrollWidth - box.clientWidth, x));
  if (y != null) g.y = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, y));
  const opts = { behavior: instant ? 'instant' : 'smooth' };
  if (g.x != null) opts.left = g.x;
  if (g.y != null) opts.top = g.y;
  try { box.scrollTo(opts); } catch { if (g.x != null) box.scrollLeft = g.x; if (g.y != null) box.scrollTop = g.y; }
  // se nada rolar (já estava no lugar), termina sozinho
  clearTimeout(g.timer);
  g.timer = setTimeout(() => finish(box), SETTLE + 140);
}

// Quanto a área ainda vai andar até parar ({ x, y } em px do CSS). Usado pela moldura de foco para ir direto
// ao lugar final, sem medir a tela a cada quadro.
export function glideLeft(box) {
  const g = glides.get(box);
  if (!g) return { x: 0, y: 0 };
  return { x: g.x != null ? g.x - box.scrollLeft : 0, y: g.y != null ? g.y - box.scrollTop : 0 };
}
export const gliding = () => glides.size > 0;
export function onGlideEnd(fn) { glideEndFns.add(fn); }

// Para o deslize de uma área onde ela estiver (ex.: a pessoa agarrou a fileira com o mouse).
export function stopGlide(box) {
  if (!glides.has(box)) return;
  try { box.scrollTo({ left: box.scrollLeft, top: box.scrollTop, behavior: 'auto' }); } catch {}
  finish(box);
}

export function initSmoothScroll() {
  const pc = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!pc || calm) return;
  window.addEventListener('wheel', onWheel, { passive: false });
  // teclado, clique ou arrastar a barra no meio do caminho: a rolagem fica onde está
  window.addEventListener('keydown', stop, true);
  window.addEventListener('pointerdown', stop, true);
}
