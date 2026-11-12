// Baixa listas (M3U ou Xtream) e normaliza tudo num catálogo único:
// { live, movies, series } cada um com { cats: [{id,name}], items: [...] }.
const fs = require('fs');
const { hash, norm, fetchText, fetchJson, fetchWithTimeout } = require('./util');
const store = require('./store');

const STALE_MS = 12 * 60 * 60 * 1000;
const VOD_EXT = new Set(['mp4', 'mkv', 'avi', 'm4v', 'mov', 'webm', 'wmv', 'flv', 'mpg', 'mpeg']);

// ---------- Versões (Dublado / Legendado ...) ----------

const TAG_BRACKET = /\s*[\[\(]\s*(dublado|dub|legendado|leg|nacional|dual(?:\s*[aá]udio)?|[LD])\s*[\]\)]\s*/i;
const TAG_TRAILING = /[\s\-_|]+(dublado|dub|legendado|leg|nacional|dual(?:\s*[aá]udio)?)\s*$/i;

function versionLabel(tag) {
  const t = tag.toLowerCase();
  if (t === 'd' || t.startsWith('dub')) return 'Dublado';
  if (t === 'l' || t.startsWith('leg')) return 'Legendado';
  if (t.startsWith('nac')) return 'Nacional';
  if (t.startsWith('dual')) return 'Dual áudio';
  return 'Original';
}

// Qualidade no nome ("Filme 4K", "Filme [1080p]"): sai do título, para juntar com as outras versões, e entra no rótulo.
const QUALITY_BRACKET = /\s*[\[\(]\s*(4k|uhd|2160p|fhd|full\s*hd|1080p|720p|hdr)\s*[\]\)]\s*/i;
const QUALITY_TRAILING = /[\s\-_|]+(4k|uhd|2160p|fhd|full\s*hd|1080p|720p|hdr)\s*$/i;

function qualityLabel(tag) {
  const t = tag.toLowerCase().replace(/\s+/g, '');
  if (t === '4k' || t === 'uhd' || t === '2160p') return '4K';
  if (t === 'fhd' || t === 'fullhd' || t === '1080p') return 'Full HD';
  if (t === '720p') return 'HD';
  return 'HDR';
}

