// IPTVKZ — casca do app: barra lateral, rotas, carregamento da lista ativa e teclado.
import { $, h, ico, debounce, toast, fmtAgo, isBack, closeTopModal, confirmDialog, skPosters, skChannels } from './core/util.js';
import { TV, detectTv, applyTv, move, DIRS, focusFirst, focusEl, isNative, normKey, syncFocus, initKeyDebug, exitApp } from './tv/tv.js';
import { icon } from './core/icons.js';
import {
  S, C, api, favItems, laterItems, watchHistory, loadState, loadCatalog, clearCatalog, catalogStatus, activeList, saveNow, save, flushSaves, setSetting,
} from './core/store.js';
import { liveView } from './views/live.js';
import { vodHome, movieView, serieView } from './views/vod.js';
import { historyView } from './views/history.js';
import { myListView } from './views/mylist.js';
import { favoritesView } from './views/favorites.js';
import { guideView } from './views/guide.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';
import { openListForm, welcomeView } from './views/lists.js';
import { overlayKey, isOverlayOpen } from './views/vodplayer.js';
import { ensureTerms, termsAccepted } from './views/terms.js';
import { initTvKeyboard } from './tv/tvkeyboard.js';
import { initSearchBox, warmSearch } from './core/searchbox.js';

const view = $('#view');
const routes = {
  live: liveView,
  movies: vodHome('movies'),
  series: vodHome('series'),
  movie: movieView,
  serie: serieView,
  guide: guideView,
  history: historyView,
  mylist: myListView,
  favorites: favoritesView,
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
    // o nome do app já está na logo: só títulos de seção aparecem no topo
    $('#pageTitle').textContent = t === 'IPTVKZ' ? '' : t;
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
  // Sem rota definida (ao abrir o app): começa no Histórico se já houver algo assistido.
  let name = path;
  if (!name) {
    const h = C() ? watchHistory() : null;
    // sem histórico abre em Filmes (ou TV ao Vivo, se a lista não tiver filmes)
    name = h && h.inProgress.length + h.done.length ? 'history' : C() && !C().movies.items.length ? 'live' : 'movies';
  }
  return { name, params: new URLSearchParams(qs || '') };
}

// ---------- barra lateral ----------

function renderNav() {
  const { name } = parseHash();
  const active = NAV_OF[name] || name;
  const c = C();
  const count = (sec) => (c ? c[sec].items.length : 0);
  const lists = (fn, secs) => (c ? secs.reduce((n, s) => n + fn(s).length, 0) : 0);
  const history = c ? watchHistory() : { inProgress: [], done: [] };
  // recriar os links não pode tirar o foco do controle remoto
  const focused = document.activeElement;
  const refocus = focused && (focused.closest('#nav, #sideFoot')) ? focused.getAttribute('href') : null;
  const link = (id, label, ic, n) =>
    h('a' + (active === id ? '.active' : ''), { href: `#/${id}` }, ico(ic), h('span', label),
      n ? h('span.count', n.toLocaleString('pt-BR')) : null);
  $('#nav').replaceChildren(
    link('history', 'Histórico', 'history', history.inProgress.length + history.done.length),
    link('live', 'TV ao Vivo', 'tv', count('live')),
    link('movies', 'Filmes', 'film', count('movies')),
    link('series', 'Séries', 'series', count('series')),
    link('guide', 'Guia', 'guide'),
    link('mylist', 'Minha lista', 'mylist', lists(laterItems, ['movies', 'series'])),
    link('favorites', 'Favoritos', 'star', lists(favItems, ['live', 'movies', 'series'])),
  );
  const status = h('div.status');
  if (appState === 'loading') status.append(h('div.spinner.small'), h('span', 'Carregando lista…'));
  else if (pollTimer) status.append(h('div.spinner.small'), h('span', 'Atualizando lista…'));
  else if (c) status.append(h('span', `Lista atualizada ${fmtAgo(c.updatedAt)}`));
  $('#sideFoot').replaceChildren(link('settings', 'Configurações', 'settings'), status);
  if (refocus) {
    const again = document.querySelector(`#nav a[href="${refocus}"], #sideFoot a[href="${refocus}"]`);
    if (again) again.focus({ preventScroll: true });
  }
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
  if (popOpen && !$('#listStatus').contains(e.target)) setPop(false);
  const box = $('#listSwitch');
  if (!box.contains(e.target)) box.querySelector('.list-menu')?.classList.add('hidden');
});

