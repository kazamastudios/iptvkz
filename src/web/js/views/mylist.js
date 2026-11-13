// Minha lista: filmes e séries salvos para assistir depois.
import { h, ico } from '../core/util.js';
import { laterItems } from '../core/store.js';
import { posterCard } from './vod.js';

const FILTERS = [['all', 'Tudo'], ['movies', 'Filmes'], ['series', 'Séries']];

export function myListView(params, ctx) {
  ctx.setTitle('Minha lista');
  let filter = 'all';
  const chips = h('div.row', { style: { gap: '6px', margin: '6px 0 20px' } });
  const body = h('div');
  // celular: "Salvos" junta as duas telas, com abas para trocar
  const savedTabs = h('div.tabs.saved-tabs',
    h('a' + ('mylist' === 'mylist' ? '.on' : ''), { href: '#/mylist' }, 'Minha lista'),
    h('a' + ('mylist' === 'favorites' ? '.on' : ''), { href: '#/favorites' }, 'Favoritos'));
  const page = h('div.page', savedTabs, chips, body);

  function render() {
    chips.replaceChildren(...FILTERS.map(([v, l]) =>
      h('button.chip' + (v === filter ? '.on' : ''), { onclick: () => { filter = v; render(); } }, l)));
    const sections = filter === 'all' ? ['movies', 'series'] : [filter];
    const entries = sections.flatMap((section) => laterItems(section).map((item) => ({ section, item })));
    if (!entries.length) {
      body.replaceChildren(h('div.center-state', { style: { height: '55vh' } }, ico('mylist'),
        h('h2', 'Sua lista está vazia'), h('p', 'Abra um filme ou série e use o botão “Minha lista” para salvar e assistir depois.')));
      return;
    }
    const grid = h('div.poster-grid');
    for (const e of entries) grid.append(posterCard(e.section, e.item, ctx));
    body.replaceChildren(grid);
  }
  render();
  return { el: page };
}
