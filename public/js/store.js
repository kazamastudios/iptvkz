// Estado do app (salvo no servidor em data/) + catálogo da lista ativa + guia.
export const S = {
  lists: [],
  settings: {},
  favorites: {},
  recents: {},
  progress: {},
  catPrefs: {},
  dataDir: '',
  vlc: false,
};

export const DEFAULT_SETTINGS = {
  activeList: null,
  audioLang: 'pt', // pt | en | orig
  subMode: 'auto', // auto | always | off
  subSize: 'M',
  subBg: 'shadow', // none | shadow | box
  autoNext: true,
  liveSort: 'orig', // orig | az
  versionPref: 'Dublado',
  volume: 1,
};

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
  return data;
}

export async function loadState() {
  const st = await api('/api/state');
  Object.assign(S, st);
  S.settings = { ...DEFAULT_SETTINGS, ...(st.settings || {}) };
}

const timers = {};
export function save(key) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    api('/api/state/' + key, { method: 'PUT', body: JSON.stringify(S[key]) }).catch((e) => console.error('save', key, e));
  }, 300);
}

export async function saveNow(key) {
  clearTimeout(timers[key]);
  delete timers[key];
  await api('/api/state/' + key, { method: 'PUT', body: JSON.stringify(S[key]) });
}

export function flushSaves() {
  for (const key of Object.keys(timers)) {
    clearTimeout(timers[key]);
    navigator.sendBeacon?.('/api/state/' + key, new Blob([JSON.stringify(S[key])], { type: 'application/json' }));
  }
}

export function setSetting(k, v) {
  S.settings[k] = v;
  save('settings');
}

export function activeList() {
  return S.lists.find((l) => l.id === S.settings.activeList) || S.lists[0] || null;
}

// ---------- catálogo ----------

let current = null;
export const C = () => current;

function indexSection(sec) {
  const byId = new Map();
  const byCat = new Map();
  for (const it of sec.items) {
    byId.set(it.id, it);
    let arr = byCat.get(it.cat);
    if (!arr) byCat.set(it.cat, (arr = []));
    arr.push(it);
  }
  const catName = new Map(sec.cats.map((c) => [c.id, c.name]));
  // categorias referenciadas por itens mas ausentes da lista de categorias
  for (const id of byCat.keys()) if (!catName.has(id)) {
    catName.set(id, 'Outros');
    sec.cats.push({ id, name: 'Outros' });
  }
  return { ...sec, byId, byCat, catName };
}

export async function loadCatalog(listId, { force = false } = {}) {
  const r = await api(`/api/catalog?list=${encodeURIComponent(listId)}${force ? '&refresh=1' : ''}`);
  const c = r.catalog;
  current = {
    listId,
    updatedAt: c.updatedAt,
    epgUrl: c.epgUrl,
    live: indexSection(c.live),
    movies: indexSection(c.movies),
    series: indexSection(c.series),
  };
  epgCache.clear();
  seriesCache.clear();
  return { refreshing: r.refreshing };
}

export function clearCatalog() {
  current = null;
}

export async function catalogStatus(listId) {
  return api(`/api/catalog/status?list=${encodeURIComponent(listId)}`);
}

// ---------- categorias (ocultar / ordenar) ----------

function prefs(section) {
  const lid = current?.listId;
  if (!lid) return { hidden: [], order: [] };
  S.catPrefs[lid] ||= {};
  S.catPrefs[lid][section] ||= { hidden: [], order: [] };
  return S.catPrefs[lid][section];
}

export function orderedCats(section) {
  const sec = current?.[section];
  if (!sec) return [];
  const p = prefs(section);
  const pos = new Map(p.order.map((id, i) => [id, i]));
  return sec.cats
    .map((c, i) => ({ ...c, count: sec.byCat.get(c.id)?.length || 0, hidden: p.hidden.includes(c.id), _i: i }))
    .filter((c) => c.count > 0)
    .sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + a._i) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + b._i));
}

export function visibleCats(section) {
  return orderedCats(section).filter((c) => !c.hidden);
}

export function setCatHidden(section, id, hidden) {
  const p = prefs(section);
  p.hidden = p.hidden.filter((x) => x !== id);
  if (hidden) p.hidden.push(id);
  save('catPrefs');
}

export function setCatOrder(section, ids) {
  prefs(section).order = ids;
  save('catPrefs');
}

export function resetCats(section) {
  const p = prefs(section);
  p.hidden = [];
  p.order = [];
  save('catPrefs');
}

// Itens visíveis (fora das categorias ocultas).
export function visibleItems(section) {
  const sec = current?.[section];
  if (!sec) return [];
  const hidden = new Set(prefs(section).hidden);
  if (!hidden.size) return sec.items;
  return sec.items.filter((it) => !hidden.has(it.cat));
}

// ---------- favoritos / recentes / progresso ----------

function bucket(root, section) {
  const lid = current?.listId;
  root[lid] ||= {};
  root[lid][section] ||= [];
  return root[lid][section];
}

export function isFav(section, id) {
  return bucket(S.favorites, section).includes(id);
}

