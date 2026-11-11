// Histórico: o que está em andamento (onde parei) e o que já foi assistido.
import { h, ico, toast } from '../core/util.js';
import { watchHistory, clearHistoryEntries } from '../core/store.js';
import { TV, focusFirst } from '../tv/tv.js';
import { posterCard, streamHero, wideCardFor, wireStream, rowControls } from './vod.js';
import { viewMode } from '../core/viewmode.js';

const FILTERS = [['all', 'Tudo'], ['movies', 'Filmes'], ['series', 'Séries']];

export function historyView(params, ctx) {
  ctx.setTitle('Histórico');
  return viewMode() === 'stream' ? historyStream(ctx) : historyClassic(ctx);
}

function emptyState() {
  return h('div.center-state', { style: { height: '55vh' } }, ico('history'),
    h('h2', 'Nada por aqui ainda'), h('p', 'Os filmes e séries que você assistir aparecem aqui, com o ponto em que parou.'));
}

// "Limpar" tira o bloco do histórico na hora; o aviso permite desfazer.
function clearButton(title, entries, render) {
  return h('button.link-btn', {
    title: `Tirar ${entries.length === 1 ? 'este item' : 'estes itens'} do histórico`,
    onclick: () => {
      const undo = clearHistoryEntries(entries);
      render();
      if (TV.on) setTimeout(() => focusFirst(), 30);
      toast(`“${title}” limpo`, 'info', 6000, { label: 'Desfazer', fn: () => { undo(); render(); } });
    },
  }, 'Limpar');
}

function filterChips(chips, state, render) {
  chips.replaceChildren(...FILTERS.map(([v, l]) =>
    h('button.chip' + (v === state.filter ? '.on' : ''), { onclick: () => { state.filter = v; render(); } }, l)));
}

function entriesFor(state) {
  const { inProgress, done } = watchHistory();
  const pick = (arr) => (state.filter === 'all' ? arr : arr.filter((e) => e.section === state.filter));
  return { inProgress: pick(inProgress), done: pick(done) };
}

function historyClassic(ctx) {
  const state = { filter: 'all' };
  const chips = h('div.row', { style: { gap: '6px', margin: '6px 0 20px' } });
  const body = h('div');
  const page = h('div.page', chips, body);

  function block(title, entries) {
    if (!entries.length) return null;
    const grid = h('div.poster-grid');
    for (const e of entries) grid.append(posterCard(e.section, e.item, ctx, { where: true }));
    return h('div.search-block', h('h3', title, h('small', String(entries.length)), clearButton(title, entries, render)), grid);
  }

  function render() {
    filterChips(chips, state, render);
    const { inProgress, done } = entriesFor(state);
    const a = block('Em andamento', inProgress);
    const b = block('Assistidos', done);
    body.replaceChildren(a, b);
    if (!a && !b) body.replaceChildren(emptyState());
  }
  render();
  return { el: page };
}

// Streaming: o mesmo destaque de Filmes e Séries, com "Em andamento" e "Assistidos" em fileiras de cards deitados.
function historyStream(ctx) {
  const state = { filter: 'all' };
  const hero = streamHero(ctx);
  const card = wideCardFor(hero);
  const chips = h('div.row', { style: { gap: '6px', margin: '6px 0 14px' } });
  const body = h('div');
  const el = h('div.stream-home', hero.el, h('div.page', chips, body));
  wireStream(el, hero);

  function shelf(title, entries) {
    if (!entries.length) return null;
    const row = h('div.shelf-row');
    for (const e of entries) row.append(card(e.section, e.item, ctx, { where: true }));
    const nav = rowControls(row);
    return h('div.shelf',
      h('div.shelf-head', h('h3', title), h('span.faint', String(entries.length)), clearButton(title, entries, render), nav.pager),
      nav.body);
  }

  function render() {
    filterChips(chips, state, render);
    const { inProgress, done } = entriesFor(state);
    const first = inProgress[0] || done[0];
    hero.el.hidden = !first;
    if (first) hero.show(first.item, first.section, true);
    const a = shelf('Em andamento', inProgress);
    const b = shelf('Assistidos', done);
    body.replaceChildren(a, b);
    if (!a && !b) body.replaceChildren(emptyState());
  }
  render();

  // a área de rolagem é a da tela inteira: ela recebe a folga do destaque e o "foco sobe até o topo"
  const view = document.getElementById('view');
  view.classList.add('stream-scroll');
  view.dataset.reveal = 'start';
  return {
    el,
    destroy() {
      hero.destroy();
      view.classList.remove('stream-scroll');
      delete view.dataset.reveal;
    },
  };
}
