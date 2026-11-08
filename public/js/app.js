// IPTVKZ — casca do app: barra lateral, rotas, carregamento da lista ativa e teclado.
import { $, h, ico, debounce, toast, fmtAgo, isBack, closeTopModal } from './util.js';
import { TV, detectTv, move, DIRS, focusFirst, isNative } from './tv.js';
import { icon } from './icons.js';
import {
  S, C, api, loadState, loadCatalog, clearCatalog, catalogStatus, activeList, saveNow, save, flushSaves, setSetting,
} from './store.js';
import { liveView } from './views/live.js';
import { vodHome, movieView, serieView } from './views/vod.js';
import { guideView } from './views/guide.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';
import { openListForm, welcomeView } from './views/lists.js';
import { overlayKey, isOverlayOpen } from './views/vodplayer.js';

const view = $('#view');
const routes = {
  live: liveView,
  movies: vodHome('movies'),
  series: vodHome('series'),
  movie: movieView,
  serie: serieView,
  guide: guideView,
  search: searchView,
  settings: settingsView,
};
const NAV_OF = { movie: 'movies', serie: 'series' };

let current = null;
let appState = 'boot'; // boot | welcome | loading | error | ready
let lastError = '';
let pollTimer = null;

const ctx = {
  navigate(hash, { replace = false } = {}) {
    if (location.hash === hash) return route();
    if (replace) location.replace(hash);
    else location.hash = hash;
  },
  setTitle(t) {
    $('#pageTitle').textContent = t;
    document.title = t === 'IPTVKZ' ? t : `${t} · IPTVKZ`;
  },
  refreshNav: () => renderNav(),
  rerender: () => { current = null; route(); },
  useList,
  refreshList,
  editList: (l) => openListForm(l, onListSaved),
  addList: () => openListForm(null, onListSaved),
  deleteList,
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { name: path || 'live', params: new URLSearchParams(qs || '') };
}

// ---------- barra lateral ----------

function renderNav() {
  const { name } = parseHash();
  const active = NAV_OF[name] || name;
  const c = C();
  const count = (sec) => (c ? c[sec].items.length : 0);
  const link = (id, label, ic, n) =>
    h('a' + (active === id ? '.active' : ''), { href: `#/${id}` }, ico(ic), h('span', label),
      n ? h('span.count', n.toLocaleString('pt-BR')) : null);
  $('#nav').replaceChildren(
    link('live', 'TV ao Vivo', 'tv', count('live')),
    link('movies', 'Filmes', 'film', count('movies')),
    link('series', 'Séries', 'series', count('series')),
    link('guide', 'Guia', 'guide'),
  );
  const status = h('div.status');
  if (appState === 'loading') status.append(h('div.spinner.small'), h('span', 'Carregando lista…'));
  else if (pollTimer) status.append(h('div.spinner.small'), h('span', 'Atualizando lista…'));
  else if (c) status.append(h('span', `Lista atualizada ${fmtAgo(c.updatedAt)}`));
  $('#sideFoot').replaceChildren(link('settings', 'Configurações', 'settings'), status);
}

function renderListSwitch() {
  const box = $('#listSwitch');
  box.replaceChildren();
  if (!S.lists.length) return;
  const cur = activeList();
  const menu = h('div.list-menu.hidden');
  const btn = h('button.list-btn', { onclick: (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); } },
    ico(cur.type === 'xtream' ? 'server' : 'link'),
    h('div.meta', h('div.name', cur.name), h('div.sub', cur.type === 'xtream' ? 'Xtream Codes' : 'Lista M3U')),
    ico('chevronDown'));
  for (const l of S.lists) {
    menu.append(h('button' + (l.id === cur.id ? '.cur' : ''), { onclick: () => { menu.classList.add('hidden'); if (l.id !== cur.id) useList(l.id); } },
      l.id === cur.id ? ico('check') : h('span', { style: { width: '20px' } }), l.name));
  }
  menu.append(h('div.sep'),
    h('button', { onclick: () => { menu.classList.add('hidden'); ctx.addList(); } }, ico('plus'), 'Adicionar lista'),
    h('button', { onclick: () => { menu.classList.add('hidden'); ctx.navigate('#/settings'); } }, ico('settings'), 'Gerenciar listas'));
  box.append(btn, menu);
}

document.addEventListener('mousedown', (e) => {
  const box = $('#listSwitch');
  if (!box.contains(e.target)) box.querySelector('.list-menu')?.classList.add('hidden');
});

// ---------- rotas ----------