function cut(base, m) {
  return (base.slice(0, m.index) + ' ' + base.slice(m.index + m[0].length))
    .replace(/[\s\-_|.]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Sem marcação no nome, a categoria da lista costuma dizer ("Filmes Dublados", "Lançamentos 4K").
function groupLang(group) {
  const g = String(group || '').toLowerCase();
  if (/dublad|\bdub\b/.test(g)) return 'Dublado';
  if (/legendad|\bleg\b/.test(g)) return 'Legendado';
  if (/nacionai?s?\b/.test(g)) return 'Nacional';
  if (/\bdual\b/.test(g)) return 'Dual áudio';
  return null;
}

// Versão sem idioma conhecido: "Versão" (numerada depois, se houver mais de uma). O app troca pelo idioma
// do áudio depois que alguém assiste.
function splitVersion(name, group) {
  let base = String(name || '').trim();
  let lang = null;
  let quality = null;
  const m = base.match(TAG_BRACKET) || base.match(TAG_TRAILING);
  if (m) {
    lang = versionLabel(m[1]);
    base = cut(base, m);
  }
  const q = base.match(QUALITY_BRACKET) || base.match(QUALITY_TRAILING);
  if (q) {
    quality = qualityLabel(q[1]);
    base = cut(base, q);
    if (!lang) { // a marcação de idioma pode vir antes da qualidade: "Filme [L] 4K"
      const m2 = base.match(TAG_BRACKET) || base.match(TAG_TRAILING);
      if (m2) { lang = versionLabel(m2[1]); base = cut(base, m2); }
    }
  }
  if (!lang) lang = groupLang(group);
  if (!quality && /\b(4k|uhd)\b/i.test(String(group || ''))) quality = '4K';
  const label = [lang || 'Versão', quality].filter(Boolean).join(' ');
  return { base: base || String(name || '').trim(), label };
}

const VERSION_ORDER = ['Dublado', 'Dual áudio', 'Nacional', 'Legendado', 'Versão'];
const kindOf = (label) => VERSION_ORDER.find((k) => label.startsWith(k)) || 'Versão';
function sortVersions(vs) {
  vs.sort((a, b) => VERSION_ORDER.indexOf(kindOf(a.label)) - VERSION_ORDER.indexOf(kindOf(b.label)));
  // várias sem idioma: Versão 1, Versão 2... (o número segue a ordem da lista)
  const unknown = vs.filter((v) => v.label === 'Versão');
  if (unknown.length > 1) unknown.forEach((v, i) => { v.label = `Versão ${i + 1}`; });
  return vs;
}

// Mesmo rótulo de novo: o nome da categoria diferencia ("Dublado · Lançamentos"); sem isso, um número.
function addVersion(list, v) {
  let label = v.label;
  if (label !== 'Versão' && list.some((x) => x.label === label) && v.group) {
    const withGroup = `${v.label} · ${v.group}`;
    if (!list.some((x) => x.label === withGroup)) label = withGroup;
  }
  let n = 2;
  while (label !== 'Versão' && list.some((x) => x.label === label)) label = `${v.label} ${n++}`;
  const { group, ...rest } = v;
  list.push({ ...rest, label });
}

function yearOf(name) {
  const m = String(name || '').match(/\((19\d{2}|20\d{2})\)/);
  return m ? Number(m[1]) : null;
}

// Junta itens com o mesmo título-base em um só, com várias versões.
function mergeMovies(raw) {
  const groups = new Map();
  for (const r of raw) {
    const { base, label } = splitVersion(r.name, r.group);
    const key = norm(base);
    let g = groups.get(key);
    if (!g) {
      g = {
        id: 'm' + hash(key),
        name: base,
        poster: r.poster || '',
        cat: r.cat,
        year: r.year || yearOf(base),
        rating: r.rating || null,
        added: r.added || 0,
        versions: [],
      };
      groups.set(key, g);
    }
    if (!g.poster && r.poster) g.poster = r.poster;
    if (!g.rating && r.rating) g.rating = r.rating;
    if (r.added > g.added) g.added = r.added;
    addVersion(g.versions, { label, url: r.url, xid: r.xid, group: r.group });
  }
  const items = [...groups.values()];
  for (const it of items) sortVersions(it.versions);
  return items;
}

// ---------- M3U ----------

function parseAttrs(s) {
  const attrs = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

function parseExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  let inQuote = false;
  let commaAt = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ',' && !inQuote) { commaAt = i; break; }
  }
  const head = commaAt >= 0 ? body.slice(0, commaAt) : body;
  const name = commaAt >= 0 ? body.slice(commaAt + 1).trim() : '';
  const attrs = parseAttrs(head);
  return { name: name || attrs['tvg-name'] || 'Sem nome', attrs, group: attrs['group-title'] || '' };
}

function parseM3U(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = {};
  const entries = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      Object.assign(header, parseAttrs(line));
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      cur = parseExtinf(line);
      continue;
    }
    if (line.startsWith('#EXTGRP:')) {
      if (cur && !cur.group) cur.group = line.slice(8).trim();
      continue;
    }
    if (line.startsWith('#')) continue;
    if (cur) {
      cur.url = line;
      entries.push(cur);
      cur = null;
    } else if (/^https?:\/\//i.test(line)) {
      entries.push({ name: line, attrs: {}, group: '', url: line });
    }
  }
  return { header, entries };
}

