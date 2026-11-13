// Deixa as outras listas prontas por trás: com o app parado, monta (uma de cada vez) as listas que não são a da
// tela e cujo catálogo guardado não existe ou tem mais de 12 h. Assim, trocar de lista abre na hora.
// Só em aparelho com memória sobrando (PC e celulares grandes; nunca na TV LG nem no Mecool), nunca com vídeo
// tocando, no máximo uma vez a cada 12 h por lista (alguns provedores bloqueiam quem acessa demais).
// Não troca a lista ativa nem mostra nada na tela: só atualiza o catálogo guardado, pelo mesmo caminho do
// "Atualizar lista" (revalida com ETag; se falhar, a versão anterior continua).
// No Android só roda no Wi-Fi: a tela avisa o tipo de rede (IPTVKZAndroid.networkType, em /api/ping?rede=) e,
// sem aviso recente de Wi-Fi, não baixa (60 MB de lista pelos dados móveis, sem a pessoa pedir, não pode).
// Se o app voltar a ser usado no meio, a montagem para (a não ser que seja a lista que a pessoa acabou de abrir).
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
let network = { type: null, at: 0 }; // último tipo de rede avisado pela tela do app Android
const NET_FRESH = 5 * 60 * 1000;

// Memória sobrando: mais de 3 GB no aparelho (como em buildFromXtream) e um limite de memória do JavaScript que
// comporte montar uma lista grande. A TV LG (limite de ~318 MB) e o Mecool (2 GB) ficam de fora.
function memoryOk(m) {
  return m.total > 3 * 1024 * MB && m.heap > 512 * MB;
}

function allowed(now = Date.now()) {
  if (!memoryOk(memory())) return false;
  if (platform !== 'android') return true;
  return network.type === 'wifi' && now - network.at < NET_FRESH;
}

// A tela do app Android avisa a rede ('wifi' ou 'dados') junto do ping.
function setNetwork(type, at) {
  if (type === 'wifi' || type === 'dados') network = { type, at: at || Date.now() };
}

const activeId = () => {
  const lists = store.readJson('lists.json', []);
  return (store.readJson('settings.json', {}) || {}).activeList || (lists[0] && lists[0].id);
};

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
  if (running || !allowed(now) || streams() > 0 || now - lastUse < IDLE) return null;
  const list = nextList(now);
  if (!list) return null;
  tried.set(list.id, now);
  // para no meio se o app voltar a ser usado ou um vídeo começar, menos se a pessoa abriu justo esta lista
  // (aí ela está esperando esta montagem). Confere no máximo uma vez por segundo.
  const startedAt = Date.now();
  let checkedAt = 0;
  let stop = false;
  const shouldStop = () => {
    const t = Date.now();
    if (t - checkedAt < 1000) return stop;
    checkedAt = t;
    stop = (lastUse >= startedAt || streams() > 0) && activeId() !== list.id;
    return stop;
  };
  running = catalogs.warm(list, shouldStop).then(() => {}, () => {}).then(() => { running = null; });
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
  setNetwork,
  // para os testes: memória, plataforma e streams simulados; espera a montagem em andamento
  _test: {
    setMemory(fn) { memory = fn; },
    setPlatform(p) { platform = p; },
    setNetwork(n) { network = n; },
    setStreams(fn) { streams = fn; },
    reset() { tried.clear(); },
    wait: () => running || Promise.resolve(),
  },
};
