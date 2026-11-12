// IPTVKZ — casca do app: barra lateral, rotas, carregamento da lista ativa e teclado.
import { $, h, ico, debounce, toast, fmtAgo, isBack, closeTopModal, confirmDialog, skPosters, skChannels, settleImages } from './core/util.js';
import { applyDebug, debugSection, tone } from './core/debug.js';
import { TV, KB, setKbNav, detectTv, applyTv, move, DIRS, focusFirst, focusEl, isNative, normKey, syncFocus, initKeyDebug, exitApp } from './tv/tv.js';
import { icon } from './core/icons.js';
import {
  S, C, api, favItems, laterItems, watchHistory, loadState, loadCatalog, clearCatalog, catalogStatus, activeList, saveNow, save, flushSaves, setSetting, buildLabel,
} from './core/store.js';
import { liveView } from './views/live.js';
import { vodHome, movieView, serieView } from './views/vod.js';
import { historyView } from './views/history.js';
import { myListView } from './views/mylist.js';
import { favoritesView } from './views/favorites.js';
import { startLifeline } from './core/lifeline.js';
import { guideView } from './views/guide.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';
import { openListForm, openListPhone, welcomeView } from './views/lists.js';
import { overlayKey, isOverlayOpen } from './views/vodplayer.js';
import { ensureTerms, termsAccepted } from './views/terms.js';
import { initTvKeyboard } from './tv/tvkeyboard.js';
import { initSmoothScroll } from './core/smoothscroll.js';
import { VIEW_MODES, viewMode, setViewMode, applyViewMode } from './core/viewmode.js';
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
  // o mesmo que a tecla Voltar: volta uma tela e devolve o foco ao item de onde se saiu
  back(fallback) {
    if (history.length > 1) {
      restoreNext = true;
      history.back();
    } else location.hash = fallback;
  },
  useList,
  refreshList,
  editList: (l) => openListForm(l, onListSaved, deleteList),
  phoneEdit: (l) => openListPhone(l, { onSaved: onListSaved, onRefresh: refreshList, onDelete: deleteList }),
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
  if (appState === 'loading') status.append(h('div.spinner.small'), h('span', 'Carregando lista...'));
  else if (pollTimer) status.append(h('div.spinner.small'), h('span', 'Atualizando lista...'));
  else if (c) status.append(h('span', `Lista atualizada ${fmtAgo(c.updatedAt)}`));
  // versão, build e modo no rodapé (o completo, com commit e data, fica em Configurações → Sobre)
  const b = buildLabel();
  const ver = h('div.build-tag', { title: `${b.mode}${b.detail ? ' · ' + b.detail : ''}` },
    h('span', b.short), h('span.build-mode' + (b.dev ? '.dev' : ''), b.dev ? 'Beta' : 'Prod'));
  $('#sideFoot').replaceChildren(link('settings', 'Configurações', 'settings'), status, ver);
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
  const btn = h('button.list-btn', {
    onclick: (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
      if (TV.on && !menu.classList.contains('hidden')) focusEl(menu.querySelector('.cur') || menu.querySelector('button'));
    },
  },
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

const SLOW_NET_MS = 1500; // a TV mede mais devagar que o PC; abaixo disso os vídeos rodam normal

function statusModel() {
  const n = {
    checking: { tone: 'idle', label: 'Verificando...', detail: '' },
    online: { tone: 'ok', label: 'Conectada', detail: net.ms != null ? `${net.ms} ms` : '' },
    offline: { tone: 'bad', label: 'Sem internet', detail: 'Confira o Wi-Fi ou o cabo do computador.' },
    noserver: { tone: 'bad', label: 'Sem conexão', detail: 'Este aparelho não está falando com o computador do IPTVKZ.' },
  }[net.state];
  // Conectado, mas demorando a responder (o teste é um pedido pequeno: normal fica bem abaixo de 300 ms).
  // Aí os vídeos demoram e travam por causa da internet, não do app: a bolinha avisa em amarelo.
  if (net.state === 'online' && net.ms > SLOW_NET_MS) {
    Object.assign(n, { tone: 'warn', label: 'Internet lenta', detail: `${net.ms} ms para responder. Vídeos podem demorar a abrir ou travar.` });
  }
  let list = null;
  const al = activeList();
  if (al) {
    const d = status.data;
    const [tone, label] = !d ? ['idle', 'Verificando...'] : STATUS_INFO[d.state] || ['idle', 'Desconhecido'];
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
  const netBad = n.tone === 'bad' || n.tone === 'warn';
  const listLoud = list && (list.tone === 'bad' || list.tone === 'warn');
  const pill = netBad ? n : listLoud ? list : null;
  const allGood = n.tone === 'ok' && (!list || list.tone === 'ok' || list.state === 'local');
  const tone = pill ? pill.tone : allGood ? 'ok' : 'idle';
  return { net: n, list, tone, loud: !!pill, text: pill ? pill.label : allGood ? 'Conectado' : 'Verificando...' };
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
    refresh.querySelector('.status-refresh-label').textContent = status.checking ? 'Verificando...' : 'Verificar agora';
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
  if (data.state === 'offline' && net.state === 'online') suggestServer(list);
}

// Servidor em uso fora do ar, com internet funcionando: testa os outros servidores da mesma conta e sugere
// trocar para o mais rápido que responder. Sem internet não sugere (o problema é outro). Uma vez por servidor
// a cada sessão, para não insistir.
const suggested = new Set();
async function suggestServer(list) {
  if (list.type !== 'xtream' || !(list.servers || []).length) return;
  const key = `${list.id}|${list.server}`;
  if (suggested.has(key)) return;
  suggested.add(key);
  let r;
  try {
    r = await api('/api/list-speed', { method: 'POST', body: JSON.stringify({ id: list.id, server: list.server, servers: list.servers, username: list.username }) });
  } catch { return; }
  const ok = r.results.filter((x, i) => i > 0 && x.ms != null).sort((a, b) => a.ms - b.ms)[0];
  if (!ok || r.results[0].ms != null) return; // nenhum outro responde, ou o em uso voltou
  const short = (s) => String(s).replace(/^https?:\/\//, '');
  toast(`O servidor ${short(list.server)} não está respondendo. ${short(ok.server)} está funcionando.`, 'error', 15000, {
    label: 'Usar este',
    fn: async () => {
      const i = S.lists.findIndex((l) => l.id === list.id);
      if (i < 0) return;
      const old = S.lists[i];
      S.lists[i] = { ...old, server: ok.server, servers: [old.server, ...(old.servers || []).filter((s) => s !== ok.server)] };
      await saveNow('lists');
      toast(`Usando ${short(ok.server)}`, 'ok');
      refreshList(list.id);
    },
  });
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

// ---------- ao voltar: a tela reaparece onde estava, com o mesmo item selecionado (PC, TV e celular) ----------
const FOCUS_ITEM = '.poster, .ch-card, .ep, .g-ch';
const SCROLLER = '.vod-content, .ch-scroll';
const focusMemory = new Map(); // hash -> item selecionado e posições de rolagem
let restoreNext = false;
let routeHash = location.hash;
// No PC o clique não dá foco ao card: guarda o último card clicado/tocado para lembrar dele ao sair da tela.
let lastPicked = null;
view.addEventListener('click', (e) => {
  const it = e.target.closest && e.target.closest(FOCUS_ITEM);
  if (it) lastPicked = it;
}, true);

const shelfName = (el) => {
  const s = el.closest('.shelf');
  const t = s && s.querySelector('h3');
  return t ? t.textContent : null;
};

function rememberFocus() {
  const a = document.activeElement;
  let item = a && a.closest && view.contains(a) && a.closest(FOCUS_ITEM);
  if (!item && lastPicked && view.contains(lastPicked)) item = lastPicked;
  lastPicked = null;
  if (!item) return;
  const box = item.closest(SCROLLER);
  const row = item.closest('.shelf-row');
  focusMemory.set(routeHash, {
    title: item.title,
    sel: box ? (box.matches('.vod-content') ? '.vod-content' : '.ch-scroll') : null, // null: rola a tela inteira
    top: box ? box.scrollTop : view.scrollTop,
    y: item.getBoundingClientRect().top,
    rowLeft: row ? row.scrollLeft : null, // posição dentro da fileira
    shelf: shelfName(item), // o mesmo filme pode estar em duas fileiras: volta na de onde saiu
  });
}

// A lista recarrega aos poucos: rola até onde estava e espera o item aparecer.
function restoreFocus(mem, tries = 24) {
  const box = mem.sel ? view.querySelector(mem.sel) : view;
  if (box) box.scrollTop = mem.top;
  const near = (el) => Math.abs(el.getBoundingClientRect().top - mem.y);
  let cands = [...view.querySelectorAll(FOCUS_ITEM)].filter((el) => el.title === mem.title);
  const same = mem.shelf ? cands.filter((el) => shelfName(el) === mem.shelf) : [];
  if (same.length) cands = same;
  const found = cands.sort((p, q) => near(p) - near(q))[0];
  if (found) {
    const row = found.closest('.shelf-row');
    if (row && mem.rowLeft != null) row.scrollLeft = mem.rowLeft;
    if (box) box.scrollTop = mem.top; // as fileiras que encheram enquanto isso podem ter mexido na altura
    if (TV.on || KB.on) return focusEl(found);
    // mouse/toque: seleciona sem rolar nada, para a tela ficar exatamente como estava
    if (!found.hasAttribute('tabindex')) found.tabIndex = -1;
    found.focus({ preventScroll: true });
    return;
  }
  if (tries > 0) setTimeout(() => restoreFocus(mem, tries - 1), 100);
  else if (TV.on || KB.on) focusFirst();
}

function route() {
  const { name, params } = parseHash();
  rememberFocus();
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
  // A lista carregando não prende o app: Configurações continua aberta para trocar ou excluir.
  if (appState === 'loading' && name !== 'settings') {
    if (current && showLoading) showLoading();
    return;
  }
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
  // volta ao topo antes de trocar o conteúdo: depois, ler/mudar a rolagem obrigaria a TV a calcular o layout
  // da tela nova na hora (era ~80 ms na LG)
  if (view.scrollTop) view.scrollTop = 0;
  if (TV.on) settleImages(350);
  view.replaceChildren(res.el);
  // voltando: a tela reaparece onde estava, em qualquer plataforma
  const mem = goingBack && focusMemory.get(location.hash);
  if (mem) setTimeout(() => restoreFocus(mem), 30);
  else if (TV.on) {
    // depois de trocar de tela, o foco vai para o conteúdo (e não fica preso na barra lateral)
    setTimeout(() => {
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

let loadToken = 0;
let showLoading = null;

let lastLoad = null; // quanto a lista levou para carregar (modo de depuração)

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
  const token = ++loadToken;
  showLoading = () => {
    const posters = ['movies', 'series', 'mylist', 'favorites', 'history'].includes(parseHash().name);
    showState(h('div.page.sk-page',
      h('div.sk-status', h('div.spinner.small'), h('span', `Carregando ${list.name}...`),
        force ? h('span.faint', 'Listas grandes podem levar até um minuto.') : null),
      posters ? h('div.poster-grid', skPosters(18)) : h('div.ch-grid', skChannels(24))), 'IPTVKZ');
  };
  if (parseHash().name === 'settings') route();
  else showLoading();
  try {
    const t0 = performance.now();
    const r = await loadCatalog(list.id, { force });
    lastLoad = { ms: Math.round(performance.now() - t0), at: Date.now() };
    if (token !== loadToken) return; // trocou ou excluiu a lista enquanto carregava
    appState = 'ready';
    warmSearch();
    renderListSwitch();
    if (current && current.name === 'settings') renderNav(); // quem está em Configurações não perde o lugar
    else { current = null; route(); }
    if (r.refreshing) watchRefresh(list.id);
  } catch (e) {
    if (token !== loadToken) return;
    appState = 'error';
    lastError = e.message;
    renderNav();
    if (!current || current.name !== 'settings') route();
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

// Seletor de visualização ao lado da busca (Clássica / Streaming). Botões comuns: clique, toque ou OK do controle.
function renderViewSwitch() {
  const mode = viewMode();
  const box = $('#viewSwitch');
  if (!box) return; // index.html antigo em cache: sem seletor, mas o app abre normal
  box.replaceChildren(...VIEW_MODES.map((m) =>
    h('button.vs-btn' + (m.id === mode ? '.on' : ''), {
      type: 'button', title: m.label, 'aria-label': m.label, role: 'radio', 'aria-checked': String(m.id === mode),
      onclick: () => setViewMode(m.id),
    }, ico(m.icon))));
}
applyViewMode();
renderViewSwitch();
window.addEventListener('iptvkz:view', () => {
  renderViewSwitch();
  const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest('#viewSwitch');
  unmount();
  route();
  // quem trocou pelo controle continua no seletor, no botão escolhido
  if (keep && (TV.on || KB.on)) setTimeout(() => focusEl($('#viewSwitch .vs-btn.on')), 60); // depois do foco automático da rota (30ms)
});
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
  const listMenu = $('#listSwitch .list-menu:not(.hidden)');
  if (listMenu) {
    listMenu.classList.add('hidden');
    if (TV.on) focusEl($('#listSwitch .list-btn'));
    return true;
  }
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
    confirmDialog('Sair do IPTVKZ?', 'O aplicativo será fechado nesta TV.', 'Sair').then((yes) => { if (yes) { flushSaves(); exitApp(); } });
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  const ev = { key: normKey(e), keyCode: e.keyCode, type: e.type };
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  // PC: setas (fora de campos) ou Tab ligam o modo teclado, igual ao controle da TV
  if (!e.ctrlKey && !e.altKey && !e.metaKey && (ev.key === 'Tab' || (DIRS[ev.key] && !typing))) setKbNav(true);
  if (TV.on || KB.on) setTimeout(() => syncFocus(), 0);
  if (TV.on && !document.hasFocus()) window.focus();
  if (isBack(e) && !(typing && ev.key === 'Escape')) {
    if (handleBack(e)) e.preventDefault();
    return;
  }
  if (document.querySelector('.modal-back')) {
    if ((TV.on || (KB.on && !typing)) && DIRS[ev.key] && !(typing && !t.readOnly && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'))) {
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
  if (TV.on || KB.on) {
    if (DIRS[ev.key]) {
      // nada focado ainda (PC): a primeira seta começa no primeiro cartão visível
      if (!document.activeElement || document.activeElement === document.body) { e.preventDefault(); focusFirst(); return; }
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
startLifeline();
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

// Abertura sem internet: tela no estilo da de boas-vindas, que tenta de novo sozinha (a cada 5 s e quando o
// sistema avisa que a rede voltou). Servidor sem resposta não conta como sem internet: esse erro tem tela própria.
async function hasInternet() {
  try {
    return (await api('/api/net')).online !== false;
  } catch {
    return true;
  }
}

async function waitForInternet() {
  if (await hasInternet()) return;
  await new Promise((resolve) => {
    let timer = null;
    let busy = false;
    const note = h('p.faint', 'Tentando de novo a cada 5 segundos.');
    const btn = h('button.btn.primary.big', { style: { marginTop: '10px' }, onclick: () => tryAgain() }, ico('refresh'), 'Tentar de novo');
    const done = () => {
      clearInterval(timer);
      window.removeEventListener('online', tryAgain);
      resolve();
    };
    async function tryAgain() {
      if (busy) return;
      busy = true;
      note.textContent = 'Verificando a conexão...';
      const ok = await hasInternet();
      busy = false;
      if (ok) return done();
      note.textContent = 'Ainda sem internet. Tentando de novo a cada 5 segundos.';
    }
    showState(h('div.center-state.welcome.offline',
      h('img.logo-big', { src: '/img/icon-256.webp', alt: '' }),
      h('h2', 'Sem internet'),
      h('p', 'O IPTVKZ precisa de internet para carregar a lista e os vídeos. Confira o Wi-Fi ou o cabo do aparelho; o app continua assim que a conexão voltar.'),
      btn, note), 'IPTVKZ');
    hideSplash();
    if (TV.on || KB.on) setTimeout(() => focusEl(btn), 30);
    timer = setInterval(tryAgain, 5000);
    window.addEventListener('online', tryAgain);
  });
}

// Modo de depuração: o que importa na tela atual (lista, catálogo, quanto há desenhado)
debugSection('app', () => {
  const c = C();
  const rows = [];
  const route = parseHash().name;
  if (c) {
    const n = (x) => x.toLocaleString('pt-BR');
    rows.push(['Lista', `${(activeList() || {}).name || '—'} · ${n(c.live.items.length)} canais · ${n(c.movies.items.length)} filmes · ${n(c.series.items.length)} séries`, '',
      lastLoad ? `carregou em ${n(lastLoad.ms)} ms` : '', tone(lastLoad && lastLoad.ms, 3000, 10000)]);
    // última vez que a lista veio do provedor: quanto levou o download e qual pedido foi o mais lento
    const t = c.timing;
    if (t && t.download != null) {
      const sec = (ms) => `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
      const slow = Object.entries(t).filter(([k, v]) => typeof v === 'number' && !['total', 'download', 'login'].includes(k)).sort((a, b) => b[1] - a[1])[0];
      rows.push(['Baixar lista', `${sec(t.download)} do provedor${t.parallel ? '' : ' (pouca memória: em partes)'}`, tone(t.download, 8000, 25000),
        slow ? `mais lento: ${slow[0].replace(/_/g, ' ')} ${sec(slow[1])}` : '', tone(slow && slow[1], 5000, 15000)]);
    }
  } else rows.push(['Lista', appState === 'loading' ? 'carregando...' : appState === 'error' ? 'erro ao carregar' : 'nenhuma', appState === 'error' ? 'bad' : '']);
  const nodes = document.getElementsByTagName('*').length;
  const imgs = [...document.images];
  const pending = imgs.filter((i) => !i.complete).length;
  rows.push(['Tela', `${route} · ${document.querySelectorAll('#view .poster, #view .ch-card, #view .ep').length} itens`, '',
    `${nodes.toLocaleString('pt-BR')} elementos · ${imgs.length} imagens${pending ? ` (${pending} carregando)` : ''}`, tone(nodes, 3000, 8000)]);
  return rows;
});

(async function boot() {
  setTimeout(hideSplash, 15000);
  detectTv();
  initKeyDebug();
  document.addEventListener('focusin', () => { if (TV.on || KB.on) syncFocus(); });
  // PC: usar o mouse desliga o modo teclado (o pequeno limite ignora o "movimento" que a rolagem simula)
  document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') setKbNav(false); }, true);
  document.addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) setKbNav(false); }, { passive: true });
  initTvKeyboard();
  initSmoothScroll();
  applyDebug();
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
  await waitForInternet(); // sem internet nada carrega: avisa na tela e segue sozinho quando ela voltar
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
