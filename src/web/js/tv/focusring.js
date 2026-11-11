// Moldura de foco que desliza de um cartão para o outro na TV (como na Apple TV), em vez de cada cartão
// acender a própria borda. É um elemento só, movido por transform com transição do CSS: a placa de vídeo
// faz o movimento. Vale para capas, canais e episódios; botões e menus seguem com o destaque próprio.
//
// Leveza: a posição é medida uma vez por troca de foco, já descontando o quanto as áreas ainda vão rolar
// (o deslize do foco, core/smoothscroll.js). Medir o cartão a cada quadro enquanto a página rola obrigava a TV
// a refazer o layout 60 vezes por segundo, e era isso que travava o ↑/↓.

import { glideLeft, gliding, onGlideEnd } from '../core/smoothscroll.js';

const CARDS = '.poster, .ch-card, .ep';

let ring = null;
let target = null; // elemento que a moldura contorna
let clips = []; // áreas com rolagem em volta do alvo: a moldura não aparece fora delas
let covers = []; // elementos fixos por cima da área (ex.: o destaque do Streaming): a moldura passa por baixo deles
let zoom = 0; // px na tela por px do CSS (a TV usa zoom no html); 0 = medir de novo
let frame = 0;
let shown = false;
let size = '';

function ensure() {
  if (ring) return;
  ring = document.createElement('div');
  ring.className = 'tv-ring';
  document.body.appendChild(ring);
  // rolagem que não é o deslize do foco (rodinha, arrastar) e redimensionamento: mede de novo, uma vez por quadro
  document.addEventListener('scroll', () => { if (!gliding()) kick(); }, { capture: true, passive: true });
  window.addEventListener('resize', () => { zoom = 0; kick(); });
  // fim do deslize: confere a posição real (uma medida só)
  onGlideEnd(() => kick());
}

// Mede quanto 1px do CSS vale na tela (vale para os dois jeitos de zoom do Chromium). Usa um elemento próprio,
// invisível e sem transição: medir a moldura pegava o tamanho dela no meio da animação, e com o zoom errado
// ela parava fora do lugar (um quadrado vermelho solto na tela).
let probe = null;
function measureZoom() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:1px;visibility:hidden;pointer-events:none;transition:none;transform:none';
    document.body.appendChild(probe);
  }
  return probe.getBoundingClientRect().width / 100 || 1;
}

function hide() {
  target = null;
  shown = false;
  zoom = 0; // o modo TV pode ter mudado o zoom enquanto a moldura estava apagada
  if (ring) ring.classList.remove('on');
  document.documentElement.classList.remove('tv-ring-on');
}

export function ringTo(el) {
  const ok = el && el.matches && el.matches(CARDS) && el.closest('#view') && !el.closest('.hidden');
  if (!ok) return hide();
  ensure();
  target = el.matches('.poster') ? el.querySelector('.thumb') || el : el;
  ring.style.borderRadius = getComputedStyle(target).borderRadius;
  clips = [];
  for (let n = target.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') clips.push(n);
  }
  covers = [...document.querySelectorAll('[data-ring-cover]')].filter((c) => !c.contains(target) && clips.some((k) => k.contains(c)));
  document.documentElement.classList.add('tv-ring-on');
  kick();
}

function kick() {
  if (!target || frame) return;
  frame = requestAnimationFrame(place);
}

// Quanto um elemento ainda vai se mover na tela (px do CSS) porque as áreas em volta dele ainda estão rolando.
function pending(el) {
  let x = 0;
  let y = 0;
  for (const c of clips) {
    if (c === el || !c.contains(el)) continue;
    const d = glideLeft(c);
    x += d.x;
    y += d.y;
  }
  return { x, y };
}

function place() {
  frame = 0;
  if (!target || !target.isConnected) return hide();
  if (!zoom) zoom = measureZoom();
  // onde o cartão vai estar quando a rolagem terminar
  const r = target.getBoundingClientRect();
  const p = pending(target);
  const x = r.left / zoom - p.x;
  const y = r.top / zoom - p.y;
  const w = r.width / zoom;
  const h = r.height / zoom;
  // corta o que passar das áreas com rolagem (ex.: o cartão saindo pela borda da fileira), também no lugar final
  let top = -1e4, left = -1e4, right = 1e4, bottom = 1e4;
  for (const c of clips) {
    const b = c.getBoundingClientRect();
    const q = pending(c);
    top = Math.max(top, b.top / zoom - q.y); left = Math.max(left, b.left / zoom - q.x);
    right = Math.min(right, b.right / zoom - q.x); bottom = Math.min(bottom, b.bottom / zoom - q.y);
  }
  // um elemento fixo no topo (destaque) tampa a parte de cima da área: a moldura começa abaixo dele
  for (const c of covers) {
    const b = c.getBoundingClientRect();
    if (b.top / zoom <= top + 1 && b.bottom / zoom > top) top = b.bottom / zoom;
  }
  // primeira aparição: nasce no lugar, sem deslizar
  ring.classList.toggle('instant', !shown);
  ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  const s = `${w}|${h}`;
  if (s !== size) { size = s; ring.style.width = w + 'px'; ring.style.height = h + 'px'; }
  // valor negativo deixa o brilho da moldura sair até 12px quando o cartão está inteiro à vista
  const cut = (v) => Math.max(-12, v);
  ring.style.clipPath = `inset(${cut(top - y)}px ${cut(x + w - right)}px ${cut(y + h - bottom)}px ${cut(left - x)}px)`;
  ring.classList.add('on');
  shown = true;
}
