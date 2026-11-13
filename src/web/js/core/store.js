// Estado do app (salvo no servidor em data/) + catálogo da lista ativa + guia.
export const S = {
  lists: [],
  settings: {},
  favorites: {},
  recents: {},
  progress: {},
  catPrefs: {},
  dataDir: '',
  build: null, // { version, build, channel, commit, date, source } — ver scripts/build-info.js
};

// Versão, build e modo para mostrar: no rodapé do menu (curto) e em Configurações → Sobre (completo).
export function buildLabel() {
  const b = S.build || {};
  const dev = b.channel !== 'producao';
  const parts = [b.version ? `v${b.version}` : null, b.build >= 1e9 ? 'build local' : b.build ? `build ${b.build}` : b.source === 'codigo' ? 'código local' : null].filter(Boolean);
  let when = '';
  if (b.date) { try { when = new Date(b.date).toLocaleDateString('pt-BR'); } catch {} }
  return {
    dev,
    mode: dev ? 'Beta' : 'Produção',
    short: parts.join(' · '),
    detail: [b.commit ? `commit ${b.commit}` : null, when ? `gerada em ${when}` : null].filter(Boolean).join(' · '),
  };
}

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
  // avisa a barra lateral para atualizar as contagens
  if (key === 'favorites' || key === 'progress') window.dispatchEvent(new Event('iptvkz:counts'));
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

// A lista chega por seção (canais, filmes, séries): primeiro a da tela atual (first), que já aparece, e as outras
// logo depois, por trás. Numa lista grande, ler só uma seção é bem mais rápido na TV e no celular, e na primeira
// carga de uma lista Xtream a seção da tela vem assim que chega do provedor, sem esperar as outras.
// Telas que precisam de outra seção esperam por ela (sectionsReady). whole: só troca a lista com tudo pronto
// (atualização em segundo plano, com a pessoa usando a lista antiga).
export const SECTIONS = ['live', 'movies', 'series'];
const EMPTY = () => indexSection({ cats: [], items: [] });
// quem quer saber quando uma seção chega (lista simples: EventTarget não existe nas TVs LG antigas)
let sectionWatchers = [];
const sectionArrived = () => { sectionWatchers = sectionWatchers.filter((fn) => fn() !== true); };

export async function loadCatalog(listId, { force = false, first = 'live', whole = false } = {}) {
  const order = [first, ...SECTIONS].filter((k, i, a) => SECTIONS.includes(k) && a.indexOf(k) === i);
  const get = (sec, extra) => api(`/api/catalog?list=${encodeURIComponent(listId)}&section=${sec}${extra}`);
  const r = await get(order[0], force ? '&refresh=1' : '');
  const c = r.catalog;
  const next = {
    listId,
    updatedAt: c.updatedAt,
    epgUrl: c.epgUrl,
    timing: c.timing || null, // medições da última montagem (modo de depuração)
    live: EMPTY(),
    movies: EMPTY(),
    series: EMPTY(),
    loaded: new Set([order[0]]),
    ver: 1,
  };
  next[order[0]] = indexSection(c[order[0]]);
  // as outras seções, uma de cada vez (aparelho fraco não recebe duas listas grandes juntas)
  const rest = (async () => {
    for (const sec of order.slice(1)) {
      let sr = null;
      for (let tries = 0; !sr && tries < 3; tries++) {
        try { sr = await get(sec, r.building ? '&wait=1' : ''); } catch (e) { if (tries === 2) throw e; }
      }
      next[sec] = indexSection(sr.catalog[sec]);
      next.loaded.add(sec);
      next.ver++;
      if (current === next) sectionArrived();
    }
  })();
  if (whole) await rest;
  else rest.catch((e) => console.error('catalogo', e));
  next.rest = rest;
  current = next;
  epgCache.clear();
  seriesCache.clear();
  return { refreshing: r.refreshing, rest, warning: r.warning || null, shrunk: c.shrunk || null, counts: c.counts || null };
}

// As seções já chegaram? (as que faltam continuam chegando por trás)
export function sectionsLoaded(secs) {
  return !current || secs.every((s) => current.loaded.has(s));
}

// Espera as seções chegarem. Devolve false se a lista mudou no meio.
export function sectionsReady(secs) {
  const c = current;
  if (sectionsLoaded(secs)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    // true: já respondeu, sai da lista de quem espera
    const check = () => {
      if (done) return true;
      if (current !== c) { done = true; resolve(false); return true; }
      if (secs.every((s) => c.loaded.has(s))) { done = true; resolve(true); return true; }
      return false;
    };
    sectionWatchers.push(check);
    // falhou alguma seção: a tela abre com o que tem
    c.rest.catch(() => { if (!done) { done = true; resolve(current === c); } });
  });
}