function urlExt(url) {
  const p = String(url).split(/[?#]/)[0].toLowerCase();
  const m = p.match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : '';
}

const EP_PATTERNS = [
  /^(.*?)[\s\-_.|:]*\b[ST](\d{1,2})\s*[\-_.]?\s*E(\d{1,4})\b[\s\-_.|:]*(.*)$/i,
  /^(.*?)[\s\-_.|:]+(\d{1,2})x(\d{1,3})\b[\s\-_.|:]*(.*)$/i,
];

function parseEpisode(name) {
  for (const re of EP_PATTERNS) {
    const m = name.match(re);
    if (m && m[1].trim()) {
      return { show: m[1].trim(), season: Number(m[2]), ep: Number(m[3]), rest: m[4].trim() };
    }
  }
  return null;
}

function catCollector() {
  const cats = [];
  const seen = new Set();
  return {
    cats,
    add(name) {
      const n = name || 'Sem categoria';
      const id = 'g' + hash(n);
      if (!seen.has(id)) {
        seen.add(id);
        cats.push({ id, name: n });
      }
      return id;
    },
  };
}

function buildFromM3U(text, list) {
  const { header, entries } = parseM3U(text);
  if (!entries.length) throw new Error('A lista está vazia ou não é um arquivo M3U válido.');

  const liveCats = catCollector();
  const movieCats = catCollector();
  const seriesCats = catCollector();
  const live = [];
  const movieRaw = [];
  const seriesMap = new Map();
  const liveSeen = new Set();

  for (const e of entries) {
    const url = e.url;
    const lower = url.toLowerCase();
    const ext = urlExt(url);
    const logo = e.attrs['tvg-logo'] || '';
    let kind = 'live';
    if (lower.includes('/series/')) kind = 'series';
    else if (lower.includes('/movie/')) kind = 'movie';
    else if (VOD_EXT.has(ext)) kind = 'vod';

    const { base, label } = splitVersion(e.name, e.group);
    const epInfo = kind === 'live' || kind === 'movie' ? null : parseEpisode(base);
    if (kind === 'vod') kind = epInfo ? 'series' : 'movie';

    if (kind === 'live') {
      let id = 'l' + hash(url + '|' + e.name);
      if (liveSeen.has(id)) continue;
      liveSeen.add(id);
      live.push({
        id,
        name: e.name,
        logo,
        cat: liveCats.add(e.group),
        epg: e.attrs['tvg-id'] || '',
        url,
      });
    } else if (kind === 'movie') {
      movieRaw.push({ name: e.name, poster: logo, cat: movieCats.add(e.group), group: e.group, url });
    } else {
      const info = epInfo || { show: base, season: 1, ep: 0, rest: '' };
      const key = norm(info.show);
      let s = seriesMap.get(key);
      if (!s) {
        s = {
          id: 's' + hash(key),
          name: info.show,
          poster: logo,
          cat: seriesCats.add(e.group),
          year: yearOf(info.show),
          seasons: new Map(),
        };
        seriesMap.set(key, s);
      }
      if (!s.poster && logo) s.poster = logo;
      let season = s.seasons.get(info.season);
      if (!season) {
        season = new Map();
        s.seasons.set(info.season, season);
      }
      const epNum = info.ep || season.size + 1;
      let ep = season.get(epNum);
      if (!ep) {
        ep = {
          id: 'e' + hash(s.id + '|' + info.season + '|' + epNum),
          num: epNum,
          title: info.rest || `Episódio ${epNum}`,
          img: '',
          versions: [],
        };
        season.set(epNum, ep);
      }
      addVersion(ep.versions, { label, url, group: e.group });
    }
  }

  const series = [...seriesMap.values()].map((s) => ({
    ...s,
    seasons: [...s.seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([num, eps]) => ({
        num,
        eps: [...eps.values()].sort((a, b) => a.num - b.num).map((ep) => ({ ...ep, versions: sortVersions(ep.versions) })),
      })),
  }));

  const epgUrl = header['url-tvg'] || header['x-tvg-url'] || '';
  return {
    epgUrl: epgUrl.split(',')[0].trim(),
    live: { cats: liveCats.cats, items: live },
    movies: { cats: movieCats.cats, items: mergeMovies(movieRaw) },
    series: { cats: seriesCats.cats, items: series },
  };
}

// ---------- Xtream Codes ----------

function xtreamBase(server) {
  let s = String(server || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/(player_api\.php|get\.php|xmltv\.php).*$/i, '').replace(/\/+$/, '');
  return s;
}

function xtream(list) {
  const base = xtreamBase(list.server);
  const u = encodeURIComponent(list.username || '');
  const p = encodeURIComponent(list.password || '');
  const pathU = encodeURIComponent(list.username || '');
  const pathP = encodeURIComponent(list.password || '');
  return {
    base,
    api: (action, extra = '') =>
      fetchJson(`${base}/player_api.php?username=${u}&password=${p}${action ? '&action=' + action : ''}${extra}`),
    live: (id, ext) => `${base}/live/${pathU}/${pathP}/${id}.${ext}`,
    movie: (id, ext) => `${base}/movie/${pathU}/${pathP}/${id}.${ext || 'mp4'}`,
    episode: (id, ext) => `${base}/series/${pathU}/${pathP}/${id}.${ext || 'mp4'}`,
    epg: `${base}/xmltv.php?username=${u}&password=${p}`,
  };
}

function cats(arr) {
  return (Array.isArray(arr) ? arr : []).map((c) => ({ id: String(c.category_id), name: c.category_name || 'Sem nome' }));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function buildFromXtream(list) {
  const x = xtream(list);
  const auth = await x.api('');
  if (!auth || !auth.user_info || Number(auth.user_info.auth) === 0) {
    throw new Error('Usuário ou senha inválidos (o servidor recusou o login).');
  }
  // Uma de cada vez: alivia aparelhos fracos e provedores que limitam conexões.
  // Seção indisponível fica vazia, mas prazo esgotado interrompe e mostra o erro.
  const get = async (action) => {
    try {
      return await x.api(action);
    } catch (err) {
      if (err.timeout) throw err;
      return [];
    }
  };
  // Os 6 pedidos são independentes: em paralelo, a lista carrega no tempo do mais lento, não na soma de todos.
  const [liveCats, liveStreams, vodCats, vodStreams, serCats, serList] = await Promise.all([
    get('get_live_categories'), get('get_live_streams'), get('get_vod_categories'),
    get('get_vod_streams'), get('get_series_categories'), get('get_series'),
  ]);

  const live = (Array.isArray(liveStreams) ? liveStreams : []).map((s) => ({
    id: 'l' + s.stream_id,
    name: s.name || 'Canal',
    logo: s.stream_icon || '',
    cat: String(s.category_id),
    epg: s.epg_channel_id || '',
    url: x.live(s.stream_id, 'm3u8'),
    alt: x.live(s.stream_id, 'ts'),
  }));

  const catName = (arr) => new Map((Array.isArray(arr) ? arr : []).map((c) => [String(c.category_id), c.category_name || '']));
  const vodCatName = catName(vodCats);
  const serCatName = catName(serCats);
  const movieRaw = (Array.isArray(vodStreams) ? vodStreams : []).map((s) => ({
    name: s.name || 'Filme',
    group: vodCatName.get(String(s.category_id)) || '',
    poster: s.stream_icon || '',
    cat: String(s.category_id),
    url: x.movie(s.stream_id, s.container_extension),
    xid: s.stream_id,
    rating: num(s.rating),
    added: Number(s.added) || 0,
    year: num(s.year),
  }));

  // Séries: versões (DUB/LEG) do mesmo título viram um item só; episódios carregam sob demanda.
  const seriesMap = new Map();
  for (const s of Array.isArray(serList) ? serList : []) {
    const group = serCatName.get(String(s.category_id)) || '';
    const { base, label } = splitVersion(s.name || 'Série', group);
    const key = norm(base);
    let g = seriesMap.get(key);
    if (!g) {
      g = {
        id: 's' + hash(key),
        name: base,
        poster: s.cover || '',
        cat: String(s.category_id),
        year: num(String(s.releaseDate || s.release_date || '').slice(0, 4)) || yearOf(base),
        rating: num(s.rating),
        plot: s.plot || '',
        genre: s.genre || '',
        versions: [],
      };
      seriesMap.set(key, g);
    }
    if (!g.poster && s.cover) g.poster = s.cover;
    addVersion(g.versions, { label, xid: s.series_id, group });
  }
  if (!live.length && !movieRaw.length && !seriesMap.size) {
    throw new Error('O servidor não enviou nenhum canal, filme ou série. Tente de novo.');
  }
  const series = [...seriesMap.values()];
  for (const s of series) sortVersions(s.versions);

  return {
    epgUrl: x.epg,
    live: { cats: cats(liveCats), items: live },
    movies: { cats: cats(vodCats), items: mergeMovies(movieRaw) },
    series: { cats: cats(serCats), items: series },
  };
}

function durToSec(v) {
  if (!v) return null;
  if (typeof v === 'number') return v;
  const parts = String(v).split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null;
}

function firstImg(v) {
  if (Array.isArray(v)) return v.find(Boolean) || '';
  return v || '';
}

async function xtreamSeriesInfo(list, xid) {
  const x = xtream(list);
  const data = await x.api('get_series_info', `&series_id=${encodeURIComponent(xid)}`);
  const info = data.info || {};
  let groups = data.episodes || {};
  if (Array.isArray(groups)) {
    const g = {};
    for (const e of groups.flat()) (g[e.season] ||= []).push(e);
    groups = g;
  }
  const seasons = Object.entries(groups)
    .map(([k, eps]) => ({
      num: Number(k),
      eps: (eps || [])
        .map((e) => ({
          id: 'e' + e.id,
          num: Number(e.episode_num) || 0,
          title: e.title || `Episódio ${e.episode_num}`,
          img: e.info?.movie_image || '',
          dur: durToSec(e.info?.duration_secs) || durToSec(e.info?.duration),
          plot: e.info?.plot || '',
          versions: [{ label: 'Versão', url: x.episode(e.id, e.container_extension) }],
        }))
        .sort((a, b) => a.num - b.num),
    }))
    .sort((a, b) => a.num - b.num);
  return {
    plot: info.plot || '',
    genre: info.genre || '',
    cast: info.cast || '',
    director: info.director || '',
    year: num(String(info.releaseDate || info.release_date || '').slice(0, 4)),
    rating: num(info.rating),
    backdrop: firstImg(info.backdrop_path) || info.cover || '',
    trailer: info.youtube_trailer || '',
    seasons,
  };
}

async function xtreamVodInfo(list, xid) {
  const x = xtream(list);
  const data = await x.api('get_vod_info', `&vod_id=${encodeURIComponent(xid)}`);
  const info = data.info || {};
  return {
    plot: info.plot || info.description || '',
    genre: info.genre || '',
    cast: info.cast || info.actors || '',
    director: info.director || '',
    duration: durToSec(info.duration_secs) || durToSec(info.duration),
    year: num(String(info.releasedate || info.release_date || '').slice(0, 4)),
    rating: num(info.rating),
    backdrop: firstImg(info.backdrop_path) || '',
    trailer: info.youtube_trailer || '',
  };
}

// ---------- Status da lista (ativa / expirada / fora do ar) ----------

const STATUS_TIMEOUT = 12000;
const DAY = 24 * 60 * 60 * 1000;

function xtreamFromLink(url) {
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (username && password && /get\.php|player_api\.php/i.test(u.pathname)) {
      return { server: `${u.protocol}//${u.host}`, username, password };
    }
  } catch {}
  return null;
}

async function checkXtream(cfg) {
  const x = xtream(cfg);
  const q = `username=${encodeURIComponent(cfg.username || '')}&password=${encodeURIComponent(cfg.password || '')}`;
  let res;
  try {
    res = await fetchWithTimeout(`${x.base}/player_api.php?${q}`, {}, STATUS_TIMEOUT);
  } catch {
    return { state: 'offline' };
  }
  // Muitos painéis respondem 401/403 quando a conta venceu ou foi bloqueada.
  if (res.status === 401 || res.status === 403) return { state: 'refused', http: res.status };
  if (!res.ok) return { state: 'offline', http: res.status };
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return { state: 'offline' };
  }
  const info = data && data.user_info;
  if (!info || Number(info.auth) === 0) return { state: 'refused' };
  const status = String(info.status || '').toLowerCase();
  const expSec = Number(info.exp_date);
  const expires = Number.isFinite(expSec) && expSec > 0 ? expSec * 1000 : null;
  const extra = {
    expires,
    activeCons: info.active_cons != null ? Number(info.active_cons) : null,
    maxCons: info.max_connections != null ? Number(info.max_connections) : null,
  };
  if (status === 'expired' || (expires && expires <= Date.now())) return { state: 'expired', ...extra };
  if (status === 'banned') return { state: 'banned', ...extra };
  if (status === 'disabled') return { state: 'disabled', ...extra };
  if (expires && expires - Date.now() <= 3 * DAY) return { state: 'expiring', ...extra };
  return { state: 'active', ...extra };
}

// Link M3U: basta ver se o servidor ainda entrega uma playlist (não baixa a lista inteira).
async function checkM3uLink(url) {
  let res;
  try {
    res = await fetchWithTimeout(url, {}, STATUS_TIMEOUT);
  } catch {
    return { state: 'offline' };
  }
  const stop = () => { try { res.body && res.body.cancel(); } catch {} };
  if (res.status === 401 || res.status === 403) { stop(); return { state: 'refused', http: res.status }; }
  if (!res.ok || !res.body) { stop(); return { state: 'offline', http: res.status }; }
  const reader = res.body.getReader();
  let head = '';
  try {
    while (head.length < 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      head += Buffer.from(value).toString('utf8');
    }
  } catch {
    return { state: 'offline' };
  } finally {
    reader.cancel().catch(() => {});
  }
  return /^\uFEFF?\s*#EXTM3U/i.test(head) ? { state: 'active' } : { state: 'refused' };
}

async function checkStatus(list) {
  let result;
  if (list.type === 'xtream') result = await checkXtream(list);
  else if (list.source === 'file') result = { state: 'local' };
  else {
    const cfg = xtreamFromLink(list.url);
    result = cfg ? await checkXtream(cfg) : await checkM3uLink(list.url);
  }
  return { ...result, checkedAt: Date.now() };
}

// ---------- Cache ----------

const memory = new Map(); // id -> catalog
const inflight = new Map(); // id -> Promise

async function build(list) {
  let data;
  if (list.type === 'xtream') {
    data = await buildFromXtream(list);
  } else if (list.source === 'file') {
    let text;
    try {
      text = fs.readFileSync(store.file(`m3u-${list.id}.m3u`), 'utf8');
    } catch {
      throw new Error('O arquivo desta lista não foi encontrado. Edite a lista e envie o arquivo de novo.');
    }
    data = buildFromM3U(text, list);
  } else {
    data = buildFromM3U(await fetchText(list.url), list);
  }
  const catalog = { v: 1, listId: list.id, updatedAt: Date.now(), ...data };
  store.writeJson(`catalog-${list.id}.json`, catalog);
  memory.set(list.id, catalog);
  return catalog;
}

function refresh(list) {
  if (!inflight.has(list.id)) {
    const p = build(list).finally(() => inflight.delete(list.id));
    inflight.set(list.id, p);
  }
  return inflight.get(list.id);
}

async function getCatalog(list, { force = false } = {}) {
  if (force) return { catalog: await refresh(list), refreshing: false };
  let cached = memory.get(list.id) || store.readJson(`catalog-${list.id}.json`, null);
  if (cached) {
    memory.set(list.id, cached);
    const stale = Date.now() - cached.updatedAt > STALE_MS;
    if (stale) refresh(list).catch(() => {});
    return { catalog: cached, refreshing: stale || inflight.has(list.id) };
  }
  return { catalog: await refresh(list), refreshing: false };
}

function isRefreshing(id) {
  return inflight.has(id);
}

function forget(id) {
  memory.delete(id);
}

module.exports = {
  getCatalog,
  isRefreshing,
  forget,
  xtreamSeriesInfo,
  xtreamVodInfo,
  checkStatus,
  // exportados para testes
  splitVersion,
  parseEpisode,
  buildFromM3U,
};
