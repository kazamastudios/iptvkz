// Persistência simples em data/*.json (gravação atômica).
const fs = require('fs');
const path = require('path');

const DATA = process.env.IPTVKZ_DATA || process.env.MINHATV_DATA || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

const STATE_KEYS = ['lists', 'settings', 'favorites', 'recents', 'progress', 'catPrefs'];
const DEFAULTS = {
  lists: [],
  settings: {},
  favorites: {},
  recents: {},
  progress: {},
  catPrefs: {},
};

function file(name) {
  return path.join(DATA, name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const target = file(name);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, target);
}

function getState() {
  const out = {};
  for (const k of STATE_KEYS) out[k] = readJson(k + '.json', DEFAULTS[k]);
  return out;
}

function setState(key, value) {
  if (!STATE_KEYS.includes(key)) throw new Error('chave inválida');
  writeJson(key + '.json', value);
}

function getList(id) {
  return readJson('lists.json', []).find((l) => l.id === id) || null;
}

function removeListFiles(id) {
  for (const name of [`catalog-${id}.json`, `epg-${id}.json`, `m3u-${id}.m3u`]) {
    try { fs.unlinkSync(file(name)); } catch {}
  }
}

module.exports = { DATA, file, readJson, writeJson, getState, setState, getList, removeListFiles };