// ---------- status da lista (bolinha verde/vermelha) ----------

const STATUS_EVERY = 2 * 60 * 1000; // lista
const NET_EVERY = 15 * 1000; // internet
const STATUS_INFO = {
  active: ['ok', 'Ativa'],
  expiring: ['warn', 'Vence em breve'],
  expired: ['bad', 'Lista expirada'],
  banned: ['bad', 'Conta bloqueada'],
  disabled: ['bad', 'Conta desativada'],
  refused: ['bad', 'Acesso recusado'],
  offline: ['warn', 'Lista fora do ar'],
  local: ['idle', 'Arquivo local'],
  unknown: ['idle', 'Lista não verificada'],
};
const STATUS_DETAIL = {
  expired: 'A assinatura desta lista venceu. Renove com o seu provedor.',
  banned: 'O provedor bloqueou esta conta.',
  disabled: 'O provedor desativou esta conta.',
  refused: 'O servidor recusou o acesso: a lista pode ter expirado ou o usuário e a senha mudaram.',
  offline: 'O servidor da lista não respondeu. Pode ser temporário.',
  unknown: 'Sem conexão no momento: a lista será verificada quando a conexão voltar.',
  local: 'Lista de arquivo: não dá para saber se os links ainda funcionam.',
};

let status = { listId: null, data: null, checking: false, at: 0 };
let net = { state: 'checking', ms: null, at: 0 };
let netPromise = null;
const fmtDate = (ms) => new Date(ms).toLocaleDateString('pt-BR');

// Tudo certo = só um ponto discreto no topo. Problema = o ponto ganha texto e aparece um
// aviso fixo, que fica enquanto o problema existir. Os detalhes ficam no painel do ponto.
let popOpen = false;
let lastSig = '';
let bannerKey = '';
let dismissedBanner = '';

function isPlaying() {
  return isOverlayOpen() || (current && current.name === 'live' && !!parseHash().params.get('ch'));
}

function statusModel() {
  const n = {
    checking: { tone: 'idle', label: 'Verificando…', detail: '' },
    online: { tone: 'ok', label: 'Conectada', detail: net.ms != null ? `${net.ms} ms` : '' },
    offline: { tone: 'bad', label: 'Sem internet', detail: 'Confira o Wi-Fi ou o cabo do computador.' },
    noserver: { tone: 'bad', label: 'Sem conexão', detail: 'Este aparelho não está falando com o computador do IPTVKZ.' },
  }[net.state];
  let list = null;
  const al = activeList();
  if (al) {
    const d = status.data;
    const [tone, label] = !d ? ['idle', 'Verificando…'] : STATUS_INFO[d.state] || ['idle', 'Desconhecido'];
    let sub = '';
    if (d && d.expires) {
      const days = Math.ceil((d.expires - Date.now()) / 86400000);
      sub = d.state === 'expiring' ? (days <= 1 ? 'vence hoje' : `em ${days} dias`) : d.state === 'expired' ? `em ${fmtDate(d.expires)}` : `até ${fmtDate(d.expires)}`;
    }
    list = {
      tone, label, sub, name: al.name, state: d ? d.state : null,
      detail: (d && STATUS_DETAIL[d.state]) || '',
      cons: d && d.maxCons ? `${d.activeCons || 0} de ${d.maxCons} conexões em uso` : '',
    };
  }
  const netBad = n.tone === 'bad';
  const listLoud = list && (list.tone === 'bad' || list.tone === 'warn');
  const pill = netBad ? n : listLoud ? list : null;
  const allGood = n.tone === 'ok' && (!list || list.tone === 'ok' || list.state === 'local');
  const tone = pill ? pill.tone : allGood ? 'ok' : 'idle';
  return { net: n, list, tone, loud: !!pill, text: pill ? pill.label : allGood ? 'Conectado' : 'Verificando…' };
}