export function toggleFav(section, id) {
  const b = bucket(S.favorites, section);
  const i = b.indexOf(id);
  if (i >= 0) b.splice(i, 1);
  else b.unshift(id);
  save('favorites');
  return i < 0;
}

export function favItems(section) {
  const sec = current?.[section];
  return bucket(S.favorites, section).map((id) => sec.byId.get(id)).filter(Boolean);
}

export function addRecent(section, id) {
  const b = bucket(S.recents, section);
  const i = b.indexOf(id);
  if (i >= 0) b.splice(i, 1);
  b.unshift(id);
  b.length = Math.min(b.length, 40);
  save('recents');
}

export function recentItems(section) {
  const sec = current?.[section];
  return bucket(S.recents, section).map((id) => sec.byId.get(id)).filter(Boolean);
}

// Limpa e devolve uma função que desfaz.
export function clearRecents(section) {
  const b = bucket(S.recents, section);
  const prev = b.slice();
  b.length = 0;
  save('recents');
  return () => {
    const cur = bucket(S.recents, section);
    cur.splice(0, cur.length, ...prev);
    save('recents');
  };
}

// Filmes começados (não o histórico de assistidos) ou o "último episódio" das séries.
export function clearContinue(section) {
  const m = progMap();
  const removed = {};
  for (const [k, p] of Object.entries(m)) {
    const hit = section === 'movies'
      ? p.kind === 'movie' && p.d && p.t / p.d < 0.95
      : k.startsWith('s:') && p.kind === 'serie-last';
    if (hit) {
      removed[k] = p;
      delete m[k];
    }
  }
  save('progress');
  return () => {
    Object.assign(progMap(), removed);
    save('progress');
  };
}

function progMap() {
  const lid = current?.listId;
  return (S.progress[lid] ||= {});
}

export function getProgress(id) {
  return progMap()[id] || null;
}

export function setProgress(id, data) {
  progMap()[id] = { ...data, at: Date.now() };
  save('progress');
}

export function clearProgress(id) {
  delete progMap()[id];
  save('progress');
}

// Filmes começados e não terminados, mais recentes primeiro.
export function continueMovies() {
  const sec = current?.movies;
  return Object.entries(progMap())
    .filter(([, p]) => p.kind === 'movie' && p.d && p.t / p.d > 0.02 && p.t / p.d < 0.95)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => sec.byId.get(id))
    .filter(Boolean);
}

export function continueSeries() {
  const sec = current?.series;
  return Object.entries(progMap())
    .filter(([k, p]) => k.startsWith('s:') && p.kind === 'serie-last')
    .sort((a, b) => b[1].at - a[1].at)
    .map(([k]) => sec.byId.get(k.slice(2)))
    .filter(Boolean);
}

// ---------- séries / filmes (detalhes sob demanda no Xtream) ----------

const seriesCache = new Map();

export async function seriesDetail(serie, versionLabel) {
  if (serie.seasons) return { seasons: serie.seasons };
  const v = serie.versions.find((x) => x.label === versionLabel) || serie.versions[0];
  const key = serie.id + '|' + v.label;
  if (!seriesCache.has(key)) {
    const p = api(`/api/series?list=${encodeURIComponent(current.listId)}&xid=${encodeURIComponent(v.xid)}`);
    seriesCache.set(key, p);
    p.catch(() => seriesCache.delete(key));
  }
  return seriesCache.get(key);
}

export async function movieDetail(movie) {
  const v = movie.versions.find((x) => x.xid);
  if (!v) return null;
  return api(`/api/vod?list=${encodeURIComponent(current.listId)}&xid=${encodeURIComponent(v.xid)}`);
}

export function preferredVersion(versions) {
  const pref = S.settings.versionPref;
  return versions.find((v) => v.label === pref) || versions[0];
}

// ---------- guia (EPG) ----------

const epgCache = new Map(); // channelId -> progs[] | null
let epgStatus = { status: 'unknown' };
export const epgState = () => epgStatus;

export async function fetchEpg(channels, { force = false } = {}) {
  if (!current) return epgStatus;
  const need = force ? channels : channels.filter((c) => !epgCache.has(c.id));
  if (!need.length) return epgStatus;
  const chans = need.map((c) => ({ k: c.id, e: c.epg || '', n: c.name }));
  try {
    const r = await api('/api/epg', { method: 'POST', body: JSON.stringify({ list: current.listId, chans }) });
    epgStatus = r;
    if (r.status === 'ok' || r.status === 'refreshing') {
      for (const c of need) epgCache.set(c.id, r.data[c.id] || null);
    }
  } catch (e) {
    epgStatus = { status: 'error', message: e.message };
  }
  return epgStatus;
}

export function epgFor(id) {
  return epgCache.get(id) || null;
}

export function nowNext(progs, now = Date.now()) {
  if (!progs) return { now: null, next: null };
  let i = progs.findIndex((p) => p[0] <= now && p[1] > now);
  if (i < 0) {
    const n = progs.find((p) => p[0] > now);
    return { now: null, next: n || null };
  }
  return { now: progs[i], next: progs[i + 1] || null };
}

export function resetEpgCache() {
  epgCache.clear();
}