// Avisa quando uma seção chega (ex.: atualizar as contagens da barra lateral).
export function onSection(fn) {
  sectionWatchers.push(() => { fn(); return false; });
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
    .map((c, i) => ({ ...c, count: sec.byCat.get(c.id)?.length || 0, hidden: p.hidden.includes(c.id), adult: isAdultCat(section, c.id), _i: i }))
    .filter((c) => c.count > 0 && !(c.adult && adultLocked()))
    .sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e6 + a._i) - (pos.has(b.id) ? pos.get(b.id) : 1e6 + b._i));
}

// ---------- controle dos pais (conteúdo adulto) ----------
// Categorias: detecta pelo nome; o usuário pode marcar/desmarcar. Itens: nomes inequívocos.
const ADULT_CAT_RE = /(adult|adulto|xxx|\+\s?18|18\s?\+|porn|er[oó]tic|sexy|playboy|hustler|brazzers|penthouse|dorcel|redlight|bangbros|venus|\bhot\b|after ?dark)/i;
const ADULT_ITEM_RE = /(xxx|porn|\badult|adulto|\+\s?18\b|\b18\s?\+|playboy|brazzers|hustler|penthouse|dorcel|redlight|bangbros|private ?(tv|gold|spice)|venus ?tv|sextreme)/i;

let adultUnlocked = false; // por aparelho, até recarregar o app
let adultVer = 0;
let adultMemo = { key: null, data: {} };

export function parentalEnabled() {
  return !!S.settings.parentalPin;
}

export function adultLocked() {
  return parentalEnabled() && !adultUnlocked;
}

