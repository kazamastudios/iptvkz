// Baixa listas (M3U ou Xtream) e normaliza tudo num catálogo único:
// { live, movies, series } cada um com { cats: [{id,name}], items: [...] }.
const fs = require('fs');
const { hash, norm, fetchJson, fetchWithTimeout, streamLines, safeHost } = require('./util');
const store = require('./store');
const diag = require('./diag');

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

// Só os atributos que o app usa, achados com indexOf: numa lista de 60 MB, ler todos com expressão regular
// pesava segundos no celular e na TV. Sem nenhum deles (nomes em maiúsculas, raro), cai no jeito completo.
const EXTINF_KEYS = ['tvg-logo', 'group-title', 'tvg-id', 'tvg-name'];
function quickAttrs(head) {
  const attrs = {};
  let found = false;
  for (const k of EXTINF_KEYS) {
    let at = head.indexOf(k + '="');
    // precisa ser o nome inteiro ("tvg-id" não pode casar dentro de "x-tvg-id")
    while (at > 0 && !/\s/.test(head[at - 1])) at = head.indexOf(k + '="', at + 1);
    if (at < 0) continue;
    const from = at + k.length + 2;
    const end = head.indexOf('"', from);
    if (end >= 0) { attrs[k] = head.slice(from, end); found = true; }
  }
  return found || head.indexOf('="') < 0 ? attrs : parseAttrs(head);
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
  const attrs = quickAttrs(head);
  return { name: name || attrs['tvg-name'] || 'Sem nome', attrs, group: attrs['group-title'] || '' };
}

// Lê o M3U linha a linha e entrega cada item a onEntry, sem montar uma lista com todos (numa lista de 60 MB eram
// 268 mil objetos a mais na memória). A cada lote de linhas dá uma pausa: o servidor continua respondendo (andamento,
// outras telas) enquanto monta, em vez de ficar travado do começo ao fim.
const SCAN_BATCH = 20000;
const pause = () => new Promise((r) => setImmediate(r));
// Leitor de M3U que recebe uma linha de cada vez: serve tanto para o arquivo inteiro (scanM3U) quanto para o
// download, que entrega as linhas enquanto chegam (a montagem anda junto com o download).
function m3uReader(onEntry) {
  const header = {};
  let count = 0;
  let cur = null;
  let first = true;
  return {
    header,
    get count() { return count; },
    line(raw) {
      let line = raw;
      if (first) {
        first = false;
        if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      }
      line = line.trim();
      if (!line) return;
      if (line.startsWith('#EXTM3U')) {
        Object.assign(header, parseAttrs(line));
        return;
      }
      if (line.startsWith('#EXTINF')) {
        cur = parseExtinf(line);
        return;
      }
      if (line.startsWith('#EXTGRP:')) {
        if (cur && !cur.group) cur.group = line.slice(8).trim();
        return;
      }
      if (line.startsWith('#')) return;
      if (cur) {
        cur.url = line;
        onEntry(cur);
        count++;
        cur = null;
      } else if (/^https?:\/\//i.test(line)) {
        onEntry({ name: line, attrs: {}, group: '', url: line });
        count++;
      }
    },
  };
}

// O texto inteiro (arquivo enviado): linha a linha sem copiar o texto (replace ou split duplicavam 60 MB).
async function scanM3U(text, onEntry) {
  const r = m3uReader(onEntry);
  let pos = 0;
  let lines = 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    r.line(text.slice(pos, nl));
    pos = nl + 1;
    if (++lines % SCAN_BATCH === 0) await pause();
  }
  return r;
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

const NO_VERSION = { base: '', label: '' };
const KIND_RE = /\/(series|movie)\//i;