function unmount() {
  if (current && current.destroy) {
    try { current.destroy(); } catch (e) { console.error(e); }
  }
  current = null;
}

function showState(el, title) {
  unmount();
  view.classList.add('no-scroll');
  view.replaceChildren(el);
  if (title) ctx.setTitle(title);
}

function route() {
  const { name, params } = parseHash();
  renderNav();
  const search = $('#globalSearch');
  if (name !== 'search' && document.activeElement !== search) search.value = '';

  if (!S.lists.length && name !== 'settings') {
    appState = 'welcome';
    return showState(welcomeView(() => ctx.addList()), 'IPTVKZ');
  }
  if (appState === 'loading') return;
  if (appState === 'error' && name !== 'settings') return showError();
  if (!C() && name !== 'settings') return;

  if (current && current.name === name && current.update && current.update(params)) return;
  unmount();
  const make = routes[name] || routes.live;
  let res;
  try {
    res = make(params, ctx);
  } catch (e) {
    console.error(e);
    res = { el: h('div.center-state', h('h2', 'Algo deu errado'), h('p', e.message)) };
  }
  current = { name, ...res };
  view.classList.toggle('no-scroll', !!res.noScroll);
  view.replaceChildren(res.el);
  view.scrollTop = 0;
  if (TV.on) {
    // depois de trocar de tela, o foco vai para o conteúdo (e não fica preso na barra lateral)
    setTimeout(() => {
      const a = document.activeElement;
      const inContent = a && a !== document.body && document.contains(a) && view.contains(a);
      if (!inContent && !document.querySelector('.modal-back, .vod-overlay')) focusFirst();
    }, 30);
  }
}

function showError() {
  const list = activeList();
  showState(h('div.center-state',
    ico('alert'),
    h('h2', 'Não foi possível carregar a lista'),
    h('p', lastError),
    h('div.row', { style: { marginTop: '8px' } },
      h('button.btn.primary', { onclick: () => loadActive(true) }, ico('refresh'), 'Tentar de novo'),
      list ? h('button.btn', { onclick: () => ctx.editList(list) }, ico('edit'), 'Editar lista') : null,
      S.lists.length > 1 ? h('button.btn.ghost', { onclick: () => ctx.navigate('#/settings') }, 'Trocar de lista') : null)), 'IPTVKZ');
}

// ---------- carregamento de listas ----------

async function loadActive(force = false) {
  const list = activeList();
  if (!list) {
    clearCatalog();
    renderListSwitch();
    return route();
  }
  appState = 'loading';
  renderNav();
  showState(h('div.center-state', h('div.spinner'), h('h2', `Carregando ${list.name}`),
    h('p', force ? 'Baixando a lista de novo. Listas grandes podem levar até um minuto.' : 'Só um instante…')), 'IPTVKZ');
  try {
    const r = await loadCatalog(list.id, { force });
    appState = 'ready';
    renderListSwitch();
    current = null;
    route();
    if (r.refreshing) watchRefresh(list.id);
  } catch (e) {
    appState = 'error';
    lastError = e.message;
    renderNav();
    route();
  }
}

function watchRefresh(listId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const st = await catalogStatus(listId);
      if (st.refreshing) return;
      clearInterval(pollTimer);
      pollTimer = null;
      if (C() && C().listId === listId && st.updatedAt && st.updatedAt > C().updatedAt) {
        await loadCatalog(listId);
        const playing = isOverlayOpen() || (current && current.name === 'live' && parseHash().params.get('ch'));
        if (!playing) { current = null; route(); }
        toast('Lista atualizada', 'ok');
      }
      renderNav();
    } catch {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 8000);
  renderNav();
}

async function useList(id) {
  setSetting('activeList', id);
  await saveNow('settings').catch(() => {});
  if (location.hash.startsWith('#/settings')) {
    // continua nas configurações, mas com a nova lista
  } else history.replaceState(null, '', '#/live');
  await loadActive();
}

async function refreshList(id) {
  if (id !== activeList()?.id) {
    setSetting('activeList', id);
    await saveNow('settings').catch(() => {});
  }
  await loadActive(true);
  if (appState === 'ready') toast('Lista atualizada', 'ok');
}