// Não é segurança de banco: só impede que alguém leia o PIN direto do arquivo.
export function pinHash(pin) {
  let h = 0x811c9dc5;
  const s = 'iptvkz:' + pin;
  for (let r = 0; r < 2000; r++) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + r;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

export function checkPin(pin) {
  return parentalEnabled() && pinHash(String(pin)) === S.settings.parentalPin;
}

export function unlockAdult(pin) {
  if (!checkPin(pin)) return false;
  adultUnlocked = true;
  return true;
}

export function lockAdult() {
  adultUnlocked = false;
}

function adultInfo(section) {
  const key = `${current?.listId}|${current?.updatedAt}|${current?.ver}|${adultVer}`;
  if (adultMemo.key !== key) adultMemo = { key, data: {} };
  if (adultMemo.data[section]) return adultMemo.data[section];
  const sec = current?.[section];
  const p = prefs(section);
  const cats = new Set();
  const items = new Set();
  if (sec) {
    for (const c of sec.cats) {
      const on = (p.adult || []).includes(c.id) || (!(p.notAdult || []).includes(c.id) && ADULT_CAT_RE.test(c.name));
      if (on) cats.add(c.id);
    }
    for (const it of sec.items) if (cats.has(it.cat) || ADULT_ITEM_RE.test(it.name)) items.add(it.id);
  }
  return (adultMemo.data[section] = { cats, items });
}

export function isAdultCat(section, id) {
  return adultInfo(section).cats.has(id);
}

export function isAdultItem(section, id) {
  return adultInfo(section).items.has(id);
}

export function setCatAdult(section, id, on) {
  const p = prefs(section);
  p.adult = (p.adult || []).filter((x) => x !== id);
  p.notAdult = (p.notAdult || []).filter((x) => x !== id);
  (on ? p.adult : p.notAdult).push(id);
  adultVer++;
  save('catPrefs');
}

export function adultCatCount() {
  return ['live', 'movies', 'series'].reduce((n, s) => n + adultInfo(s).cats.size, 0);
}

function hideAdult(section, arr) {
  if (!adultLocked()) return arr;
  const set = adultInfo(section).items;
  return set.size ? arr.filter((it) => !set.has(it.id)) : arr;
}

// Itens de uma categoria, respeitando o controle dos pais.
export function catItems(section, catId) {
  const sec = current?.[section];
  if (!sec || (adultLocked() && isAdultCat(section, catId))) return [];
  return hideAdult(section, sec.byCat.get(catId) || []);
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
  if (!hidden.size) return hideAdult(section, sec.items);
  return hideAdult(section, sec.items.filter((it) => !hidden.has(it.cat)));
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
  return hideAdult(section, bucket(S.favorites, section).map((id) => sec.byId.get(id)).filter(Boolean));
}

// Minha lista ("assistir depois"): separada dos favoritos, salva junto com eles.
export function isLater(section, id) {
  return bucket(S.favorites, 'later:' + section).includes(id);
}

export function toggleLater(section, id) {
  const b = bucket(S.favorites, 'later:' + section);
  const i = b.indexOf(id);
  if (i >= 0) b.splice(i, 1);
  else b.unshift(id);
  save('favorites');
  return i < 0;
}

export function laterItems(section) {
  const sec = current?.[section];
  return hideAdult(section, bucket(S.favorites, 'later:' + section).map((id) => sec.byId.get(id)).filter(Boolean));
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
  return hideAdult(section, bucket(S.recents, section).map((id) => sec.byId.get(id)).filter(Boolean));
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
      ? p.kind === 'movie' && isStarted(p)
      : k.startsWith('s:') && p.kind === 'serie-last';
    if (hit) {
      removed[k] = p;
      if (p.w) m[k] = { ...p, t: p.d }; // já tinha sido assistido: continua marcado
      else delete m[k];
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

// "Assistido" é permanente: rever um filme não apaga a marca.
export function setProgress(id, data) {
  const m = progMap();
  const watched = (m[id] && m[id].w) || (data.d && data.t / data.d >= 0.95);
  m[id] = { ...data, at: Date.now() };
  if (watched) m[id].w = true;
  save('progress');
}

// Começado e não terminado: 30 segundos já contam, mesmo sem saber a duração do vídeo.
export function isStarted(p) {
  if (!p || !(p.t > 0)) return false;
  if (!p.d) return p.t >= 30;
  const r = p.t / p.d;
  return r < 0.95 && (r > 0.02 || p.t >= 30);
}

export function isWatched(id) {
  const p = progMap()[id];
  return !!p && (!!p.w || (!!p.d && p.t / p.d >= 0.95));
}

// Tira itens do Histórico e devolve uma função que desfaz.
export function clearHistoryEntries(entries) {
  const m = progMap();
  const removed = {};
  for (const e of entries) {
    const key = e.section === 'movies' ? e.item.id : 's:' + e.item.id;
    if (m[key]) {
      removed[key] = m[key];
      delete m[key];
    }
  }
  save('progress');
  return () => {
    Object.assign(progMap(), removed);
    save('progress');
  };
}

// Filmes e séries para a tela de Histórico, mais recentes primeiro.
export function watchHistory() {
  const inProgress = [];
  const done = [];
  for (const [k, p] of Object.entries(progMap())) {
    if (p.kind === 'movie') {
      const item = current.movies.byId.get(k);
      if (!item || (adultLocked() && isAdultItem('movies', k))) continue;
      const entry = { section: 'movies', item, at: p.at };
      if (isStarted(p)) inProgress.push(entry);
      else if (isWatched(k)) done.push(entry);
    } else if (p.kind === 'serie-last') {
      const id = k.slice(2);
      const item = current.series.byId.get(id);
      if (!item || (adultLocked() && isAdultItem('series', id))) continue;
      (p.done ? done : inProgress).push({ section: 'series', item, at: p.at });
    }
  }
  const byDate = (a, b) => b.at - a.at;
  return { inProgress: inProgress.sort(byDate), done: done.sort(byDate) };
}

export function clearProgress(id) {
  delete progMap()[id];
  save('progress');
}

// Filmes começados e não terminados, mais recentes primeiro.
export function continueMovies() {
  const sec = current?.movies;
  return Object.entries(progMap())
    .filter(([, p]) => p.kind === 'movie' && isStarted(p))
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => sec.byId.get(id))
    .filter((it) => it && !(adultLocked() && isAdultItem('movies', it.id)));
}

export function continueSeries() {
  const sec = current?.series;
  return Object.entries(progMap())
    .filter(([k, p]) => k.startsWith('s:') && p.kind === 'serie-last' && !p.done)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([k]) => sec.byId.get(k.slice(2)))
    .filter((it) => it && !(adultLocked() && isAdultItem('series', it.id)));
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

// ---------- idioma do áudio de cada versão ----------
// A lista nem sempre diz se a versão é dublada. Quando um vídeo toca, o player conta quais idiomas de
// áudio ele tem; o app guarda isso neste aparelho e passa a mostrar "Português", "Inglês"... no lugar de "Versão".
const AUDIO_KEY = 'iptvkz.audioLang';
const AUDIO_MAX = 800;
const LANG_NAMES = {
  pt: 'Português', por: 'Português', pob: 'Português', 'pt-br': 'Português', en: 'Inglês', eng: 'Inglês', es: 'Espanhol', spa: 'Espanhol',
  fr: 'Francês', fre: 'Francês', fra: 'Francês', de: 'Alemão', ger: 'Alemão', deu: 'Alemão', it: 'Italiano', ita: 'Italiano',
  ja: 'Japonês', jpn: 'Japonês', ko: 'Coreano', kor: 'Coreano',
};
const langKey = (l) => {
  const k = String(l || '').toLowerCase();
  const name = LANG_NAMES[k] || LANG_NAMES[k.split('-')[0]];
  return name ? name : null;
};
let audioMap = null;
function audioStore() {
  if (!audioMap) {
    try { audioMap = JSON.parse(localStorage.getItem(AUDIO_KEY)) || {}; } catch { audioMap = {}; }
  }
  return audioMap;
}

// langs: códigos de idioma das faixas de áudio do vídeo que está tocando ("pt", "eng"...).
export function learnAudio(url, langs) {
  const names = [...new Set((langs || []).map(langKey).filter(Boolean))];
  if (!url || !names.length) return;
  const m = audioStore();
  const value = names.join('+');
  if (m[url] === value) return;
  delete m[url];
  m[url] = value; // reinserido no fim: os mais antigos saem primeiro
  const keys = Object.keys(m);
  for (let i = 0; i < keys.length - AUDIO_MAX; i++) delete m[keys[i]];
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(m)); } catch {}
}

