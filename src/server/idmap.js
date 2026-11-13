'use strict';
// Lista M3U de um painel Xtream (link get.php) passa a ser lida pela API do painel, que é mais rápida. Filmes e
// séries têm o mesmo id nos dois jeitos (vem do título), mas canais, episódios e categorias não: o M3U não tem o
// número do canal, e a API não tem o link do M3U. Quando a lista troca de jeito (M3U -> API, ou de volta, se a API
// falhar um dia), o app monta um mapa id antigo -> id novo só dos ids que a pessoa usa (favoritos, Minha lista,
// recentes, progresso, categorias escondidas ou reordenadas), e aplica no que está salvo. A tela aplica o mesmo
// mapa ao abrir a lista (core/store.js), para nenhum aparelho regravar os ids antigos.

// Número do canal ou do episódio no link do painel: .../live/usuario/senha/123.ts, .../usuario/senha/123,
// .../series/usuario/senha/456.mkv
function streamNum(url) {
  const m = /\/(\d+)(?:\.[a-z0-9]{1,5})?(?:[?#].*)?$/i.exec(String(url || ''));
  return m ? m[1] : null;
}

// Os ids que a pessoa usa nesta lista: os que valem a pena traduzir.
function usedIds(state, lid) {
  const ids = new Set();
  const add = (v) => { if (typeof v === 'string') ids.add(v); };
  for (const root of [state.favorites, state.recents]) {
    const b = root && root[lid];
    if (b) for (const arr of Object.values(b)) if (Array.isArray(arr)) arr.forEach(add);
  }
  const prog = state.progress && state.progress[lid];
  if (prog) for (const [k, p] of Object.entries(prog)) { add(k); if (p && p.ep) add(p.ep); }
  const cats = {};
  const cp = state.catPrefs && state.catPrefs[lid];
  if (cp) for (const [sec, v] of Object.entries(cp)) cats[sec] = [...(v.hidden || []), ...(v.order || [])];
  return { ids, cats };
}

// As categorias do começo do texto de uma seção gravada ({"cats":[...],"items":[...]}), sem ler os itens.
function catsOfText(text) {
  const i = text.indexOf(',"items":');
  if (i < 0) return [];
  try { return JSON.parse(text.slice(0, i) + '}').cats || []; } catch { return []; }
}

// O link do item com este id num texto de seção gravado (o "url" que vem logo depois do id).
function urlInText(text, id) {
  const at = text.indexOf('"id":' + JSON.stringify(id));
  if (at < 0) return null;
  const re = /"url":"((?:[^"\\]|\\.)*)"/g;
  re.lastIndex = at;
  const m = re.exec(text);
  if (!m) return null;
  try { return JSON.parse('"' + m[1] + '"'); } catch { return null; }
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Categorias: mesmo nome, id novo.
function catMap(oldCats, newCats, used) {
  const byName = new Map();
  for (const c of newCats || []) if (!byName.has(fold(c.name))) byName.set(fold(c.name), c.id);
  const out = {};
  for (const c of oldCats || []) {
    if (!used.includes(c.id)) continue;
    const n = byName.get(fold(c.name));
    if (n && n !== c.id) out[c.id] = n;
  }
  return out;
}

// num -> id dos canais e episódios de um catálogo M3U na memória
function numsOfCatalog(catalog) {
  const live = new Map();
  const eps = new Map();
  for (const it of (catalog.live && catalog.live.items) || []) { const n = streamNum(it.url); if (n && !live.has(n)) live.set(n, it.id); }
  for (const s of (catalog.series && catalog.series.items) || []) {
    for (const season of s.seasons || []) {
      for (const ep of season.eps || []) {
        for (const v of ep.versions || []) { const n = streamNum(v.url); if (n && !eps.has(n)) eps.set(n, ep.id); }
      }
    }
  }
  return { live, eps };
}

/**
 * old: { via, text(sec) -> texto gravado da seção } da versão anterior; catalog: o catálogo novo, ainda na memória.
 * Devolve { ids: {antigo: novo}, cats: {seção: {antigo: novo}} } ou null se não há o que traduzir.
 */
function buildMap(state, lid, old, catalog) {
  const { ids: used, cats: usedCats } = usedIds(state, lid);
  const ids = {};
  const toApi = catalog.via === 'xtream';
  if (toApi) {
    // M3U -> API: o id novo é o número que está no link antigo
    const want = { live: [], series: [] };
    for (const id of used) {
      if (/^l/.test(id)) want.live.push(id);
      else if (/^e/.test(id)) want.series.push(id);
    }
    for (const sec of ['live', 'series']) {
      if (!want[sec].length) continue;
      const text = old.text(sec);
      if (!text) continue;
      for (const id of want[sec]) {
        const n = streamNum(urlInText(text, id));
        if (n) ids[id] = (sec === 'live' ? 'l' : 'e') + n;
      }
    }
  } else {
    // API -> M3U: o número do id antigo está no link novo
    const nums = numsOfCatalog(catalog);
    for (const id of used) {
      const m = /^([le])(\d+)$/.exec(id);
      if (!m) continue;
      const n = (m[1] === 'l' ? nums.live : nums.eps).get(m[2]);
      if (n && n !== id) ids[id] = n;
    }
  }
  const cats = {};
  for (const sec of Object.keys(usedCats)) {
    if (!usedCats[sec].length || !catalog[sec]) continue;
    const text = old.text(sec);
    const m = text ? catMap(catsOfText(text), catalog[sec].cats, usedCats[sec]) : {};
    if (Object.keys(m).length) cats[sec] = m;
  }
  if (!Object.keys(ids).length && !Object.keys(cats).length) return null;
  return { ids, cats };
}

/** Aplica o mapa no estado salvo da lista. Devolve as chaves que mudaram. O mesmo código está em core/store.js. */
function applyMap(state, lid, map) {
  const changed = [];
  if (!map) return changed;
  const ids = map.ids || {};
  const tr = (arr) => {
    let hit = false;
    const out = [];
    for (const id of arr) { const n = ids[id] || id; if (n !== id) hit = true; if (!out.includes(n)) out.push(n); }
    return hit ? out : null;
  };
  for (const key of ['favorites', 'recents']) {
    const b = state[key] && state[key][lid];
    if (!b) continue;
    let hit = false;
    for (const k of Object.keys(b)) { const n = Array.isArray(b[k]) && tr(b[k]); if (n) { b[k] = n; hit = true; } }
    if (hit) changed.push(key);
  }
  const prog = state.progress && state.progress[lid];
  if (prog) {
    let hit = false;
    for (const k of Object.keys(prog)) {
      const p = prog[k];
      if (p && p.ep && ids[p.ep]) { p.ep = ids[p.ep]; hit = true; }
      const n = ids[k];
      if (!n) continue;
      if (!prog[n] || (p && p.at || 0) > (prog[n].at || 0)) prog[n] = p;
      delete prog[k];
      hit = true;
    }
    if (hit) changed.push('progress');
  }
  const cp = state.catPrefs && state.catPrefs[lid];
  if (cp && map.cats) {
    let hit = false;
    for (const [sec, m] of Object.entries(map.cats)) {
      const v = cp[sec];
      if (!v) continue;
      for (const f of ['hidden', 'order']) {
        if (!Array.isArray(v[f])) continue;
        const out = [];
        for (const id of v[f]) { const n = m[id] || id; if (n !== id) hit = true; if (!out.includes(n)) out.push(n); }
        v[f] = out;
      }
    }
    if (hit) changed.push('catPrefs');
  }
  return changed;
}

module.exports = { streamNum, buildMap, applyMap, catsOfText, urlInText };
