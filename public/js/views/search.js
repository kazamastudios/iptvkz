// Busca global: canais, filmes e séries ao mesmo tempo.
import { h, img, matcher } from '../util.js';
import { visibleItems } from '../store.js';
import { posterCard } from './vod.js';

const LIMIT = 40;

export function searchView(params, ctx) {
  const q = (params.get('q') || '').trim();
  ctx.setTitle(q ? `Busca: “${q}”` : 'Busca');
  const page = h('div.page');
  if (q.length < 2) {
    page.append(h('div.center-state', { style: { height: '60vh' } }, h('h2', 'O que você quer assistir?'), h('p', 'Digite pelo menos 2 letras na busca lá em cima.')));
    return { el: page };
  }
  const m = matcher(q);
  const live = visibleItems('live').filter((x) => m(x.name));
  const movies = visibleItems('movies').filter((x) => m(x.name));
  const series = visibleItems('series').filter((x) => m(x.name));

  if (!live.length && !movies.length && !series.length) {
    page.append(h('div.center-state', { style: { height: '60vh' } }, h('h2', 'Nada encontrado'), h('p', `Nenhum canal, filme ou série com “${q}”.`)));
    return { el: page };
  }

  const block = (title, total, body, more) => h('div.search-block',
    h('h3', title, h('small', total > LIMIT ? `${LIMIT} de ${total.toLocaleString('pt-BR')}` : String(total))), body, more || null);

  if (live.length) {
    const grid = h('div.ch-grid');
    for (const ch of live.slice(0, LIMIT)) {
      grid.append(h('div.ch-card', { onclick: () => ctx.navigate(`#/live?cat=${encodeURIComponent(ch.cat)}&ch=${encodeURIComponent(ch.id)}`), title: ch.name },
        img(ch.logo, ch.name), h('div.info', h('div.name', ch.name))));
    }
    page.append(block('Canais', live.length, grid));
  }
  for (const [section, title, arr] of [['movies', 'Filmes', movies], ['series', 'Séries', series]]) {
    if (!arr.length) continue;
    const grid = h('div.poster-grid');
    for (const it of arr.slice(0, LIMIT)) grid.append(posterCard(section, it, ctx));
    page.append(block(title, arr.length, grid));
  }
  return { el: page };
}
