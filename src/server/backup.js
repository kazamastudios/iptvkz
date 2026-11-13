// Backup das listas, favoritos, histórico e preferências, guardado no celular pelo usuário.
// O arquivo contém usuário e senha das listas: só sai da TV pelo pareamento da rede de casa.
const fs = require('fs');
const store = require('./store');

const PER_LIST = ['favorites', 'recents', 'progress', 'catPrefs'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Uma lista com os dados dela (favoritos, recentes, histórico e categorias), para levar a outro aparelho.
// a tela chama o arquivo de “Lista IPTVKZ” (gerado por “Baixar lista”)
const NOT_OURS = 'Este arquivo não é uma lista baixada do IPTVKZ. O certo começa com “iptvkz-lista” e é gerado pelo botão “Baixar lista”.';

function build(listId) {
  const state = store.getState();
  const list = state.lists.find((l) => l && String(l.id) === String(listId));
  if (!list || !ID.test(String(list.id))) return null;
  const id = String(list.id);
  const out = { lists: [list] };
  for (const k of PER_LIST) if (isObj(state[k]) && state[k][id] != null) out[k] = { [id]: state[k][id] };
  const files = {};
  try { files[id] = fs.readFileSync(store.file(`m3u-${id}.m3u`), 'utf8'); } catch {}
  return { app: 'iptvkz', kind: 'backup', v: 1, createdAt: new Date().toISOString(), state: out, files };
}

// Confere o arquivo enviado pelo celular antes de guardar qualquer coisa.
function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(NOT_OURS); }
  if (!isObj(data) || data.app !== 'iptvkz' || data.kind !== 'backup' || !isObj(data.state)) {
    throw new Error(NOT_OURS);
  }
  if (data.v !== 1) throw new Error('Este backup é de uma versão mais nova do IPTVKZ. Atualize o app e tente de novo.');
  const s = data.state;
  if (!Array.isArray(s.lists) || !s.lists.every((l) => isObj(l) && ID.test(String(l.id)))) {
    throw new Error('O backup está corrompido (listas inválidas).');
  }
  for (const k of PER_LIST) {
    if (s[k] != null && !isObj(s[k])) throw new Error('O backup está corrompido.');
  }
  const ids = new Set(s.lists.map((l) => String(l.id)));
  const files = isObj(data.files) ? data.files : {};
  for (const [id, body] of Object.entries(files)) {
    if (!ids.has(id) || typeof body !== 'string') throw new Error('O backup está corrompido (arquivos de lista).');
  }
  return { state: s, files, createdAt: String(data.createdAt || '') };
}

// favoritos: { lista: { seção: [ids] } }; histórico: { lista: { item: progresso } }
const perList = (obj, fn) => Object.values(isObj(obj) ? obj : {}).reduce((n, v) => n + (isObj(v) ? fn(v) : 0), 0);
const countFavs = (obj) => perList(obj, (v) => Object.values(v).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0));
const countHistory = (obj) => perList(obj, (v) => Object.keys(v).filter((k) => !k.startsWith('s:')).length);

function summary(data) {
  const lists = data.state.lists;
  return {
    lists: lists.length,
    names: lists.slice(0, 4).map((l) => String(l.name || 'Lista').slice(0, 60)),
    favorites: countFavs(data.state.favorites),
    history: countHistory(data.state.progress),
    createdAt: data.createdAt,
  };
}

// Junta as listas do arquivo às desta TV: a de mesmo id é substituída, as outras ficam como estão.
// Devolve os ids restaurados.
function apply(data) {
  const lists = store.readJson('lists.json', []);
  const ids = [];
  for (const l of data.state.lists) {
    const id = String(l.id);
    const i = lists.findIndex((x) => x && String(x.id) === id);
    if (i >= 0) lists[i] = l; else lists.push(l);
    ids.push(id);
    store.removeListFiles(id);
    if (typeof data.files[id] === 'string') fs.writeFileSync(store.file(`m3u-${id}.m3u`), data.files[id]);
  }
  for (const k of PER_LIST) {
    const cur = store.readJson(k + '.json', {});
    const src = isObj(data.state[k]) ? data.state[k] : {};
    for (const id of ids) {
      if (src[id] != null) cur[id] = src[id]; else delete cur[id];
    }
    store.setState(k, cur);
  }
  store.setState('lists', lists);
  const settings = store.readJson('settings.json', {});
  if (!lists.some((l) => l && l.id === settings.activeList)) store.setState('settings', { ...settings, activeList: ids[0] });
  return ids;
}

function slug(name) {
  return String(name || 'lista').normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'lista';
}

module.exports = { build, parse, summary, apply, slug };
