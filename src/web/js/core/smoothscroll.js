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

// ---------- deslizar até uma posição (usado pelo foco da TV) ----------
// Mesmo princípio da rodinha, em qualquer eixo e em várias áreas ao mesmo tempo (ex.: a fileira anda para
// o lado enquanto a página desce). Um novo destino no meio do caminho só muda o alvo: o movimento não quebra.

const GLIDE = 0.22; // por quadro a 60 Hz: chega em ~200 ms
const glides = new Map(); // área → { x, y, snap }
let glideFrame = 0;
let glideLast = 0;

// Para onde a área está indo (ou onde está, se parada).
export function glideTarget(box) {
  const g = glides.get(box);
  return { x: g && g.x != null ? g.x : box.scrollLeft, y: g && g.y != null ? g.y : box.scrollTop };
}

export function glideTo(box, x, y) {
  let g = glides.get(box);
  if (!g) {
    // o encaixe dos cartões puxaria cada passo de volta; volta quando o deslize termina
    g = { x: null, y: null, snap: box.style.scrollSnapType };
    box.style.scrollSnapType = 'none';
    glides.set(box, g);
  }
  if (x != null) g.x = Math.max(0, Math.min(box.scrollWidth - box.clientWidth, x));
  if (y != null) g.y = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, y));
  if (!glideFrame) {
    glideLast = performance.now() - 16.7;
    glideFrame = requestAnimationFrame(glideTick);
  }
}

// Para o deslize de uma área onde ela estiver (ex.: a pessoa agarrou a fileira com o mouse).
export function stopGlide(box) {
  const g = glides.get(box);
  if (!g) return;
  box.style.scrollSnapType = g.snap;
  glides.delete(box);
}

// Anda um eixo; devolve true quando chegou (ou não consegue andar mais).
function stepAxis(box, prop, goal, k) {
  if (goal == null) return true;
  const now = box[prop];
  const d = goal - now;
  if (Math.abs(d) < 1) { box[prop] = goal; return true; }
  box[prop] = now + d * k;
  if (box[prop] !== now) return false;
  box[prop] = goal; // arredondou para o mesmo pixel: termina no destino
  return true;
}

function glideTick(now) {
  const dt = Math.min(64, now - glideLast);
  glideLast = now;
  const k = 1 - Math.pow(1 - GLIDE, dt / 16.7);
  scrolling();
  for (const [box, g] of glides) {
    const doneX = stepAxis(box, 'scrollLeft', g.x, k);
    const doneY = stepAxis(box, 'scrollTop', g.y, k);
    if ((doneX && doneY) || !box.isConnected) {
      box.style.scrollSnapType = g.snap;
      glides.delete(box);
    }
  }
  glideFrame = glides.size ? requestAnimationFrame(glideTick) : 0;
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
