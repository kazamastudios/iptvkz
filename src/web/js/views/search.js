// Busca global: canais, filmes e séries ao mesmo tempo.
import { h, img } from '../core/util.js';
import { rankItems } from '../core/searchbox.js';
import { posterCard } from './vod.js';
import { TV } from '../tv/tv.js';

export function searchView(params, ctx) {
  const LIMIT = TV.on ? 20 : 40; // cada letra redesenha a tela: na TV, menos cartões
  const q = (params.get('q') || '').trim();
  ctx.setTitle(q ? `Busca: “${q}”` : 'Busca');
  const page = h('div.page');
  if (q.length < 2) {
    page.append(h('div.center-state', { style: { height: '60vh' } }, h('h2', 'O que você quer assistir?'), h('p', 'Digite pelo menos 2 letras na busca lá em cima.')));
    return { el: page };
  }
  const best = (section) => rankItems(section, q).map((r) => r.item);
  const live = best('live');
  const movies = best('movies');
  const series = best('series');

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
