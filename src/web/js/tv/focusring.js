// Moldura de foco que desliza de um cartão para o outro na TV (como na Apple TV), em vez de cada cartão
// acender a própria borda. É um elemento só, movido por transform: a placa de vídeo faz o trabalho.
// Vale para capas, canais e episódios; botões e menus seguem com o destaque próprio.

const CARDS = '.poster, .ch-card, .ep';
const EASE = 0.3; // fração da distância por quadro a 60 Hz: chega em ~130 ms

let ring = null;
let target = null; // elemento que a moldura contorna
let clips = []; // áreas com rolagem em volta do alvo: a moldura não aparece fora delas
let covers = []; // elementos fixos por cima da área (ex.: o destaque do Streaming): a moldura passa por baixo deles
let cur = null; // posição atual { x, y, w, h }
let zoom = 0; // px na tela por px do CSS (a TV usa zoom no html); 0 = medir de novo
let frame = 0;
let last = 0;

function ensure() {
  if (ring) return;
  ring = document.createElement('div');
  ring.className = 'tv-ring';
  document.body.appendChild(ring);
  // a rolagem de qualquer área (inclusive o deslize do foco) e o redimensionamento movem o alvo
  document.addEventListener('scroll', kick, { capture: true, passive: true });
  window.addEventListener('resize', () => { zoom = 0; kick(); });
}

// Mede quanto 1px do CSS vale na tela, pela própria moldura (vale para os dois jeitos de zoom do Chromium).
function measureZoom() {
  ring.style.transform = 'none';
  ring.style.width = '100px';
  ring.style.height = '100px';
  return ring.getBoundingClientRect().width / 100 || 1;
}

function hide() {
  target = null;
  cur = null;
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
  last = performance.now() - 16.7;
  frame = requestAnimationFrame(tick);
}

function tick(now) {
  frame = 0;
  if (!target || !target.isConnected) return hide();
  if (!zoom) zoom = measureZoom();
  const r = target.getBoundingClientRect();
  const goal = { x: r.left / zoom, y: r.top / zoom, w: r.width / zoom, h: r.height / zoom };
  let moving = false;
  if (!cur || !ring.classList.contains('on')) {
    cur = goal; // primeira aparição: nasce no lugar e só acende
  } else {
    const dt = Math.min(64, now - last);
    const k = 1 - Math.pow(1 - EASE, dt / 16.7);
    for (const p of ['x', 'y', 'w', 'h']) {
      const d = goal[p] - cur[p];
      if (Math.abs(d) < 0.3) cur[p] = goal[p];
      else { cur[p] += d * k; moving = true; }
    }
  }
  last = now;
  ring.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
  ring.style.width = cur.w + 'px';
  ring.style.height = cur.h + 'px';
  // corta o que passar das áreas com rolagem (ex.: o cartão saindo pela borda da fileira)
  let top = -1e4, left = -1e4, right = 1e4, bottom = 1e4;
  for (const c of clips) {
    const b = c.getBoundingClientRect();
    top = Math.max(top, b.top / zoom); left = Math.max(left, b.left / zoom);
    right = Math.min(right, b.right / zoom); bottom = Math.min(bottom, b.bottom / zoom);
  }
  // um elemento fixo no topo (destaque) tampa a parte de cima da área: a moldura começa abaixo dele
  for (const c of covers) {
    const b = c.getBoundingClientRect();
    if (b.top / zoom <= top + 1 && b.bottom / zoom > top) top = b.bottom / zoom;
  }
  // valor negativo deixa o brilho da moldura sair até 12px quando o cartão está inteiro à vista
  const cut = (v) => Math.max(-12, v);
  ring.style.clipPath = `inset(${cut(top - cur.y)}px ${cut(cur.x + cur.w - right)}px ${cut(cur.y + cur.h - bottom)}px ${cut(left - cur.x)}px)`;
  ring.classList.add('on');
  if (moving) frame = requestAnimationFrame(tick);
}