const learned = (v) => (v && v.url ? audioStore()[v.url] : null);

// Nome de cada versão para mostrar: "Versão 2 4K" vira "Português 4K" depois que alguém assistiu;
// duas ou mais línguas no mesmo arquivo viram "Dual áudio". Rótulos que já dizem o idioma ficam como estão.
export function versionNames(versions) {
  const out = {};
  for (const v of versions || []) {
    const l = learned(v);
    const m = v.label.match(/^Versão(?: \d+)?(.*)$/);
    out[v.label] = l && m ? (l.includes('+') ? 'Dual áudio' : l) + m[1] : v.label;
  }
  // dois com o mesmo nome (duas versões em português): volta o número para diferenciar
  const seen = {};
  for (const v of versions || []) seen[out[v.label]] = (seen[out[v.label]] || 0) + 1;
  for (const v of versions || []) {
    if (seen[out[v.label]] > 1 && out[v.label] !== v.label) out[v.label] = `${out[v.label]} (${v.label})`;
  }
  return out;
}

// Tela que mostra 4K? (pixels reais: no Android TV a página tem metade do tamanho e o dobro de densidade)
function screen4K() {
  const s = window.screen || {};
  return Math.max(s.width || 0, s.height || 0) * (window.devicePixelRatio || 1) >= 3000;
}
const is4K = (v) => /\b4K\b/.test(v.label);
const kindOf = (v) => v.label.split(/[ ·]/)[0]; // Dublado, Legendado, Nacional, Dual, Versão

// Versão que abre ao dar play: a que o usuário escolheu antes (exata), senão a do idioma preferido, e entre elas
// a que cabe na tela: numa tela Full HD, a versão Full HD em vez da 4K (que trava em aparelhos mais simples).
// O 4K continua no menu; escolhido lá, vira a preferência e abre direto nas próximas vezes.
export function preferredVersion(versions) {
  const pref = S.settings.versionPref;
  const exact = versions.find((v) => v.label === pref);
  if (exact) return exact;
  let pool = pref ? versions.filter((v) => kindOf(v) === pref.split(/[ ·]/)[0]) : [];
  // versão sem marcação, mas que o app já viu tocar no idioma preferido
  const want = S.settings.audioLang === 'en' ? 'Inglês' : S.settings.audioLang === 'orig' ? null : 'Português';
  if (!pool.length && want) pool = versions.filter((v) => /^Versão/.test(v.label) && learned(v) === want);
  if (!pool.length) pool = versions.filter((v) => kindOf(v) === kindOf(versions[0]));
  if (!pool.length) return versions[0];
  return (!screen4K() && pool.find((v) => !is4K(v))) || pool[0];
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