// Chamado pelo formulário: salva, carrega e lança erro se falhar (o formulário mostra).
async function onListSaved(list) {
  const isNew = !C() || C().listId !== list.id;
  S.settings.activeList = list.id;
  await saveNow('settings');
  appState = 'loading';
  renderNav();
  try {
    await loadCatalog(list.id, { force: true });
  } catch (e) {
    appState = 'error';
    lastError = e.message;
    renderListSwitch();
    route();
    throw e;
  }
  appState = 'ready';
  renderListSwitch();
  current = null;
  if (isNew && !location.hash.startsWith('#/settings')) history.replaceState(null, '', '#/live');
  route();
  toast(`“${list.name}” carregada`, 'ok');
}

async function deleteList(id) {
  await api(`/api/list?list=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  S.lists = S.lists.filter((l) => l.id !== id);
  for (const k of ['favorites', 'recents', 'progress', 'catPrefs']) {
    delete S[k][id];
    save(k);
  }
  await saveNow('lists');
  const wasActive = S.settings.activeList === id || !C() || C().listId === id;
  if (wasActive) {
    S.settings.activeList = S.lists[0]?.id || null;
    await saveNow('settings');
    clearCatalog();
    renderListSwitch();
    if (S.lists.length) await loadActive();
    else { current = null; route(); }
  } else {
    current = null;
    route();
  }
  toast('Lista excluída');
}

// ---------- busca e teclado ----------

const search = $('#globalSearch');
$('.search .ico').innerHTML = icon('search');
search.addEventListener('input', debounce(() => {
  const q = search.value.trim();
  if (!q) return;
  const hash = '#/search?q=' + encodeURIComponent(q);
  ctx.navigate(hash, { replace: parseHash().name === 'search' });
}, 250));
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    search.value = '';
    search.blur();
  }
});

const TOP_LEVEL = new Set(['live', 'movies', 'series', 'guide', 'settings']);

// Voltar: menu do player > modal > filme/episódio > tela atual > página anterior (TV).
function handleBack(e) {
  if (document.fullscreenElement && e.key === 'Escape') return false; // o navegador sai da tela cheia
  const menu = document.querySelector('.pmenu:not(.hidden)');
  if (menu) {
    menu.classList.add('hidden');
    const gear = menu.parentElement.querySelector('.pbtn[title^="Áudio"]');
    if (TV.on && gear) gear.focus();
    return true;
  }
  if (closeTopModal()) return true;
  if (overlayKey({ key: 'Escape', type: 'back' })) return true;
  if (current && current.key && current.key({ key: 'Escape', type: 'back', keyCode: e.keyCode })) return true;
  if (TV.on && e.key !== 'Escape') {
    const { name, params } = parseHash();
    if (!TOP_LEVEL.has(name) || params.get('cat')) {
      history.back();
      return true;
    }
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (isBack(e) && !(typing && e.key === 'Escape')) {
    if (handleBack(e)) e.preventDefault();
    return;
  }
  if (document.querySelector('.modal-back')) {
    if (TV.on && DIRS[e.key] && !(typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      if (move(DIRS[e.key])) e.preventDefault();
    }
    return;
  }
  if (overlayKey(e)) { e.preventDefault(); return; }
  if (typing || (t && t.tagName === 'SELECT' && !TV.on)) {
    // na TV, cima/baixo saem do campo de texto
    if (TV.on && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && move(DIRS[e.key])) e.preventDefault();
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    search.focus();
    search.select();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (current && current.key && current.key(e)) { e.preventDefault(); return; }
  if (TV.on || (DIRS[e.key] && document.activeElement && document.activeElement !== document.body && !isNative(document.activeElement))) {
    if (DIRS[e.key]) {
      if (move(DIRS[e.key])) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && document.activeElement && !isNative(document.activeElement) && document.activeElement !== document.body) {
      e.preventDefault();
      document.activeElement.click();
    }
  }
});

window.addEventListener('hashchange', route);
window.addEventListener('pagehide', flushSaves);
setInterval(() => fetch('/api/ping').catch(() => {}), 60000);
setInterval(() => { if (appState === 'ready') renderNav(); }, 60000);

// ---------- início ----------

(async function boot() {
  detectTv();
  window.addEventListener('resize', () => { if (TV.on) document.documentElement.style.zoom = String(Math.max(1, Math.min(2, innerWidth / 1420)).toFixed(2)); });
  try {
    await loadState();
  } catch (e) {
    showState(h('div.center-state', h('h2', 'Servidor indisponível'), h('p', 'Abra o IPTVKZ pelo atalho da área de trabalho (ou rode “npm start”).')), 'IPTVKZ');
    return;
  }
  renderListSwitch();
  if (!S.lists.length) {
    route();
    return;
  }
  await loadActive();
})();
