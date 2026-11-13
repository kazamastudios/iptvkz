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

// Mesma conta em vários endereços: o principal primeiro, depois os reservas (list.servers), sem repetir.
function serversOf(list) {
  const all = [list.server, ...(Array.isArray(list.servers) ? list.servers : [])].map((s) => String(s || '').trim()).filter(Boolean);
  // cada endereço passa pelo conserto (http errado, get.php, texto em volta); o que não der para ler fica como veio
  return [...new Set(all.flatMap((s) => { const p = fixServers(s); return p.length ? p : [xtreamBase(s)]; }))];
}

// O mesmo conserto da tela (parseServers em views/lists.js): vários endereços num texto, http faltando ou
// digitado errado (htp://, http:/, https//), barra no fim, link get.php inteiro.
function fixServers(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\s,;|]+/)) {
    let t = raw.replace(/^[<("'[]+/, '').replace(/[>)"'\].,;:]+$/, '');
    if (!t) continue;
    let https = false;
    const sch = t.match(/^h?t{1,2}p{1,2}(s?)(?:[:;.]+\/*|\/+)/i);
    if (sch) { https = !!sch[1]; t = t.slice(sch[0].length); }
    t = t.replace(/^\/+/, '');
    const m = t.match(/^([^/?#]+)([^?#]*)/);
    if (!m) continue;
    const hostPort = m[1].toLowerCase().replace(/\.+$/, '');
    const path = m[2].replace(/\/(get|player_api|xmltv)\.php.*$/i, '').replace(/\/+$/, '');
    const [host, port, more] = hostPort.split(':');
    if (more !== undefined || !/^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,})$/.test(host)) continue;
    if (port !== undefined && !/^\d{1,5}$/.test(port)) continue;
    const s = `${https ? 'https' : 'http'}://${hostPort}${path}`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

// Endereço que respondeu na última carga da lista (o principal ou um reserva); as consultas seguintes usam ele.
const activeBase = new Map(); // id da lista -> base

function xtream(list) {
  const act = list.id && activeBase.get(list.id);
  const all = serversOf(list);
  const base = act && all.includes(act) ? act : all[0] || xtreamBase(list.server);
  const u = encodeURIComponent(list.username || '');
  const p = encodeURIComponent(list.password || '');
  const pathU = encodeURIComponent(list.username || '');
  const pathP = encodeURIComponent(list.password || '');
  return {
    base,
    api: (action, extra = '', opts) =>
      fetchJson(`${base}/player_api.php?username=${u}&password=${p}${action ? '&action=' + action : ''}${extra}`, opts),
    live: (id, ext) => `${base}/live/${pathU}/${pathP}/${id}.${ext}`,
    movie: (id, ext) => `${base}/movie/${pathU}/${pathP}/${id}.${ext || 'mp4'}`,
    episode: (id, ext) => `${base}/series/${pathU}/${pathP}/${id}.${ext || 'mp4'}`,
    epg: `${base}/xmltv.php?username=${u}&password=${p}`,
  };
}

// Nomes de categoria mais curtos: muitas listas repetem a seção em todas as categorias, cada uma do seu jeito
// ("FILMES | DC", "SERIES - DC", "CANAIS: ESPORTES", "[VOD] Ação", "DC | FILMES"). Em cada seção o app procura o
// trecho que a maioria das categorias repete (no começo ou no fim, com separador ou entre colchetes) e só tira esse.
// Lista sem padrão fica como está; nunca deixa nome vazio ou repetido. Vale para Xtream e M3U, em todo aparelho, e
// também para listas já baixadas (é aplicado ao abrir o catálogo).
const CAT_FORMS = [
  ['pre', /^\s*([^|:\-–•»\/[\]()]{1,24}?)\s*[|:\-–•»\/]+\s*(\S.*)$/], // FILMES | DC
  ['pre', /^\s*[[(]([^|:\-–•»\/[\]()]{1,24}?)[\])]\s*[|:\-–•»\/]*\s*(\S.*)$/], // [FILMES] DC
  ['suf', /^(.*?\S)\s*[|:\-–•»\/]+\s*([^|:\-–•»\/[\]()]{1,24}?)\s*$/], // DC | FILMES
  ['suf', /^(.*?\S)\s*[[(]([^|:\-–•»\/[\]()]{1,24}?)[\])]\s*$/], // DC (FILMES)
];
const foldName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// cada forma que o nome casa: [chave do padrão, nome sem o trecho]
function catParts(name) {
  const out = [];
  for (const [kind, re] of CAT_FORMS) {
    const m = re.exec(name || '');
    if (!m) continue;
    const tag = kind === 'pre' ? m[1] : m[2];
    const rest = (kind === 'pre' ? m[2] : m[1]).trim();
    if (rest) out.push([`${kind}:${foldName(tag)}`, rest]);
  }
  return out;
}
// O nome da própria seção repetido na categoria não diz nada: sai mesmo quando não é a maioria
const SECTION_WORDS = {
  live: ['canais', 'canal', 'tv', 'live', 'ao vivo', 'tv ao vivo'],
  movies: ['filmes', 'filme', 'movies', 'movie', 'vod'],
  series: ['series', 'serie', 'tv shows', 'shows'],
};
function tidyCats(list, section) {
  if (!Array.isArray(list) || !list.length) return list;
  const own = new Set((SECTION_WORDS[section] || []).flatMap((w) => [`pre:${w}`, `suf:${w}`]));
  const count = new Map();
  for (const c of list) for (const key of new Set(catParts(c.name).map((p) => p[0]))) count.set(key, (count.get(key) || 0) + 1);
  let best = null;
  for (const [k, n] of count) if (!best || n > best[1]) best = [k, n];
  const keys = new Set([...count.keys()].filter((k) => own.has(k)));
  if (best && best[1] >= 3 && best[1] >= list.length * 0.5) keys.add(best[0]);
  if (!keys.size) return list;
  const cut = (name) => { const p = catParts(name).find((x) => keys.has(x[0])); return p ? p[1] : null; };
  const seen = new Map();
  for (const c of list) { const n = cut(c.name); if (n) seen.set(foldName(n), (seen.get(foldName(n)) || 0) + 1); }
  // também não pode virar o nome de outra categoria que já existe sem o trecho
  for (const c of list) if (!cut(c.name)) seen.set(foldName(c.name), (seen.get(foldName(c.name)) || 0) + 1);
  return list.map((c) => {
    const n = cut(c.name);
    return n && seen.get(foldName(n)) === 1 ? { ...c, name: n } : c;
  });
}
function tidyCatalog(c) {
  for (const k of ['live', 'movies', 'series']) if (c && c[k] && c[k].cats) c[k].cats = tidyCats(c[k].cats, k);
  return c;
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
  const prog = progress.get(list.id);
  const sizes = {}; // bytes recebidos de cada pedido (vários ao mesmo tempo no PC)
  const onProgress = (action) => (got) => {
    sizes[action] = got;
    if (prog) prog.got = Object.values(sizes).reduce((a, b) => a + b, 0);
  };
  const t0 = Date.now();
  const timing = {}; // quanto levou cada pedido (aparece no modo de depuração)
  const auth = await x.api('');
  timing.login = Date.now() - t0;
  if (!auth || !auth.user_info || Number(auth.user_info.auth) === 0) {
    throw new Error('Usuário ou senha inválidos (o servidor recusou o login).');
  }
  // Uma de cada vez: alivia aparelhos fracos e provedores que limitam conexões.
  // Seção indisponível fica vazia, mas prazo esgotado interrompe e mostra o erro.
  const get = async (action) => {
    const t = Date.now();
    try {
      return await x.api(action, '', { onProgress: onProgress(action) });
    } catch (err) {
      if (err.timeout) throw err;
      return [];
    } finally {
      timing[action.replace(/^get_/, '')] = Date.now() - t;
    }
  };
  // Os 6 pedidos são independentes. No PC saem em paralelo (a lista carrega no tempo do mais lento). Em aparelho
  // com pouca memória (TV LG, TV Box) saem um de cada vez: as respostas grandes chegando juntas travavam a TV.
  const actions = ['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series'];
  let results;
  if (require('os').totalmem() > 3 * 1024 ** 3) results = await Promise.all(actions.map(get));
  else {
    // pouca memória: as 3 listas de categorias (pequenas) juntas, e as 3 grandes uma de cada vez
    const small = actions.filter((a) => a.endsWith('categories'));
    const smallRes = await Promise.all(small.map(get));
    const got = new Map(small.map((a, i) => [a, smallRes[i]]));
    for (const a of actions) if (!got.has(a)) got.set(a, await get(a));
    results = actions.map((a) => got.get(a));
  }
  timing.download = Date.now() - t0;
  if (prog) prog.phase = 'build';
  timing.parallel = require('os').totalmem() > 3 * 1024 ** 3;
  const [liveCats, liveStreams, vodCats, vodStreams, serCats, serList] = results;

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

  timing.total = Date.now() - t0;
  return {
    timing,
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

async function checkXtream(cfg, timeout = STATUS_TIMEOUT) {
  const x = xtream(cfg);
  const q = `username=${encodeURIComponent(cfg.username || '')}&password=${encodeURIComponent(cfg.password || '')}`;
  let res;
  try {
    res = await fetchWithTimeout(`${x.base}/player_api.php?${q}`, {}, timeout);
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

// Teste de velocidade dos servidores da mesma conta: um de cada vez (leve para a TV e para o provedor),
// mede quanto cada um leva para responder ao login. Devolve na ordem da lista; "fastest" é o índice do melhor.
async function speedTest(cfg) {
  const out = [];
  for (let server of serversOf(cfg)) {
    let t0 = Date.now();
    let r = await checkXtream({ server, username: cfg.username, password: cfg.password }, 8000);
    if (r.state === 'offline') {
      // talvez o endereço seja https (ou http) e foi digitado do outro jeito
      const other = server.startsWith('https://') ? server.replace(/^https/, 'http') : server.replace(/^http/, 'https');
      t0 = Date.now();
      const r2 = await checkXtream({ server: other, username: cfg.username, password: cfg.password }, 8000);
      if (r2.state !== 'offline') { server = other; r = r2; }
    }
    const ok = ['active', 'expiring'].includes(r.state);
    if (!out.some((x) => x.server === server)) out.push({ server, state: r.state, ms: ok ? Date.now() - t0 : null });
  }
  let fastest = -1;
  out.forEach((r, i) => { if (r.ms != null && (fastest < 0 || r.ms < out[fastest].ms)) fastest = i; });
  return { results: out, fastest };
}

async function checkStatus(list) {
  let result;
  if (list.type === 'xtream') result = await checkXtream({ server: list.server, username: list.username, password: list.password });
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
// Andamento do carregamento, para a tela mostrar que está andando: id -> { phase, got, total, at }
// phase: 'download' (baixando do provedor) ou 'build' (organizando canais, filmes e séries)
const progress = new Map();

async function build(list) {
  progress.set(list.id, { phase: 'download', got: 0, total: 0, at: Date.now() });
  try {
    return await buildNow(list);
  } finally {
    progress.delete(list.id);
  }
}

async function buildNow(list) {
  const prog = progress.get(list.id);
  let data;
  if (list.type === 'xtream') {
    // Fora do ar? tenta os servidores reservas da mesma conta, na ordem
    let firstErr = null;
    for (const s of serversOf(list)) {
      activeBase.set(list.id, s);
      try {
        data = { ...(await buildFromXtream(list)), base: s };
        break;
      } catch (e) {
        if (!firstErr) firstErr = e;
      }
    }
    if (!data) { activeBase.delete(list.id); throw firstErr || new Error('Servidor não respondeu'); }
  } else if (list.source === 'file') {
    let text;
    try {
      text = fs.readFileSync(store.file(`m3u-${list.id}.m3u`), 'utf8');
    } catch {
      throw new Error('O arquivo desta lista não foi encontrado. Edite a lista e envie o arquivo de novo.');
    }
    prog.phase = 'build';
    data = buildFromM3U(text, list);
  } else {
    const text = await fetchText(list.url, { onProgress: (got, total) => Object.assign(prog, { got, total }) });
    prog.phase = 'build';
    // deixa a tela receber o "organizando" antes de o servidor ficar ocupado montando o catálogo
    await new Promise((r) => setTimeout(r, 50));
    data = buildFromM3U(text, list);
  }
  const catalog = tidyCatalog({ v: 1, listId: list.id, updatedAt: Date.now(), ...data });
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
    tidyCatalog(cached); // listas baixadas antes da limpeza dos nomes
    memory.set(list.id, cached);
    if (cached.base && !activeBase.has(list.id)) activeBase.set(list.id, cached.base);
    const stale = Date.now() - cached.updatedAt > STALE_MS;
    if (stale) refresh(list).catch(() => {});
    return { catalog: cached, refreshing: stale || inflight.has(list.id) };
  }
  return { catalog: await refresh(list), refreshing: false };
}

function isRefreshing(id) {
  return inflight.has(id);
}

function progressOf(id) {
  const p = progress.get(id);
  return p ? { phase: p.phase, got: p.got, total: p.total, secs: Math.round((Date.now() - p.at) / 1000) } : null;
}

// data da versão guardada, sem ler o arquivo do catálogo (dezenas de MB) só para isso
function updatedAtOf(id) {
  const m = memory.get(id);
  if (m) return m.updatedAt;
  const c = store.readJson(`catalog-${id}.json`, null);
  return c ? c.updatedAt : null;
}

function forget(id) {
  memory.delete(id);
}

module.exports = {
  getCatalog,
  speedTest,
  isRefreshing,
  progressOf,
  updatedAtOf,
  forget,
  xtreamSeriesInfo,
  xtreamVodInfo,
  checkStatus,
  // exportados para testes
  splitVersion,
  parseEpisode,
  buildFromM3U,
};
