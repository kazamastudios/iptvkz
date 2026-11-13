// Deixa as outras listas prontas por trás: com o app parado, monta (uma de cada vez) as listas que não são a da
// tela e cujo catálogo guardado não existe ou tem mais de 12 h. Assim, trocar de lista abre na hora.
// Só em aparelho com memória sobrando (PC e celulares grandes; nunca na TV LG nem no Mecool), nunca com vídeo
// tocando, no máximo uma vez a cada 12 h por lista (alguns provedores bloqueiam quem acessa demais).
// Não troca a lista ativa nem mostra nada na tela: só atualiza o catálogo guardado, pelo mesmo caminho do
// "Atualizar lista" (revalida com ETag; se falhar, a versão anterior continua).
// No Android não roda: o servidor não sabe se o celular está no Wi-Fi ou nos dados móveis (baixar 60 MB de lista
// pelos dados da pessoa, sem ela pedir, não pode).
const os = require('os');
const v8 = require('v8');
const store = require('./store');
const catalogs = require('./catalog');

const MB = 1024 * 1024;
const EVERY = 12 * 60 * 60 * 1000; // idade máxima do catálogo guardado, e intervalo mínimo por lista
const IDLE = 5 * 60 * 1000; // app parado há pelo menos isso
const TICK = 60 * 1000;

let lastUse = Date.now();
let streams = () => 0;
let running = null;
const tried = new Map(); // lista -> quando foi montada por aqui (deu certo ou não)
let memory = () => ({ total: os.totalmem(), heap: v8.getHeapStatistics().heap_size_limit });
let platform = process.platform;

// Memória sobrando: mais de 3 GB no aparelho (como em buildFromXtream) e um limite de memória do JavaScript que
// comporte montar uma lista grande. A TV LG (limite de ~318 MB) e o Mecool (2 GB) ficam de fora.
function memoryOk(m) {
  return m.total > 3 * 1024 * MB && m.heap > 512 * MB;
}

function allowed() {
  return platform !== 'android' && memoryOk(memory());
}

// Alguém usou o app (navegou, abriu algo, assistiu): os avisos periódicos da tela não contam.
function touch(at) {
  lastUse = at || Date.now();
}

// A próxima lista a preparar, ou null. Pula a lista da tela (o próprio app cuida dela), a que já está sendo
// montada e a que foi preparada há menos de 12 h. Lista de arquivo só é montada se não tiver catálogo (não muda).
function nextList(now) {
  const lists = store.readJson('lists.json', []);
  const active = (store.readJson('settings.json', {}) || {}).activeList || (lists[0] && lists[0].id);
  for (const l of lists) {
    if (l.id === active || catalogs.isRefreshing(l.id)) continue;
    if (now - (tried.get(l.id) || 0) < EVERY) continue;
    const at = catalogs.updatedAtOf(l.id);
    const isFile = l.type !== 'xtream' && l.source === 'file';
    if (at && (isFile || now - at < EVERY)) continue;
    return l;
  }
  return null;
}

// Uma checagem: prepara uma lista se tudo permitir. Devolve o id da lista que começou a montar, ou null.
function tick(now) {
  now = now || Date.now();
  if (running || !allowed() || streams() > 0 || now - lastUse < IDLE) return null;
  const list = nextList(now);
  if (!list) return null;
  tried.set(list.id, now);
  running = catalogs.warm(list).then(() => {}, () => {}).then(() => { running = null; });
  return list.id;
}

function start(getStreams) {
  if (getStreams) streams = getStreams;
  setInterval(() => tick(), TICK).unref();
}

module.exports = {
  start,
  touch,
  tick,
  memoryOk,
  // para os testes: memória, plataforma e streams simulados; espera a montagem em andamento
  _test: {
    setMemory(fn) { memory = fn; },
    setPlatform(p) { platform = p; },
    setStreams(fn) { streams = fn; },
    reset() { tried.clear(); },
    wait: () => running || Promise.resolve(),
  },
};
