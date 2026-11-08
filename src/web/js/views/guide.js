// Guia de programação: canais × horários, com a linha do "agora".
import { h, ico, img, incremental, fmtClock } from '../core/util.js';
import { C, visibleCats, visibleItems, favItems, catItems, fetchEpg, epgFor, epgState, resetEpgCache } from '../core/store.js';

const PX = 4; // pixels por minuto
const CHW = 210;

export function guideView(params, ctx) {
  ctx.setTitle('Guia');
  const cats = visibleCats('live');
  let cat = params.get('cat') || (favItems('live').length ? 'fav' : cats[0]?.id || 'all');
  const now0 = Date.now();
  const start = Math.floor(now0 / 1800000) * 1800000 - 3 * 3600000;
  const end = start + 24 * 3600000;
  const width = ((end - start) / 60000) * PX;
  let inc = null;
  let pop = null;
  let retry = null;
  const rows = new Map(); // channelId -> progs container

  const sel = h('select.input', { style: { width: '280px' } });
  const add = (id, name) => sel.append(h('option', { value: id, selected: id === cat }, name));
  add('fav', 'Favoritos');
  add('all', 'Todos os canais');
  for (const c of cats) add(c.id, `${c.name} (${c.count})`);
  sel.addEventListener('change', () => ctx.navigate(`#/guide?cat=${encodeURIComponent(sel.value)}`, { replace: true }));

  const status = h('span.muted', { style: { fontSize: '13px' } });
  const scroll = h('div.guide-scroll');
  const table = h('div.g-table', { style: { width: CHW + width + 'px' } });
  scroll.append(table);
  const root = h('div.guide',
    h('div.guide-bar', sel, h('button.btn.small', { onclick: () => scrollToNow(true) }, ico('clock'), 'Agora'), status),
    scroll);

  // linha do tempo
  const times = h('div.g-times', h('div.g-corner'));
  const tl = h('div', { style: { position: 'relative', width: width + 'px', flex: 'none' } });
  for (let t = start; t < end; t += 1800000) {
    tl.append(h('div.g-time', { style: { left: ((t - start) / 60000) * PX + 'px', width: 30 * PX + 'px' } }, fmtClock(t)));
  }
  times.append(tl);
  const nowLine = h('div.g-nowline');
  table.append(times, nowLine);

  function placeNow() {
    nowLine.style.left = CHW + ((Date.now() - start) / 60000) * PX + 'px';
  }
  placeNow();

  function scrollToNow(smooth) {
    scroll.scrollTo({ left: Math.max(0, ((Date.now() - start) / 60000) * PX - 120), behavior: smooth ? 'smooth' : 'auto' });
  }

  function closePop() {
    if (pop) pop.remove();
    pop = null;
  }

  function showPop(p, ch, x, y) {
    closePop();
    pop = h('div.popover',
      h('div.t', p[2]),
      h('div.h', `${ch.name} · ${fmtClock(p[0])} – ${fmtClock(p[1])}`),
      h('p', p[3] || 'Sem descrição.'));
    document.body.append(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(x, innerWidth - r.width - 16) + 'px';
    pop.style.top = Math.min(y + 12, innerHeight - r.height - 16) + 'px';
  }
  const onDoc = (e) => { if (pop && !pop.contains(e.target)) closePop(); };
  document.addEventListener('mousedown', onDoc);
  scroll.addEventListener('scroll', closePop);

  function paintRow(ch) {
    const box = rows.get(ch.id);
    if (!box) return;
    const progs = epgFor(ch.id);
    box.replaceChildren();
    if (!progs || !progs.length) {
      box.append(h('div.g-empty', epgState().status === 'loading' ? 'Carregando…' : 'Sem programação'));
      return;
    }
    const now = Date.now();
    for (const p of progs) {
      if (p[1] <= start || p[0] >= end) continue;
      const s = Math.max(p[0], start);
      const e = Math.min(p[1], end);
      const left = ((s - start) / 60000) * PX;
      const w = ((e - s) / 60000) * PX - 4;
      if (w < 6) continue;
      const isNow = p[0] <= now && p[1] > now;
      const el = h('div.g-prog' + (isNow ? '.now' : ''), {
        style: { left: left + 2 + 'px', width: w + 'px' },
        title: `${p[2]}\n${fmtClock(p[0])} – ${fmtClock(p[1])}`,
        onclick: (ev) => {
          if (p[0] <= Date.now() && p[1] > Date.now()) ctx.navigate(`#/live?cat=${encodeURIComponent(ch.cat)}&ch=${encodeURIComponent(ch.id)}`);
          else showPop(p, ch, ev.clientX, ev.clientY);
        },
      }, h('div.t', p[2]), w > 90 ? h('div.h', `${fmtClock(p[0])} – ${fmtClock(p[1])}`) : null);
      box.append(el);
    }
  }

  async function loadBatch(chs) {
    const st = await fetchEpg(chs);
    for (const ch of chs) paintRow(ch);
    showStatus(st);
    if (st.status === 'loading' && !retry) {
      retry = setTimeout(() => {
        retry = null;
        resetEpgCache();
        const shown = items.slice(0, inc ? inc.rendered() : 0);
        loadBatch(shown);
      }, 15000);
    }
  }

  function showStatus(st) {
    const map = {
      loading: 'Baixando o guia de programação… (listas grandes podem levar alguns minutos)',
      refreshing: 'Atualizando o guia…',
      none: 'Esta lista não tem guia. Adicione uma URL de EPG nas configurações da lista.',
      error: 'Erro ao baixar o guia: ' + (st.message || ''),
    };
    status.textContent = map[st.status] || '';
  }

  const items = cat === 'fav' ? favItems('live') : cat === 'all' ? visibleItems('live') : catItems('live', cat);
  if (!items.length) {
    table.append(h('div.empty', { style: { width: '600px' } }, cat === 'fav' ? 'Nenhum canal favorito. Escolha outra categoria.' : 'Nenhum canal.'));
  } else {
    inc = incremental(table, items, (ch) => {
      const box = h('div.g-progs', { style: { width: width + 'px' } });
      rows.set(ch.id, box);
      return h('div.g-row',
        h('div.g-ch', { onclick: () => ctx.navigate(`#/live?cat=${encodeURIComponent(ch.cat)}&ch=${encodeURIComponent(ch.id)}`), title: ch.name },
          img(ch.logo, ch.name), h('div.name', ch.name)),
        box);
    }, { root: scroll, batch: 40, onBatch: loadBatch });
  }

  requestAnimationFrame(() => scrollToNow(false));
  const timer = setInterval(placeNow, 30000);

  return {
    el: root,
    noScroll: true,
    destroy() {
      inc && inc.destroy();
      clearInterval(timer);
      clearTimeout(retry);
      closePop();
      document.removeEventListener('mousedown', onDoc);
    },
  };
}