function verifyNow() {
  if (status.checking) return;
  checkNet().then(() => checkListStatus());
}

function setPop(open) {
  popOpen = open;
  renderListStatus();
  const box = $('#listStatus');
  if (TV.on) setTimeout(() => focusEl(box.querySelector(open ? '.status-refresh' : '.status-pill')), 30);
}

function statusLine(tone, title, label, sub, details) {
  return h('div.status-line', h('span.status-dot.' + tone),
    h('div.status-body',
      h('div.status-name', title),
      h('div.status-value', label, sub ? ` ${sub}` : ''),
      details.filter(Boolean).map((t) => h('div.status-note', t))));
}

function renderListStatus() {
  const box = $('#listStatus');
  const m = statusModel();
  const sig = JSON.stringify([m, popOpen]);
  if (sig !== lastSig) {
    lastSig = sig;
    // reconstrói sem tirar o foco do controle remoto
    const a = document.activeElement;
    const focus = box.contains(a) ? a.dataset.sf : null;
    const pill = h('button.status-pill.' + m.tone + (m.loud ? '.loud' : ''), {
      'data-sf': 'pill', title: 'Status da internet e da lista', 'aria-label': `Status: ${m.text}`, 'aria-expanded': String(popOpen),
      onclick: () => setPop(!popOpen),
    }, h('span.status-dot.' + m.tone), h('span', m.text));
    const pop = popOpen ? h('div.status-pop',
      statusLine(m.net.tone, 'Internet', m.net.label, '', [m.net.detail]),
      m.list ? statusLine(m.list.tone, m.list.name, m.list.label, m.list.sub, [m.list.detail, m.list.cons]) : null,
      h('div.status-foot', h('span.status-when'),
        h('button.btn.small.status-refresh', { 'data-sf': 'refresh', onclick: verifyNow }, ico('refresh'), h('span.status-refresh-label', 'Verificar agora')))) : null;
    box.replaceChildren(pill, pop);
    if (focus) { const el = box.querySelector(`[data-sf="${focus}"]`); if (el) el.focus({ preventScroll: true }); }
  }
  const refresh = box.querySelector('.status-refresh');
  if (refresh) {
    refresh.classList.toggle('spin', status.checking);
    refresh.querySelector('.status-refresh-label').textContent = status.checking ? 'Verificando…' : 'Verificar agora';
    box.querySelector('.status-when').textContent = status.at
      ? `Verificado às ${new Date(status.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
  }
  renderBanner(m);
}

function bannerModel(m) {
  if (net.state === 'noserver' || net.state === 'offline') {
    return {
      key: 'net:' + net.state, tone: 'bad',
      text: net.state === 'offline' ? 'Sem conexão com a internet. Os canais voltam quando a conexão retornar.' : 'Sem conexão com o computador do IPTVKZ. Confira se ele está ligado e na mesma rede.',
    };
  }
  if (!m.list || !m.list.state || !(m.list.tone === 'bad' || m.list.tone === 'warn')) return null;
  const text = m.list.state === 'expiring' ? `“${m.list.name}” vence ${/^em /.test(m.list.sub) ? m.list.sub : 'hoje'}. Renove com o seu provedor para não ficar sem canais.` : `“${m.list.name}”: ${m.list.detail}`;
  return { key: `${status.listId}:${m.list.state}`, tone: m.list.tone, text, list: true };
}

function renderBanner(m) {
  const box = $('#statusBanner');
  const b = bannerModel(m);
  const key = b && b.key !== dismissedBanner ? b.key : '';
  if (key === bannerKey) return;
  bannerKey = key;
  if (!key) return box.replaceChildren();
  box.replaceChildren(h('div.status-banner.' + b.tone, { role: 'status' },
    ico('alert'),
    h('span.status-banner-text', b.text),
    b.list ? h('button.btn.small', { onclick: () => ctx.editList(activeList()) }, 'Editar lista') : null,
    h('button.btn.small.ghost', { onclick: verifyNow }, 'Verificar de novo'),
    h('button.icon-btn', { title: 'Dispensar', 'aria-label': 'Dispensar aviso', onclick: () => { dismissedBanner = b.key; renderBanner(statusModel()); } }, ico('close'))));
}

function checkNet() {
  if (netPromise) return netPromise;
  netPromise = (async () => {
    const prev = net.state;
    let state;
    let ms = null;
    try {
      const r = await api('/api/net');
      state = r.online ? 'online' : 'offline';
      ms = r.ms ?? null;
    } catch {
      state = 'noserver';
    }
    net = { state, ms, at: Date.now() };
    renderListStatus();
    if (prev !== state && prev !== 'checking') {
      if (state === 'online') {
        toast('Conexão restabelecida', 'ok');
        checkListStatus();
      } else if (isPlaying()) {
        toast(state === 'offline' ? 'Sem conexão com a internet' : 'Perdeu a conexão com o computador do IPTVKZ', 'error', 6000);
      }
    }
  })().finally(() => { netPromise = null; });
  return netPromise;
}

async function checkListStatus() {
  const list = activeList();
  if (!list) { status = { listId: null, data: null, checking: false, at: 0 }; return renderListStatus(); }
  if (status.listId !== list.id) status = { listId: list.id, data: null, checking: false, at: 0 };
  else if (status.checking) return;
  const prev = status.data && status.data.state;
  status.checking = true;
  renderListStatus();
  if (netPromise) await netPromise;
  let data;
  if (net.state !== 'online' && net.state !== 'checking') {
    // sem internet não dá para concluir nada sobre a lista
    data = { state: 'unknown', checkedAt: Date.now() };
  } else {
    try {
      data = await api(`/api/list-status?list=${encodeURIComponent(list.id)}`);
    } catch {
      data = { state: 'unknown', checkedAt: Date.now() };
    }
  }
  if (status.listId !== list.id) return; // trocou de lista enquanto verificava
  status.data = data;
  status.checking = false;
  status.at = Date.now();
  renderListStatus();
  const [tone] = STATUS_INFO[data.state] || ['idle'];
  if (tone === 'bad' && prev !== data.state && isPlaying()) toast(`${list.name}: ${STATUS_DETAIL[data.state]}`, 'error', 9000);
}

// Ao voltar para o app, atualiza na hora (sem repetir se acabou de verificar).
function refreshIfStale() {
  if (document.hidden) return;
  if (Date.now() - net.at > 5000) checkNet();
  if (S.lists.length && Date.now() - status.at > 30000) checkListStatus();
}

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

// ---------- TV: ao voltar, o foco reaparece no item de onde se saiu ----------
const FOCUS_ITEM = '.poster, .ch-card, .ep, .g-ch';
const SCROLLER = '.vod-content, .ch-scroll';
const focusMemory = new Map(); // hash -> item que estava em foco
let restoreNext = false;
let routeHash = location.hash;

function rememberFocus() {
  const a = document.activeElement;
  const item = a && a.closest && view.contains(a) && a.closest(FOCUS_ITEM);
  if (!item) return;
  const box = item.closest(SCROLLER);
  focusMemory.set(routeHash, { title: item.title, sel: SCROLLER, top: box ? box.scrollTop : 0, y: item.getBoundingClientRect().top });
}

// A lista recarrega aos poucos: rola até onde estava e espera o item aparecer.
function restoreFocus(mem, tries = 24) {
  const box = view.querySelector(mem.sel);
  if (box) box.scrollTop = mem.top;
  const near = (el) => Math.abs(el.getBoundingClientRect().top - mem.y);
  const found = [...view.querySelectorAll(FOCUS_ITEM)].filter((el) => el.title === mem.title).sort((p, q) => near(p) - near(q))[0];
  if (found) return focusEl(found);
  if (tries > 0) setTimeout(() => restoreFocus(mem, tries - 1), 100);
  else focusFirst();
}

function route() {
  const { name, params } = parseHash();
  if (TV.on) rememberFocus();
  routeHash = location.hash;
  const goingBack = restoreNext;
  restoreNext = false;
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
      const mem = goingBack && focusMemory.get(location.hash);
      if (mem) return restoreFocus(mem);
      const a = document.activeElement;
      if (a && a.dataset && a.dataset.native) return; // teclado da TV aberto: o foco não pode sair do campo
      const inContent = a && a !== document.body && document.contains(a) && view.contains(a);
      if (!inContent && !document.querySelector('.modal-back, .vod-overlay, .tvkb')) focusFirst();
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
  checkListStatus();
  if (!list) {
    clearCatalog();
    renderListSwitch();
    return route();
  }
  appState = 'loading';
  renderNav();
  const posters = ['movies', 'series', 'mylist', 'favorites', 'history'].includes(parseHash().name);
  showState(h('div.page.sk-page',
    h('div.sk-status', h('div.spinner.small'), h('span', `Carregando ${list.name}…`),
      force ? h('span.faint', 'Listas grandes podem levar até um minuto.') : null),
    posters ? h('div.poster-grid', skPosters(18)) : h('div.ch-grid', skChannels(24))), 'IPTVKZ');
  try {
    const r = await loadCatalog(list.id, { force });
    appState = 'ready';
    warmSearch();
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
        warmSearch();
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

// Chamado pelo formulário depois de salvar: torna a lista ativa e carrega (com a tela de progresso).
async function onListSaved(list) {
  const isNew = !C() || C().listId !== list.id;
  S.settings.activeList = list.id;
  await saveNow('settings').catch(() => {});
  renderListSwitch();
  if (isNew && !location.hash.startsWith('#/settings')) history.replaceState(null, '', '#/live');
  await loadActive(true);
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
initSearchBox(search, ctx, debounce);
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    search.value = '';
    search.blur();
  }
});

const TOP_LEVEL = new Set(['live', 'movies', 'series', 'guide', 'mylist', 'favorites', 'history', 'settings']);

// Voltar: menu do player > modal > filme/episódio > tela atual > página anterior (TV).
function handleBack(e) {
  if (popOpen) {
    setPop(false);
    return true;
  }
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
    // Sempre da direita para a esquerda: detalhe > listagem > categorias > menu > sair.
    if (!TOP_LEVEL.has(parseHash().name)) {
      restoreNext = true;
      history.back();
      return true;
    }
    const a = document.activeElement;
    if (!a || !a.closest('.sidebar')) {
      const inCats = a && a.closest('.cats');
      focusEl((!inCats && view.querySelector('.cats .cat-item.on')) || $('#nav a.active') || $('#nav a'));
      return true;
    }
    // sem para onde voltar: pergunta antes de sair
    confirmDialog('Sair do IPTVKZ?', 'O aplicativo será fechado nesta TV.', 'Sair').then((yes) => { if (yes) exitApp(); });
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  const ev = { key: normKey(e), keyCode: e.keyCode, type: e.type };
  const t = e.target;
  if (TV.on) setTimeout(() => syncFocus(), 0);
  if (TV.on && !document.hasFocus()) window.focus();
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (isBack(e) && !(typing && ev.key === 'Escape')) {
    if (handleBack(e)) e.preventDefault();
    return;
  }
  if (document.querySelector('.modal-back')) {
    if (TV.on && DIRS[ev.key] && !(typing && !t.readOnly && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'))) {
      if (move(DIRS[ev.key])) e.preventDefault();
    }
    if (TV.on && ev.key === 'Enter' && document.activeElement && !typing && document.activeElement.tagName === 'BUTTON') {
      e.preventDefault();
      document.activeElement.click();
    }
    return;
  }
  if (overlayKey(ev)) { e.preventDefault(); return; }
  if (typing || (t && t.tagName === 'SELECT' && !TV.on)) {
    // na TV, as setas saem do campo de texto (←/→ só se ele não estiver editável)
    if (TV.on && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || (DIRS[ev.key] && t.readOnly)) && move(DIRS[ev.key])) e.preventDefault();
    return;
  }
  if (ev.key === '/') {
    e.preventDefault();
    search.focus();
    search.select();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (current && current.key && current.key(ev)) { e.preventDefault(); return; }
  if (TV.on || (DIRS[ev.key] && document.activeElement && document.activeElement !== document.body && !isNative(document.activeElement))) {
    if (DIRS[ev.key]) {
      if (move(DIRS[ev.key])) e.preventDefault();
      return;
    }
    if (ev.key === 'Enter' && document.activeElement && document.activeElement !== document.body && (TV.on ? !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) : !isNative(document.activeElement))) {
      e.preventDefault();
      document.activeElement.click();
    }
  }
});

window.addEventListener('hashchange', route);
window.addEventListener('iptvkz:counts', debounce(() => renderNav(), 200));
window.addEventListener('pagehide', flushSaves);
setInterval(() => fetch('/api/ping').catch(() => {}), 60000);
setInterval(() => { if (S.lists.length && !document.hidden) checkListStatus(); }, STATUS_EVERY);
setInterval(() => { if (!document.hidden) checkNet(); }, NET_EVERY);
window.addEventListener('focus', refreshIfStale);
document.addEventListener('visibilitychange', refreshIfStale);
window.addEventListener('online', () => checkNet());
window.addEventListener('offline', () => checkNet());
setInterval(() => { if (appState === 'ready') renderNav(); }, 60000);

// ---------- início ----------

// Splash: fica no mínimo o tempo de ser vista e nunca prende o app por muito tempo.
const SPLASH_MIN = 1400;
const splashStart = Date.now();
function hideSplash() {
  const el = $('#splash');
  if (!el || el.classList.contains('out') || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  let done = false;
  const fade = () => {
    if (done) return;
    done = true;
    el.classList.add('out');
    if (TV.on) {
      // o navegador da TV começa com o foco nele mesmo: pede o foco para a página
      window.focus();
      if (!document.activeElement || document.activeElement === document.body) focusFirst();
    }
    setTimeout(() => el.remove(), 800);
  };
  // Espera a tela montar: em TVs, começar o fade com o processador ocupado faz ele nem aparecer.
  const settle = Math.max(TV.on ? 500 : 0, SPLASH_MIN - (Date.now() - splashStart));
  setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(fade));
    setTimeout(fade, 400); // se a janela estiver em segundo plano
  }, settle);
}

(async function boot() {
  setTimeout(hideSplash, 15000);
  detectTv();
  initKeyDebug();
  document.addEventListener('focusin', () => { if (TV.on) syncFocus(); });
  initTvKeyboard();
  window.addEventListener('resize', applyTv);
  try {
    await loadState();
  } catch (e) {
    showState(h('div.center-state', h('h2', 'Servidor indisponível'), h('p', 'Abra o IPTVKZ pelo atalho da área de trabalho (ou rode “npm start”).')), 'IPTVKZ');
    hideSplash();
    return;
  }
  if (!termsAccepted()) hideSplash(); // os termos precisam aparecer
  await ensureTerms();
  checkNet();
  renderListSwitch();
  if (!S.lists.length) {
    route();
    hideSplash();
    return;
  }
  await loadActive();
  hideSplash();
})();
