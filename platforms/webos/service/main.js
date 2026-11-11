// Serviço do app da LG: sobe o servidor dentro da TV e, no canal Developer, confere e instala atualizações.
// A abertura (index.html) assina o método "boot" e mostra cada fase na barra de progresso.
//
// Canais (definidos por scripts/build-ipk.js):
// - developer: IPK do GitHub; com número de build, baixa pacotes assinados do GitHub Releases.
//   Sem número de build (IPK feito no PC) roda exatamente o que veio no IPK.
// - store: IPK da LG Content Store. Nunca baixa nem executa código de fora: só a loja atualiza.
const fs = require('fs');
const path = require('path');
const Service = require('webos-service');

/* global __CHANNEL__, __SERVICE_ID__, __AUTO_UPDATE__, __LAN_PAIRING__, __UPDATE_BASE__, __UPDATE_KEY__ */
const CHANNEL = __CHANNEL__;
const SERVICE_ID = __SERVICE_ID__;
const AUTO_UPDATE = __AUTO_UPDATE__;
const LAN_PAIRING = __LAN_PAIRING__;
const BUILTIN = path.join(__dirname, 'app');

const service = new Service(SERVICE_ID);
// Mantém o serviço vivo enquanto o app está aberto: sem isso a LG encerra o serviço ocioso e o
// servidor some no meio do vídeo. A atividade cancela o único temporizador do módulo e, sem nada
// pendente, o Node terminaria logo depois de carregar; daí o intervalo vazio.
let keepAlive = null;
try {
  service.activityManager.create('iptvkz-server', (a) => { keepAlive = a; });
} catch (e) { /* sem a atividade, o intervalo abaixo ainda segura o processo */ }
setInterval(() => {}, 60000);

// ---------- pasta de dados: a primeira em que a TV deixar gravar ----------
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  fs.mkdirSync(dir);
}

// /media/developer só existe em TVs com o Modo Desenvolvedor ligado; /tmp é apagado ao desligar a TV
// e só serve para o app abrir mesmo assim (as listas não ficam salvas).
function findDataDir() {
  // Developer: a mesma ordem de sempre, para não perder as listas de quem já usa.
  // Store: primeiro /media/internal, a pasta que a LG indica para dados de serviços (uma por app).
  const internal = '/media/internal/' + SERVICE_ID.replace(/\.service$/, '');
  const home = process.env.HOME && path.join(process.env.HOME, 'iptvkz');
  const places = __CHANNEL__ === 'store' ? [internal, home, path.join(__dirname, 'data')] : [home, path.join(__dirname, 'data'), '/media/developer/temp/iptvkz', internal];
  places.push('/tmp/iptvkz');
  for (const dir of places) {
    if (!dir) continue;
    try {
      mkdirp(dir);
      const probe = path.join(dir, '.probe');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
      return dir;
    } catch (e) { /* tenta a próxima */ }
  }
  throw new Error('Sem pasta gravável na TV');
}

const DATA = process.env.IPTVKZ_APP_DATA || findDataDir();
try { mkdirp(DATA); } catch (e) { /* o registro abaixo só falha calado */ }

// Registro curto: é o que dá para ler quando algo falha na TV. Recomeça ao passar de 32 KB.
// Só fases e erros: nunca endereços de listas, usuários ou senhas.
const LOG = path.join(DATA, 'boot.log');
function log(text) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + text + '\n'); } catch (e) { /* sem registro */ } }
try { if (fs.statSync(LOG).size > 32768) fs.writeFileSync(LOG, ''); } catch (e) { /* ainda não existe */ }
log('serviço iniciado, canal ' + CHANNEL + ', node ' + process.version + ', dados em ' + DATA);
if (DATA.indexOf('/tmp/') === 0) log('aviso: pasta temporária, as listas não ficam salvas depois de desligar a TV');
process.on('exit', (code) => log('serviço encerrado, código ' + code));
process.on('SIGTERM', () => { log('recebeu SIGTERM'); process.exit(0); });
process.on('uncaughtException', (e) => { log('erro: ' + e.stack); process.exit(1); });
process.on('unhandledRejection', (e) => log('rejeição: ' + (e && e.stack)));