// Monta canais, filmes e séries a partir dos itens do M3U, um de cada vez (entry); finish fecha o catálogo.
function m3uBuilder() {
  const liveCats = catCollector();
  const movieCats = catCollector();
  const seriesCats = catCollector();
  const live = [];
  const movieRaw = [];
  const seriesMap = new Map();
  const liveSeen = new Set();

  const entry = (e) => {
    const url = e.url;
    const logo = e.attrs['tvg-logo'] || '';
    const path = KIND_RE.exec(url);
    let kind = 'live';
    if (path) kind = path[1].toLowerCase() === 'series' ? 'series' : 'movie';
    else if (VOD_EXT.has(urlExt(url))) kind = 'vod';

    // canal não tem versões, e filme separa as versões depois (mergeMovies): só série e vídeo solto precisam aqui
    const { base, label } = kind === 'live' || kind === 'movie' ? NO_VERSION : splitVersion(e.name, e.group);
    const epInfo = kind === 'live' || kind === 'movie' ? null : parseEpisode(base);
    if (kind === 'vod') kind = epInfo ? 'series' : 'movie';

    if (kind === 'live') {
      let id = 'l' + hash(url + '|' + e.name);
      if (liveSeen.has(id)) return;
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
  };
  // reader: o leitor que entregou os itens (cabeçalho e quantidade); head: o começo do texto recebido
  const finish = (reader, head) => {
    const { header, count } = reader;
    if (!count) {
      // o provedor às vezes responde uma página (aviso, login, erro) no lugar da lista
      if (/^\s*</.test(head)) throw new Error('O provedor respondeu uma página, não uma lista M3U. Confira o link com o seu provedor.');
      throw new Error('A lista está vazia ou não é um arquivo M3U válido.');
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
  };
  return { entry, finish };
}

// M3U já inteiro na memória (arquivo enviado pela pessoa).
async function buildFromM3U(text, list) {
  const b = m3uBuilder(list);
  const reader = await scanM3U(text, b.entry);
  return b.finish(reader, text.slice(0, 200));
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

// id da categoria -> nome, para separar versões (DUB/LEG) pelo nome da categoria
function catName(arr) {
  return new Map((Array.isArray(arr) ? arr : []).map((c) => [String(c.category_id), c.category_name || '']));
}

function cats(arr) {
  return (Array.isArray(arr) ? arr : []).map((c) => ({ id: String(c.category_id), name: c.category_name || 'Sem nome' }));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function buildFromXtream(list, { first, onSection } = {}) {
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
  // Cada seção (canais, filmes, séries) são 2 pedidos: as categorias e os itens. A seção fica pronta assim que os
  // dois chegam e vai na hora para a tela (onSection), sem esperar as outras: quem está em Filmes vê os filmes
  // enquanto as séries ainda baixam. A seção da tela atual (first) é pedida primeiro.
  // No PC os 6 pedidos saem em paralelo. Em aparelho com pouca memória (TV LG, TV Box) as categorias (pequenas)
  // saem juntas e as 3 listas grandes uma de cada vez: as respostas grandes chegando juntas travavam a TV.
  const PAIRS = {
    live: ['get_live_categories', 'get_live_streams'],
    movies: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series'],
  };
  const order = [first, 'live', 'movies', 'series'].filter((k, i, a) => PAIRS[k] && a.indexOf(k) === i);
  const make = {
    live: (liveCats, liveStreams) => ({
      cats: cats(liveCats),
      items: (Array.isArray(liveStreams) ? liveStreams : []).map((s) => ({
        id: 'l' + s.stream_id,
        name: s.name || 'Canal',
        logo: s.stream_icon || '',
        cat: String(s.category_id),
        epg: s.epg_channel_id || '',
        url: x.live(s.stream_id, 'm3u8'),
        alt: x.live(s.stream_id, 'ts'),
      })),
    }),
    movies: (vodCats, vodStreams) => {
      const vodCatName = catName(vodCats);
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
      return { cats: cats(vodCats), items: mergeMovies(movieRaw) };
    },
    // Séries: versões (DUB/LEG) do mesmo título viram um item só; episódios carregam sob demanda.
    series: (serCats, serList) => {
      const serCatName = catName(serCats);
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
      const series = [...seriesMap.values()];
      for (const s of series) sortVersions(s.versions);
      return { cats: cats(serCats), items: series };
    },
  };
  const out = {};
  const finish = (sec, catsRes, itemsRes) => {
    const data = make[sec](catsRes, itemsRes);
    data.cats = tidyCats(data.cats, sec);
    out[sec] = data;
    if (onSection) onSection(sec, data, { epgUrl: x.epg });
  };
  const parallel = require('os').totalmem() > 3 * 1024 ** 3;
  if (parallel) {
    await Promise.all(order.map(async (sec) => {
      const [c, items] = await Promise.all(PAIRS[sec].map(get));
      finish(sec, c, items);
    }));
  } else {
    const catsRes = await Promise.all(order.map((sec) => get(PAIRS[sec][0])));
    for (let i = 0; i < order.length; i++) finish(order[i], catsRes[i], await get(PAIRS[order[i]][1]));
  }
  timing.download = Date.now() - t0;
  timing.parallel = parallel;
  if (prog) prog.phase = 'build';
  if (!out.live.items.length && !out.movies.items.length && !out.series.items.length) {
    throw new Error('O servidor não enviou nenhum canal, filme ou série. Tente de novo.');
  }
  timing.total = Date.now() - t0;
  return { timing, epgUrl: x.epg, live: out.live, movies: out.movies, series: out.series };
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
// Seções já prontas de uma lista ainda baixando (Xtream): id -> { meta, done: { live, movies, series }, waiters }
const building = new Map();
const SECTIONS = ['live', 'movies', 'series'];

// Catálogo em texto, por seção: a tela pede uma seção de cada vez (a da tela atual primeiro), e cada uma é
// convertida uma vez só. meta: os outros campos, sem as chaves de fora. memo: gzip de cada resposta.
const partsCache = new WeakMap();
function partsOf(catalog) {
  let parts = partsCache.get(catalog);
  if (!parts) {
    const meta = {};
    for (const k of Object.keys(catalog)) if (!SECTIONS.includes(k)) meta[k] = catalog[k];
    parts = { meta: JSON.stringify(meta).slice(1, -1), memo: {} };
    for (const k of SECTIONS) parts[k] = JSON.stringify(catalog[k] || { cats: [], items: [] });
    partsCache.set(catalog, parts);
  }
  return parts;
}
// Converte uma seção em texto aos poucos (lotes de itens), com pausas: o servidor continua respondendo. O resultado
// é igual ao JSON.stringify da seção inteira de uma vez.
async function sectionText(sec) {
  if (!sec) return '{"cats":[],"items":[]}';
  const out = [];
  for (const k of Object.keys(sec)) {
    if (sec[k] === undefined) continue;
    if (k !== 'items' || !Array.isArray(sec.items)) { out.push(`${JSON.stringify(k)}:${JSON.stringify(sec[k])}`); continue; }
    const pieces = [];
    for (let i = 0; i < sec.items.length; i += 2000) {
      pieces.push(sec.items.slice(i, i + 2000).map((x) => JSON.stringify(x)).join(','));
      await pause();
    }
    out.push(`"items":[${pieces.join(',')}]`);
  }
  return `{${out.join(',')}}`;
}

// Igual a partsOf, mas aos poucos (usado logo depois de montar a lista).
async function prepareParts(catalog) {
  const meta = {};
  for (const k of Object.keys(catalog)) if (!SECTIONS.includes(k)) meta[k] = catalog[k];
  const parts = { meta: JSON.stringify(meta).slice(1, -1), memo: {} };
  for (const k of SECTIONS) parts[k] = await sectionText(catalog[k] || { cats: [], items: [] });
  partsCache.set(catalog, parts);
  return parts;
}

// o catálogo inteiro em texto (arquivo e resposta completa), montado das partes
function fullText(catalog) {
  const parts = partsOf(catalog);
  return `{${parts.meta}${SECTIONS.map((k) => `,"${k}":${parts[k]}`).join('')}}`;
}

async function build(list, opts = {}) {
  progress.set(list.id, { phase: 'download', got: 0, total: 0, at: Date.now() });
  try {
    return await buildNow(list, opts);
  } finally {
    progress.delete(list.id);
  }
}

// O que o provedor mandou para identificar a versão da lista (ETag, Last-Modified), guardado no resumo. src: de
// qual endereço veio (hash), para não perguntar ao provedor por uma lista que foi trocada ao editar.
function validatorsOf(list, r) {
  if (!r.etag && !r.lastModified) return null;
  return { src: hash(list.url), etag: r.etag || null, lastModified: r.lastModified || null };
}

// Cabeçalhos para perguntar ao provedor se a lista mudou desde a versão guardada (prev), ou null.
function conditionalHeaders(list, prev) {
  const v = prev && prev.files && prev.validators;
  if (!v || v.src !== hash(list.url)) return null;
  // as seções guardadas precisam estar inteiras no disco, senão não há o que manter
  if (!SECTIONS.every((k) => fs.existsSync(store.file(secName(list.id, prev.files, k))))) return null;
  const h = {};
  if (v.etag) h['If-None-Match'] = v.etag;
  if (v.lastModified) h['If-Modified-Since'] = v.lastModified;
  return h;
}

// A lista não mudou (304): mantém as seções guardadas e só renova a data no resumo (troca atômica), para não
// perguntar de novo logo. Devolve o resumo renovado, ou null se a lista foi excluída enquanto isso.
function keepUnchanged(list, prev, stamp, r) {
  if (!store.getList(list.id)) return null;
  const light = Object.assign({}, prev, { updatedAt: stamp });
  // o provedor pode mandar validadores novos junto com o 304
  const v = validatorsOf(list, r);
  if (v) light.validators = { src: v.src, etag: v.etag || prev.validators.etag, lastModified: v.lastModified || prev.validators.lastModified };
  store.writeText(metaName(list.id), JSON.stringify(light));
  partsCache.set(light, diskParts(list.id, light));
  memory.set(list.id, light);
  return light;
}

// full: baixa a lista inteira mesmo que o provedor diga que não mudou (sem If-None-Match / If-Modified-Since).
async function buildNow(list, { first, onSection, full = false, stamp = Date.now() } = {}) {
  const prog = progress.get(list.id);
  // medições (modo de depuração): pico de memória e maior tempo com o servidor travado
  const mem = diag.memPeak();
  const loop = diag.loopWatch();
  let data;
  if (list.type === 'xtream') {
    // Fora do ar? tenta os servidores reservas da mesma conta, na ordem
    let firstErr = null;
    for (const s of serversOf(list)) {
      activeBase.set(list.id, s);
      try {
        const section = onSection && ((sec, d, meta) => onSection(sec, d, { v: 1, listId: list.id, updatedAt: stamp, base: s, ...meta }));
        data = { ...(await buildFromXtream(list, { first, onSection: section })), base: s };
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
    data = await buildFromM3U(text, list);
  } else {
    // Monta enquanto baixa: cada linha vai para a montagem assim que chega, sem guardar o texto da lista (60 MB a
    // menos na memória), e o download e a montagem acontecem ao mesmo tempo. No fim só falta fechar o catálogo.
    // Atualizando uma lista já guardada: pergunta antes se ela mudou (ETag / Last-Modified da última vez). Provedor
    // que ignora esses cabeçalhos responde 200 com a lista inteira, e segue como sempre.
    const prev = full ? null : memory.get(list.id) || readMeta(list.id);
    const headers = conditionalHeaders(list, prev);
    const t0 = Date.now();
    const b = m3uBuilder(list);
    const reader = m3uReader(b.entry);
    let bytes = 0;
    const r = await streamLines(list.url, (line) => reader.line(line), {
      headers,
      onProgress: (got, total) => { bytes = got; Object.assign(prog, { got, total }); },
    });
    if (r.notModified && headers) {
      loop.stop();
      diag.last.build = { listId: list.id, at: Date.now(), naoMudou: true, download: Date.now() - t0 };
      const kept = keepUnchanged(list, prev, stamp, r);
      if (kept) return kept;
      throw new Error('A lista foi excluída');
    }
    // 304 sem termos perguntado: resposta estranha, não há lista para montar
    if (r.notModified) throw new Error(`O servidor respondeu 304 sem lista (${safeHost(list.url)})`);
    const { head } = r;
    const download = Date.now() - t0;
    mem.read();
    prog.phase = 'build';
    // deixa a tela receber o "organizando" antes de fechar o catálogo
    await new Promise((r) => setTimeout(r, 50));
    const t1 = Date.now();
    data = b.finish(reader, head);
    // download (já com a leitura dos itens) e o fechamento (aparece no modo de depuração, como no Xtream)
    data.timing = { download, montar: Date.now() - t1, MB: Math.round(bytes / 1048576) };
    const validators = validatorsOf(list, r);
    if (validators) data.validators = validators;
  }
  mem.read();
  // o Xtream já limpou os nomes das categorias seção por seção (e já mandou para a tela assim)
  const catalog = { v: 1, listId: list.id, updatedAt: stamp, ...data };
  if (list.type !== 'xtream') tidyCatalog(catalog);
  // converte uma vez só: o mesmo texto vai para o arquivo e para as respostas à tela (partsOf)
  const t2 = Date.now();
  const parts = await prepareParts(catalog);
  const converter = Date.now() - t2;
  mem.read();
  const travado = loop.stop();
  if (catalog.timing) {
    // o texto já foi gerado sem estes números: valem para /api/diag e para a tela a partir da próxima abertura
    Object.assign(catalog.timing, { converter, memMB: mem.peak(), travadoMs: travado });
  }
  diag.last.build = { listId: list.id, at: Date.now(), ...(catalog.timing || {}), converter, memMB: mem.peak(), travadoMs: travado };
  // Depois de convertido, o servidor só entrega o texto das seções: os itens montados saem da memória (numa lista
  // de 60 MB são centenas de MB, e era o que derrubava o app em aparelho de 2 GB). Fica só o resumo com as partes.
  const light = lightOf(catalog);
  // Encolheu muito em relação à versão anterior (menos de 30% dos itens)? Pode ser mudança do provedor (plano,
  // conteúdo) ou um problema dele. A nova vale, mas a anterior fica guardada e a tela oferece voltar a ela.
  const prev = memory.get(list.id) || readMeta(list.id);
  const total = (c) => (c && c.counts ? c.counts.live + c.counts.movies + c.counts.series : 0);
  if (prev && prev.files && total(prev) >= 50 && total(light) < total(prev) * 0.3) {
    const { prev: _p, shrunk: _s, ...older } = prev;
    light.prev = older;
    light.shrunk = { before: total(prev), after: total(light) };
  }
  // o resumo que vai para a tela leva as medições e o aviso acima
  parts.meta = JSON.stringify(light).slice(1, -1);
  partsCache.set(light, parts);
  memory.set(list.id, light);
  // grava um arquivo por seção, por trás (a tela não espera o armazenamento)
  saveFiles(list.id, light, parts).catch((e) => console.error('gravar catálogo', list.id, e.message));
  return light;
}

// o resumo do catálogo: tudo menos as seções
function lightOf(catalog) {
  const light = {};
  for (const k of Object.keys(catalog)) if (!SECTIONS.includes(k)) light[k] = catalog[k];
  const n = (k) => (catalog[k] && Array.isArray(catalog[k].items) ? catalog[k].items.length : 0);
  light.counts = { live: n('live'), movies: n('movies'), series: n('series') };
  return light;
}

// ---------- Catálogo no disco: um arquivo por seção ----------
// catalog-<id>.meta.json: o resumo (data, guia, servidor, medições) e o carimbo das seções em uso (files).
// catalog-<id>.<carimbo>.<seção>.json: o texto de cada seção, entregue à tela como está (sem interpretar).
// Ao abrir com o app fechado, o servidor lê só o resumo e, quando a tela pede, só o arquivo daquela seção: antes lia
// e interpretava o catálogo inteiro (5,5 s travado no Mecool com uma lista de 60 MB).
// Uma carga nova grava as seções com outro carimbo e só no fim troca o resumo (gravação atômica): quem abrir no
// meio vê o conjunto anterior inteiro. Depois apaga os conjuntos antigos e o arquivo do formato antigo
// (catalog-<id>.json, com tudo junto).
const metaName = (id) => `catalog-${id}.meta.json`;
const secName = (id, files, sec) => `catalog-${id}.${files}.${sec}.json`;
const legacyName = (id) => `catalog-${id}.json`;
const fsCall = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (e, r) => (e ? reject(e) : resolve(r))));
let saveSeq = 0;

async function saveFiles(id, light, parts) {
  const files = `${light.updatedAt}-${++saveSeq}`;
  for (const k of SECTIONS) await fsCall(fs.writeFile, store.file(secName(id, files, k)), parts[k]);
  const dropOurs = () => SECTIONS.forEach((k) => fs.unlink(store.file(secName(id, files, k)), () => {}));
  // a lista foi excluída (ou trocada por outra carga) enquanto gravava: não deixa arquivos para trás
  if (!store.getList(id) || memory.get(id) !== light) return dropOurs();
  store.writeText(metaName(id), JSON.stringify({ ...light, files }));
  light.files = files;
  // a partir daqui, as seções vêm do disco: o texto sai da memória
  partsCache.set(light, diskParts(id, light));
  // conjuntos antigos, temporários e o formato antigo (menos a versão anterior, se a tela vai oferecer voltar)
  const keep = new Set([metaName(id), ...SECTIONS.map((k) => secName(id, files, k))]);
  if (light.prev) SECTIONS.forEach((k) => keep.add(secName(id, light.prev.files, k)));
  for (const f of fs.readdirSync(store.DATA)) {
    if (f.startsWith(`catalog-${id}.`) && !keep.has(f)) fs.unlink(store.file(f), () => {});
  }
}

// Partes lidas do disco quando a tela pede (o texto da seção vai como está, sem interpretar).
function diskParts(id, light) {
  const meta = JSON.stringify(light).slice(1, -1);
  const parts = { meta, memo: {} };
  for (const k of SECTIONS) {
    Object.defineProperty(parts, k, {
      enumerable: true,
      get: () => {
        try { return fs.readFileSync(store.file(secName(id, light.files, k)), 'utf8'); } catch { return '{"cats":[],"items":[]}'; }
      },
    });
  }
  return parts;
}

// Depois de uma lista que encolheu muito: volta para a versão anterior (back) ou fica com a nova (keep).
// Troca o resumo de uma vez (atômico) e apaga os arquivos do conjunto que sai.
function settleShrunk(list, back) {
  const id = list.id;
  const meta = readMeta(id);
  if (!meta || !meta.prev) return false;
  const stay = back ? meta.prev : (({ prev, shrunk, ...rest }) => rest)(meta);
  const gone = back ? meta.files : meta.prev.files;
  store.writeText(metaName(id), JSON.stringify(stay));
  SECTIONS.forEach((k) => fs.unlink(store.file(secName(id, gone, k)), () => {}));
  partsCache.set(stay, diskParts(id, stay));
  memory.set(id, stay);
  // voltou para a anterior: não atualiza sozinho de novo tão cedo (encolheria outra vez e perguntaria de novo);
  // "Atualizar lista" continua funcionando na hora
  if (back) failedAt.set(id, Date.now() + STALE_MS);
  return true;
}

// Resumo guardado no formato novo, ou null.
function readMeta(id) {
  const meta = store.readJson(metaName(id), null);
  return meta && meta.files ? meta : null;
}

// first: a seção que a tela vai mostrar primeiro (o Xtream a pede antes e a libera assim que chega)
// última atualização que falhou: a versão guardada continua, sem tentar de novo a cada pedido da tela
const failedAt = new Map();
const RETRY_MS = 10 * 60 * 1000;

function refresh(list, first, { full = false } = {}) {
  if (!inflight.has(list.id)) {
    const b = { done: {}, meta: null, waiters: [] };
    const wake = () => { b.waiters = b.waiters.filter((w) => !w()); };
    const onSection = (sec, data, meta) => { b.done[sec] = data; b.meta = meta; wake(); };
    building.set(list.id, b);
    const p = build(list, { first, onSection, full });
    const done = () => {
      inflight.delete(list.id);
      if (building.get(list.id) === b) building.delete(list.id);
    };
    p.then(() => { failedAt.delete(list.id); done(); }, () => { failedAt.set(list.id, Date.now()); done(); });
    inflight.set(list.id, p);
  }
  return inflight.get(list.id);
}

// Uma seção de uma lista que está sendo montada: a parte pronta (Xtream), ou o catálogo inteiro quando terminar.
function sectionFrom(list, sec) {
  const p = inflight.get(list.id);
  if (!p) return null;
  const b = building.get(list.id);
  return new Promise((resolve, reject) => {
    const ready = () => b && b.done[sec] && (resolve({ partial: true, meta: b.meta, data: b.done[sec] }), true);
    if (ready()) return;
    if (b) b.waiters.push(ready);
    p.then((catalog) => resolve({ catalog }), reject);
  });
}

const hasCache = (id) => memory.has(id) || fs.existsSync(store.file(metaName(id))) || fs.existsSync(store.file(legacyName(id)));

// Uma seção para a tela. force: baixa a lista de novo. wait: a tela já recebeu outra seção desta mesma carga
// (então espera a montagem em andamento, em vez de pegar a versão guardada antiga).
// full: com force, baixa a lista inteira sem perguntar ao provedor se ela mudou.
async function getSection(list, sec, { force = false, wait = false, full = false } = {}) {
  if (force || !hasCache(list.id)) refresh(list, sec, { full });
  if (force || wait || !hasCache(list.id)) {
    let r;
    try {
      r = await sectionFrom(list, sec);
    } catch (err) {
      // Não deu para atualizar (provedor fora, lista incompleta, página no lugar da lista): se há uma versão
      // guardada, ela continua valendo e a tela avisa. Sem versão guardada, o erro vai para a tela.
      if (!hasCache(list.id)) throw err;
      const { catalog } = await getCatalog(list);
      return { catalog, refreshing: false, building: false, warning: `Não foi possível atualizar a lista: ${err.message}` };
    }
    if (r && r.partial) return { ...r, building: true };
    if (r) return { catalog: r.catalog, refreshing: false, building: true };
  }
  const { catalog, refreshing } = await getCatalog(list);
  return { catalog, refreshing, building: false };
}

async function getCatalog(list, { force = false, full = false } = {}) {
  if (force) return { catalog: await refresh(list, undefined, { full }), refreshing: false };
  let cached = memory.get(list.id);
  if (!cached) {
    // abrir com o app fechado: lê e interpreta o arquivo inteiro do catálogo (medido para o modo de depuração)
    const t0 = Date.now();
    const loop = diag.loopWatch();
    const meta = readMeta(list.id);
    if (meta) {
      // formato novo: só o resumo agora; cada seção é lida do disco quando a tela pedir
      cached = meta;
      partsCache.set(cached, diskParts(list.id, cached));
    } else {
      // formato antigo (tudo num arquivo): lê uma vez e já grava no formato novo
      cached = store.readJson(legacyName(list.id), null);
      if (cached) {
        tidyCatalog(cached); // listas baixadas antes da limpeza dos nomes
        const parts = partsOf(cached);
        cached = lightOf(cached);
        partsCache.set(cached, parts);
        const light = cached;
        memory.set(list.id, light);
        saveFiles(list.id, light, parts).catch((e) => console.error('gravar catálogo', list.id, e.message));
      }
    }
    if (cached) {
      diag.last.coldRead = { listId: list.id, ms: Date.now() - t0, travadoMs: loop.stop(), memMB: Math.round(process.memoryUsage().rss / 1048576) };
    } else loop.stop();
  }
  if (cached) {
    memory.set(list.id, cached);
    if (cached.base && !activeBase.has(list.id)) activeBase.set(list.id, cached.base);
    const stale = Date.now() - cached.updatedAt > STALE_MS;
    if (stale && Date.now() - (failedAt.get(list.id) || 0) > RETRY_MS) refresh(list).catch(() => {});
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
// (consultado a cada segundo enquanto a lista carrega). O arquivo começa pelos dados gerais: basta o começo dele.
function headOf(id) {
  let fd = null;
  try {
    fd = fs.openSync(store.file(legacyName(id)), 'r');
    const buf = Buffer.alloc(8192);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
  } catch {
    return '';
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
function updatedAtOf(id) {
  const m = memory.get(id) || readMeta(id);
  if (m) return m.updatedAt;
  const at = /"updatedAt":(\d+)/.exec(headOf(id));
  return at ? Number(at[1]) : null;
}
// Endereço do guia de programação que veio na lista (o guia é consultado o tempo todo na tela Ao vivo).
function epgUrlOf(id) {
  const m = memory.get(id) || readMeta(id);
  if (m) return m.epgUrl || '';
  const at = /"epgUrl":("(?:[^"\\]|\\.)*")/.exec(headOf(id));
  try { return at ? JSON.parse(at[1]) : ''; } catch { return ''; }
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
  epgUrlOf,
  getSection,
  settleShrunk,
  partsOf,
  fullText,
  SECTIONS,
  forget,
  xtreamSeriesInfo,
  xtreamVodInfo,
  checkStatus,
  // exportados para testes
  prepareParts,
  splitVersion,
  parseEpisode,
  buildFromM3U,
};
