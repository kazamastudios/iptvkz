// Favoritos: canais, filmes e séries marcados com a estrela.
import { h, ico, img } from '../core/util.js';
import { favItems } from '../core/store.js';
import { posterCard } from './vod.js';

const FILTERS = [['all', 'Tudo'], ['live', 'Canais'], ['movies', 'Filmes'], ['series', 'Séries']];
const TITLES = { live: 'Canais', movies: 'Filmes', series: 'Séries' };

export function favoritesView(params, ctx) {
  ctx.setTitle('Favoritos');
  let filter = 'all';
  const chips = h('div.row', { style: { gap: '6px', margin: '6px 0 20px' } });
  const body = h('div');
  // celular: "Salvos" junta as duas telas, com abas para trocar
  const savedTabs = h('div.tabs.saved-tabs',
    h('a' + ('favorites' === 'mylist' ? '.on' : ''), { href: '#/mylist' }, 'Minha lista'),
    h('a' + ('favorites' === 'favorites' ? '.on' : ''), { href: '#/favorites' }, 'Favoritos'));
  const page = h('div.page', savedTabs, chips, body);

  const channelCard = (ch) => h('div.ch-card', {
    title: ch.name,
    onclick: () => ctx.navigate(`#/live?cat=fav&ch=${encodeURIComponent(ch.id)}`),
  }, img(ch.logo, ch.name), h('div.info', h('div.name', ch.name)));

  function block(section) {
    const items = favItems(section);
    if (!items.length) return null;
    const grid = section === 'live' ? h('div.ch-grid', items.map(channelCard))
      : h('div.poster-grid', items.map((it) => posterCard(section, it, ctx)));
    return h('div.search-block', h('h3', TITLES[section], h('small', String(items.length))), grid);
  }

  function render() {
    chips.replaceChildren(...FILTERS.map(([v, l]) =>
      h('button.chip' + (v === filter ? '.on' : ''), { onclick: () => { filter = v; render(); } }, l)));
    const blocks = (filter === 'all' ? ['live', 'movies', 'series'] : [filter]).map(block).filter(Boolean);
    if (blocks.length) body.replaceChildren(...blocks);
    else {
      body.replaceChildren(h('div.center-state', { style: { height: '55vh' } }, ico('star'),
        h('h2', 'Nenhum favorito ainda'), h('p', 'Use a estrela nos canais, filmes e séries para encontrá-los aqui.')));
    }
  }
  render();
  return { el: page };
}
