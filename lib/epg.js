// Guia de programação (XMLTV): baixa em streaming (aceita .gz), guarda de -6h a +24h
// e responde só os canais pedidos.
const zlib = require('zlib');
const { Readable, PassThrough } = require('stream');
const { norm, fetchWithTimeout, safeHost } = require('./util');
const store = require('./store');

const STALE_MS = 12 * 60 * 60 * 1000;
const BEFORE_MS = 6 * 60 * 60 * 1000;
const AFTER_MS = 24 * 60 * 60 * 1000;

const memory = new Map(); // listId -> { updatedAt, url, channels, names, lower }
const inflight = new Map();
const errors = new Map();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

function attr(s, name) {
  const m = s.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')) || s.match(new RegExp(name + "\\s*=\\s*'([^']*)'"));
  return m ? decode(m[1]) : '';
}

function tag(s, name) {
  const m = s.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
}

function parseTime(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}):?(\d{2})?/);
  if (!m) return NaN;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    const mins = Math.abs(parseInt(m[7], 10)) * 60 + parseInt(m[8] || '0', 10);
    t -= sign * mins * 60000;
  }
  return t;
}

async function openStream(url) {
  const res = await fetchWithTimeout(url, {}, 10 * 60 * 1000);
  if (!res.ok || !res.body) throw new Error(`O guia respondeu ${res.status} (${safeHost(url)})`);
  const src = Readable.fromWeb(res.body);
  const first = await new Promise((resolve, reject) => {
    src.once('data', (c) => { src.pause(); resolve(c); });
    src.once('end', () => resolve(null));
    src.once('error', reject);
  });
  const pass = new PassThrough();
  if (first) pass.write(first);
  src.pipe(pass);
  src.resume();
  const gz = first && first[0] === 0x1f && first[1] === 0x8b;
  return gz ? pass.pipe(zlib.createGunzip()) : pass;
}

async function build(listId, url) {
  const now = Date.now();
  const from = now - BEFORE_MS;
  const to = now + AFTER_MS;
  const channels = {};
  const names = {};
  const stream = await openStream(url);
  const decoder = new TextDecoder('utf-8');
  const RE = /<(programme|channel)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let buf = '';
  let total = 0;

  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    RE.lastIndex = 0;
    let last = 0;
    let m;
    while ((m = RE.exec(buf))) {
      last = RE.lastIndex;
      if (m[1] === 'channel') {
        const id = attr(m[2], 'id');
        const re2 = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g;
        let d;
        while ((d = re2.exec(m[3]))) {
          const n = norm(decode(d[1]));
          if (n && !names[n]) names[n] = id;
        }
        continue;
      }
      const start = parseTime(attr(m[2], 'start'));
      const stop = parseTime(attr(m[2], 'stop')) || start + 3600000;
      if (!(stop > from && start < to)) continue;
      const ch = attr(m[2], 'channel');
      if (!ch) continue;
      const desc = tag(m[3], 'desc');
      (channels[ch] ||= []).push([start, stop, tag(m[3], 'title') || 'Sem título', desc.length > 400 ? desc.slice(0, 397) + '…' : desc]);
      total++;
    }
    buf = last ? buf.slice(last) : buf;
    if (buf.length > 4e6) buf = buf.slice(buf.lastIndexOf('<'));
  }

  for (const k of Object.keys(channels)) channels[k].sort((a, b) => a[0] - b[0]);
  const data = { updatedAt: Date.now(), url, total, channels, names };
  store.writeJson(`epg-${listId}.json`, data);
  return index(data);
}

function index(data) {
  const lower = {};
  for (const k of Object.keys(data.channels)) lower[k.toLowerCase()] = k;
  return { ...data, lower };
}

function refresh(listId, url) {
  if (!inflight.has(listId)) {
    errors.delete(listId);
    const p = build(listId, url)
      .then((d) => { memory.set(listId, d); return d; })
      .catch((err) => { errors.set(listId, err.message); throw err; })
      .finally(() => inflight.delete(listId));
    inflight.set(listId, p);
    p.catch(() => {});
  }
  return inflight.get(listId);
}

function sourceUrl(list, catalog) {
  return (list.epgUrl || '').trim() || (catalog && catalog.epgUrl) || '';
}

function load(listId) {
  let d = memory.get(listId);
  if (!d) {
    const raw = store.readJson(`epg-${listId}.json`, null);
    if (raw) {
      d = index(raw);
      memory.set(listId, d);
    }
  }
  return d || null;
}

// chans: [{ k: chaveDoCliente, e: tvg-id, n: nome }]
function query(list, catalog, chans, { force = false } = {}) {
  const url = sourceUrl(list, catalog);
  if (!url) return { status: 'none', data: {} };
  let d = load(list.id);
  if (force || !d || d.url !== url || Date.now() - d.updatedAt > STALE_MS) refresh(list.id, url);
  if (!d || d.url !== url) {
    if (errors.has(list.id) && !inflight.has(list.id)) return { status: 'error', message: errors.get(list.id), data: {} };
    return { status: 'loading', data: {} };
  }
  const shift = (Number(list.tzOffset) || 0) * 3600000;
  const data = {};
  for (const c of chans || []) {
    let id = null;
    if (c.e) id = d.channels[c.e] ? c.e : d.lower[String(c.e).toLowerCase()];
    if (!id && c.n) id = d.names[norm(c.n)];
    if (!id && c.n) {
      // nomes de canal costumam vir com sufixos tipo "FHD", "HD", "[H265]".
      const cleaned = norm(String(c.n).replace(/\b(fhd|uhd|hd|sd|4k|h265|hevc|alt|\d+fps)\b/gi, ''));
      id = d.names[cleaned];
    }
    const progs = id && d.channels[id];
    if (progs) data[c.k] = shift ? progs.map((p) => [p[0] + shift, p[1] + shift, p[2], p[3]]) : progs;
  }
  return { status: inflight.has(list.id) ? 'refreshing' : 'ok', updatedAt: d.updatedAt, data };
}

function forget(listId) {
  memory.delete(listId);
  errors.delete(listId);
}

module.exports = { query, refresh, forget, sourceUrl };
