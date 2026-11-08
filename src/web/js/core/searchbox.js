// Busca inteligente: ordena por relevância, tolera erro de digitação e mostra os resultados enquanto digita.
import { norm } from './util.js';
import { visibleItems } from './store.js';
import { TV, focusFirst } from '../tv/tv.js';

const TAGS = /\[[^\]]*\]|\([^)]*\)/g;
const cache = new WeakMap();

function words(item) {
  let c = cache.get(item);
  if (!c) {
    const text = norm(item.name.replace(TAGS, ' ')).replace(/[^a-z0-9]+/g, ' ').trim();
    c = { text, list: text.split(' ').filter(Boolean) };
    cache.set(item, c);
  }
  return c;
}

// Distância de edição com limite: desiste assim que passa de `max`.
function closeEnough(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

function exactScore(item, q, qWords) {
  const { text, list } = words(item);
  if (text === q) return 120;
  if (text.startsWith(q)) return 100;
  if (list.some((w) => w.startsWith(q))) return 85;
  if (qWords.length > 1 && qWords.every((qw) => list.some((w) => w.startsWith(qw)))) return 75;
  if (text.includes(q)) return 60;
  return 0;
}

function fuzzyScore(item, qWords) {
  const { list } = words(item);
  const hit = qWords.every((qw) => qw.length >= 4 && list.some((w) => {
    // corte barato: quase toda palavra errada já cai aqui, sem calcular a distância
    if (w[0] !== qw[0] && w[1] !== qw[1] && w[0] !== qw[1]) return false;
    const max = qw.length >= 8 ? 2 : 1;
    return closeEnough(qw, w, max) || closeEnough(qw, w.slice(0, qw.length), max);
  }));
  return hit ? 40 : 0;
}

const lastSearch = {};

// Prepara os nomes aos poucos, depois que a lista abre: a primeira busca já vem pronta.
let warmRun = 0;
export function warmSearch() {
  const run = ++warmRun;
  const queue = ['live', 'movies', 'series'].flatMap((s) => visibleItems(s));
  let i = 0;
  const slice = () => {
    if (run !== warmRun) return;
    const end = Math.min(i + 1000, queue.length);
    for (; i < end; i++) words(queue[i]);
    if (i < queue.length) setTimeout(slice, 30);
  };
  setTimeout(slice, 2000);
}

// Itens de uma seção, do mais relevante para o menos.
export function rankItems(section, query) {
  const q = norm(query).replace(/[^a-z0-9]+/g, ' ').trim();
  if (q.length < 2) return [];
  const qWords = q.split(' ');
  const items = visibleItems(section);
  // Mais uma letra só pode reduzir o resultado: procura dentro do que a busca anterior achou.
  const prev = lastSearch[section];
  const pool = prev && prev.total === items.length && prev.first === items[0] && q.startsWith(prev.q) ? prev.hits : items;
  const scored = [];
  for (const item of pool) {
    const score = exactScore(item, q, qWords);
    if (score) scored.push({ item, score });
  }
  lastSearch[section] = { q, total: items.length, first: items[0], hits: scored.map((s) => s.item) };
  // só procura erros de digitação quando a busca exata achou pouco
  if (scored.length < 8 && q.length >= 4) {
    const found = new Set(scored.map((s) => s.item));
    for (const item of items) {
      if (found.has(item)) continue;
      const score = fuzzyScore(item, qWords);
      if (score) scored.push({ item, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || words(a.item).text.length - words(b.item).text.length);
  return scored;
}

// Os resultados aparecem na tela principal enquanto a pessoa digita.
export function initSearchBox(input, ctx, debounce) {
  const onSearch = () => location.hash.startsWith('#/search');
  const show = () => {
    const q = input.value.trim();
    if (q.length >= 2) ctx.navigate('#/search?q=' + encodeURIComponent(q), { replace: onSearch() });
    else if (!q && onSearch()) history.back(); // apagou tudo: volta para onde estava
  };
  // na TV espera uma pausa maior: cada letra no controle não precisa redesenhar a tela
  const quick = debounce(show, 200);
  const calm = debounce(show, 600);
  input.addEventListener('input', () => (TV.on ? calm() : quick()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !TV.on) { e.preventDefault(); show(); }
  });
  // Enter no teclado da TV: busca na hora e leva o foco para os resultados.
  input.addEventListener('tvsubmit', (e) => {
    e.preventDefault();
    show();
    setTimeout(() => focusFirst(), 400);
  });
}