const readInt = (file) => { try { return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch (e) { return 0; } };
const builtinVersion = () => readInt(path.join(BUILTIN, 'version.txt'));

// ---------- aviso de fases para a abertura ----------
const listeners = new Set();
let last = null;
function emit(state) {
  if (!last || last.phase !== state.phase) log('fase ' + state.phase + (state.message ? ': ' + state.message : ''));
  last = state;
  listeners.forEach((m) => { try { m.respond(Object.assign({ returnValue: true, subscribed: true }, state)); } catch (e) { listeners.delete(m); } });
}

// Só o canal Developer inclui o atualizador. A constante vai direto no teste para o esbuild
// descartar o require (e o arquivo inteiro) no build da Store e no IPK feito no PC.
const updater = __AUTO_UPDATE__ ? require('./updater.js').createUpdater({
  base: process.env.IPTVKZ_UPDATE_BASE || __UPDATE_BASE__,
  publicKey: process.env.IPTVKZ_UPDATE_KEY || __UPDATE_KEY__,
  bundles: path.join(DATA, 'bundles'),
  builtinVersion,
  log,
  emit,
}) : null;

// A versão que vale: a baixada (Developer), se for mais nova que a que veio no IPK.
function activeBundle() {
  return (updater && updater.downloaded()) || { version: builtinVersion(), dir: BUILTIN };
}

// ---------- servidor ----------
let serverPort = 0;

// Sem a interface aberta por esse tempo (app fechado) e sem vídeo tocando, o serviço encerra e
// libera memória e CPU da TV. Abrir o app de novo chama "boot" e sobe tudo outra vez.
const IDLE_MS = 15 * 60 * 1000;

function quit() {
  log('app fechado há ' + IDLE_MS / 60000 + ' min, encerrando o serviço');
  try { if (keepAlive) service.activityManager.complete(keepAlive, () => process.exit(0)); } catch (e) { /* sai do mesmo jeito */ }
  setTimeout(() => process.exit(0), 1000);
}

function startFrom(bundle) {
  process.env.IPTVKZ_DATA = path.join(DATA, 'data');
  process.env.IPTVKZ_WEB = path.join(bundle.dir, 'web');
  process.env.IPTVKZ_KEEPALIVE = '1';
  // 0.0.0.0: o celular precisa alcançar a TV pela rede de casa para cadastrar listas (QR Code).
  // Fora do próprio aparelho, o servidor só responde à página de cadastro com chave de uso único.
  // LAN_PAIRING falso (build com WEBOS_LAN_PAIRING=0): só a própria TV alcança o servidor.
  const host = LAN_PAIRING ? '0.0.0.0' : '127.0.0.1';
  return require(path.join(bundle.dir, 'server.js')).start({ host, port: 8787, portFallback: true, keepAlive: true, pairing: LAN_PAIRING, idleMs: IDLE_MS, onQuit: quit });
}

function startServer() {
  const bundle = activeBundle();
  return Promise.resolve().then(() => startFrom(bundle)).catch((e) => {
    log('servidor v' + bundle.version + ': ' + e.stack);
    if (bundle.dir === BUILTIN || !updater) throw e;
    // a versão baixada não subiu: marca como ruim e volta para a que veio no IPK
    updater.reject(bundle.version);
    return startFrom({ version: builtinVersion(), dir: BUILTIN });
  }).then((r) => { serverPort = r.port; return r.port; });
}

let running = false;
function boot() {
  if (running) return;
  running = true;
  const check = updater ? updater.update(activeBundle().version) : Promise.resolve(false);
  check.then((installed) => {
    if (installed && serverPort) {
      // o servidor antigo já está na memória: reinicia o serviço; a abertura chama de novo
      emit({ phase: 'restart' });
      setTimeout(() => process.exit(0), 400);
      return null;
    }
    if (installed) emit({ phase: 'restart' });
    return (serverPort ? Promise.resolve(serverPort) : startServer()).then((port) => {
      running = false;
      emit({ phase: 'ready', port, version: activeBundle().version, channel: CHANNEL });
    });
  }).catch((e) => {
    running = false;
    emit({ phase: 'error', message: e.message });
  });
}

service.register('boot', (message) => {
  log('boot chamado, assinatura=' + message.isSubscription + ', fase atual=' + (last && last.phase));
  if (message.isSubscription) listeners.add(message);
  else message.respond({ returnValue: true });
  if (!running && (!last || last.phase === 'ready' || last.phase === 'error')) boot();
  else if (last) message.respond(Object.assign({ returnValue: true, subscribed: true }, last));
}, (message) => { listeners.delete(message); });

module.exports = { keep: () => keepAlive };
