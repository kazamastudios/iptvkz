// Modo de depuração (só no app Beta, ligado em Configurações): painel no canto de cima à esquerda, em qualquer
// tela, com o que importa ali. Cada parte do app registra uma seção (debugSection) que devolve linhas
// [rótulo, valor, tom]; o tom pinta o número: verde bom, amarelo no limite, vermelho ruim.
// Desligado, nada roda (nem o medidor de quadros da interface).
import { h } from './util.js';

const KEY = 'iptvkz.debug';
const sections = new Map(); // nome -> () => [[rótulo, valor, tom?], ...]
let hud = null;
let timer = null;
let raf = 0;
let frames = [];
let longTasks = [];
let observer = null;

export const isBeta = () => document.documentElement.classList.contains('beta');
export function debugOn() {
  try { return isBeta() && localStorage.getItem(KEY) === '1'; } catch { return false; }
}

// tom pelo valor: low = bom abaixo de a, médio até b (ou o contrário com high=true)
export function tone(v, a, b, high = false) {
  if (!Number.isFinite(v)) return '';
  if (high) return v >= a ? 'good' : v >= b ? 'warn' : 'bad';
  return v <= a ? 'good' : v <= b ? 'warn' : 'bad';
}

export function debugSection(name, fn) {
  if (fn) sections.set(name, fn);
  else sections.delete(name);
}

function loop(t) {
  frames.push(t);
  raf = requestAnimationFrame(loop);
}

function render() {
  const now = performance.now();
  frames = frames.filter((t) => now - t < 1000);
  longTasks = longTasks.filter((x) => now - x.at < 10000);
  let worst = 0;
  for (let i = 1; i < frames.length; i++) worst = Math.max(worst, frames[i] - frames[i - 1]);
  const fps = frames.length;
  const nf = (n, d = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rows = [
    // tela escondida (outro app na frente): o navegador para de desenhar, não é lentidão
    document.hidden || !fps ? ['Interface', 'parada (tela escondida)'] : ['Interface', `${fps} fps`, tone(fps, 50, 30, true), `pior quadro ${nf(worst)} ms`, tone(worst, 34, 100)],
    ['Travadas (10 s)', `${longTasks.length}`, tone(longTasks.length, 0, 3), longTasks.length ? `maior ${nf(Math.max(...longTasks.map((x) => x.ms)))} ms` : '', tone(longTasks.length ? Math.max(...longTasks.map((x) => x.ms)) : 0, 50, 200)],
  ];
  for (const fn of sections.values()) {
    try { rows.push(...(fn() || [])); } catch {}
  }
  const mem = performance.memory ? `${nf(performance.memory.usedJSHeapSize / 1048576)} MB` : '—';
  const memPct = performance.memory ? performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit : NaN;
  rows.push(['Aparelho', `${innerWidth}×${innerHeight} · zoom ${document.documentElement.style.zoom || 1} · densidade ${devicePixelRatio || 1}`, '', `memória ${mem}`, tone(memPct, 0.5, 0.8)]);
  hud.replaceChildren(...rows.map(([label, v1, t1, v2, t2]) => h('div',
    h('span.dbg-l', label), h('span' + (t1 ? '.dbg-' + t1 : ''), v1), v2 ? h('span' + (t2 ? '.dbg-' + t2 : ''), v2) : null)));
}

export function setDebug(on) {
  try { localStorage.setItem(KEY, on ? '1' : ''); } catch {}
  applyDebug();
}

export function applyDebug() {
  const on = debugOn();
  clearInterval(timer);
  cancelAnimationFrame(raf);
  if (observer) { observer.disconnect(); observer = null; }
  if (!on) { if (hud) hud.remove(); hud = null; return; }
  if (!hud) { hud = h('div.debug-hud'); document.body.append(hud); }
  frames = [];
  raf = requestAnimationFrame(loop);
  try {
    observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ at: performance.now(), ms: e.duration });
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}
  render();
  timer = setInterval(render, 1000);
}
