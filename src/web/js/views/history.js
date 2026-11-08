// Histórico: o que está em andamento (onde parei) e o que já foi assistido.
import { h, ico, toast } from '../core/util.js';
import { watchHistory, clearHistoryEntries } from '../core/store.js';
import { TV, focusFirst } from '../tv/tv.js';
import { posterCard } from './vod.js';

const FILTERS = [['all', 'Tudo'], ['movies', 'Filmes'], ['series', 'Séries']];

export function historyView(params, ctx) {
  ctx.setTitle('Histórico');
  let filter = 'all';
  const page = h('div.page');
  const chips = h('div.row', { style: { gap: '6px', margin: '6px 0 20px' } });
  const body = h('div');
  page.append(chips, body);

  function block(title, entries) {
    if (!entries.length) return null;
    const grid = h('div.poster-grid');
    for (const e of entries) grid.append(posterCard(e.section, e.item, ctx, { where: true }));
    const clear = h('button.link-btn', {
      title: `Tirar ${entries.length === 1 ? 'este item' : 'estes itens'} do histórico`,
      onclick: () => {
        const undo = clearHistoryEntries(entries);
        render();
        if (TV.on) setTimeout(() => focusFirst(), 30);
        toast(`“${title}” limpo`, 'info', 6000, { label: 'Desfazer', fn: () => { undo(); render(); } });
      },
    }, 'Limpar');
    return h('div.search-block', h('h3', title, h('small', String(entries.length)), clear), grid);
  }

  function render() {
    chips.replaceChildren(...FILTERS.map(([v, l]) =>
      h('button.chip' + (v === filter ? '.on' : ''), { onclick: () => { filter = v; render(); } }, l)));
    const { inProgress, done } = watchHistory();
    const pick = (arr) => (filter === 'all' ? arr : arr.filter((e) => e.section === filter));
    const a = block('Em andamento', pick(inProgress));
    const b = block('Assistidos', pick(done));
    body.replaceChildren(a, b);
    if (!a && !b) {
      body.replaceChildren(h('div.center-state', { style: { height: '55vh' } }, ico('history'),
        h('h2', 'Nada por aqui ainda'), h('p', 'Os filmes e séries que você assistir aparecem aqui, com o ponto em que parou.')));
    }
  }
  render();
  return { el: page };
}
