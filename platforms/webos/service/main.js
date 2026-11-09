// Serviço do app da LG: confere a atualização, instala e sobe o servidor dentro da TV.
// A abertura (index.html) assina o método "boot" e mostra cada fase na barra de progresso.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const nodeUrl = require('url');
const zlib = require('zlib');
const Service = require('webos-service');

/* global __UPDATE_BASE__, __UPDATE_KEY__ */
const BASE = process.env.IPTVKZ_UPDATE_BASE || __UPDATE_BASE__;
const PUBLIC_KEY = process.env.IPTVKZ_UPDATE_KEY || __UPDATE_KEY__;
const CHECK_MS = 8000;
const DOWNLOAD_MS = 180000;
const BUILTIN = path.join(__dirname, 'app');

const service = new Service('com.lucasyemz.iptvkz.service');
let keepAlive = null;
service.activityManager.create('iptvkz-server', (a) => { keepAlive = a; });
// A atividade impede a LG de encerrar por ociosidade, mas cancela o único temporizador do módulo:
// sem nada pendente o Node terminaria sozinho, logo depois de carregar.
setInterval(() => {}, 60000);

// ---------- pasta de dados: a primeira em que a TV deixar gravar ----------
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  fs.mkdirSync(dir);
}

function findDataDir() {
  const places = [process.env.HOME && path.join(process.env.HOME, 'iptvkz'), path.join(__dirname, 'data'), '/media/developer/temp/iptvkz', '/tmp/iptvkz'];
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
const BUNDLES = path.join(DATA, 'bundles');
const CURRENT = path.join(BUNDLES, 'current');
const REJECTED = path.join(BUNDLES, 'rejected');

// Registro curto: é o que dá para ler quando algo falha na TV. Recomeça ao passar de 32 KB.
const LOG = path.join(DATA, 'boot.log');
function log(text) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + text + '\n'); } catch (e) { /* sem registro */ } }
try { if (fs.statSync(LOG).size > 32768) fs.writeFileSync(LOG, ''); } catch (e) { /* ainda não existe */ }
log('serviço iniciado, node ' + process.version);
process.on('exit', (code) => log('serviço encerrado, código ' + code));
process.on('SIGTERM', () => { log('recebeu SIGTERM'); process.exit(0); });
process.on('uncaughtException', (e) => { log('erro: ' + e.stack); process.exit(1); });
process.on('unhandledRejection', (e) => log('rejeição: ' + (e && e.stack)));

const readInt = (file) => { try { return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch (e) { return 0; } };
const builtinVersion = () => readInt(path.join(BUILTIN, 'version.txt'));
const installedDir = (v) => path.join(BUNDLES, String(v));

// A versão que vale: a baixada, se for mais nova que a que veio no IPK.
function activeBundle() {
  const v = readInt(CURRENT);
  if (v > builtinVersion() && v !== readInt(REJECTED) && fs.existsSync(path.join(installedDir(v), 'server.js'))) {
    return { version: v, dir: installedDir(v) };
  }
  return { version: builtinVersion(), dir: BUILTIN };
}

// ---------- aviso de fases para a abertura ----------
const listeners = new Set();
let last = null;
function emit(state) {
  if (!last || last.phase !== state.phase) log('fase ' + state.phase + (state.message ? ': ' + state.message : ''));
  last = state;
  listeners.forEach((m) => { try { m.respond(Object.assign({ returnValue: true, subscribed: true }, state)); } catch (e) { listeners.delete(m); } });
}

// ---------- rede ----------
function get(url, deadline, onData, hops) {
  const finished = [];
  return new Promise((resolve, reject) => {
    const t = nodeUrl.parse(url);
    const req = (t.protocol === 'https:' ? https : http).get({
      protocol: t.protocol, hostname: t.hostname, port: t.port, path: t.path, headers: { 'User-Agent': 'IPTVKZ-webOS' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 8) {
        res.resume();
        return resolve(get(nodeUrl.resolve(url, res.headers.location), deadline, onData, (hops || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = Number(res.headers['content-length']) || 0;
      const parts = [];
      let got = 0;
      res.on('data', (d) => { parts.push(d); got += d.length; if (onData) onData(got, total); });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Conexão interrompida')));
    });
    // prazo total: o timeout do próprio request só começa depois que a conexão abre
    const hard = setTimeout(() => { reject(new Error('Tempo esgotado em ' + t.hostname)); req.abort(); }, deadline);
    finished.push(() => clearTimeout(hard));
    req.on('error', reject);
  }).then((v) => { finished.splice(0).forEach((f) => f()); return v; }, (e) => { finished.splice(0).forEach((f) => f()); throw e; });
}

// ---------- atualização ----------
function verified(body, signatureB64) {
  return crypto.createVerify('RSA-SHA256').update(body).verify(PUBLIC_KEY, String(signatureB64).trim(), 'base64');
}

// Pacote: gzip de um JSON { caminho: base64 }. Grava ao lado e só depois troca o "current".
function install(version, gz) {
  const files = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  if (!files['server.js']) throw new Error('Pacote incompleto');
  const tmp = installedDir(version) + '.tmp';
  rmrf(tmp);
  Object.keys(files).forEach((rel) => {
    const target = path.join(tmp, rel);
    if (path.relative(tmp, target).split(path.sep)[0] === '..') throw new Error('Caminho inválido no pacote');
    mkdirp(path.dirname(target));
    fs.writeFileSync(target, Buffer.from(files[rel], 'base64'));
  });
  rmrf(installedDir(version));
  fs.renameSync(tmp, installedDir(version));
  fs.writeFileSync(CURRENT + '.tmp', String(version));
  fs.renameSync(CURRENT + '.tmp', CURRENT);
  // guarda só a versão em uso, para não ocupar o armazenamento da TV
  fs.readdirSync(BUNDLES).forEach((name) => {
    if (/^\d+$/.test(name) && Number(name) !== version) rmrf(path.join(BUNDLES, name));
  });
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) {
    fs.readdirSync(p).forEach((f) => rmrf(path.join(p, f)));
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}

// true = instalou uma versão nova. Sem internet ou GitHub fora, segue com a que já tem.
function update() {
  emit({ phase: 'checking' });
  let manifest;
  return Promise.all([get(BASE + 'webos-update.json', CHECK_MS), get(BASE + 'webos-update.json.sig', CHECK_MS)])
    .then((r) => {
      if (!verified(r[0], r[1].toString('utf8'))) throw new Error('Assinatura inválida');
      manifest = JSON.parse(r[0].toString('utf8'));
      if (manifest.bundleVersion <= activeBundle().version || manifest.bundleVersion === readInt(REJECTED)) return false;
      emit({ phase: 'download', percent: 0 });
      let lastPct = -1;
      return get(BASE + manifest.bundle, DOWNLOAD_MS, (got, total) => {
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct !== lastPct) { lastPct = pct; emit({ phase: 'download', percent: pct }); }
      }).then((gz) => {
        const sha = crypto.createHash('sha256').update(gz).digest('hex');
        if (sha !== manifest.bundleSha256) throw new Error('Arquivo baixado não confere');
        emit({ phase: 'installing' });
        mkdirp(BUNDLES);
        install(manifest.bundleVersion, gz);
        return true;
      });
    })
    .catch((e) => { log('atualização: ' + e.message); return false; });
}

// ---------- servidor ----------
let serverPort = 0;

function startFrom(bundle) {
  process.env.IPTVKZ_DATA = path.join(DATA, 'data');
  process.env.IPTVKZ_WEB = path.join(bundle.dir, 'web');
  process.env.IPTVKZ_KEEPALIVE = '1';
  return require(path.join(bundle.dir, 'server.js')).start({ host: '0.0.0.0', port: 8787, portFallback: true, keepAlive: true, pairing: true });
}

function startServer() {
  const bundle = activeBundle();
  return Promise.resolve().then(() => startFrom(bundle)).catch((e) => {
    log('servidor v' + bundle.version + ': ' + e.stack);
    if (bundle.dir === BUILTIN) throw e;
    // a versão baixada não subiu: marca como ruim e volta para a que veio no IPK
    fs.writeFileSync(REJECTED, String(bundle.version));
    return startFrom({ version: builtinVersion(), dir: BUILTIN });
  }).then((r) => { serverPort = r.port; return r.port; });
}

let running = false;
function boot() {
  if (running) return;
  running = true;
  update().then((installed) => {
    if (installed && serverPort) {
      // o servidor antigo já está na memória: reinicia o serviço; a abertura chama de novo
      emit({ phase: 'restart' });
      setTimeout(() => process.exit(0), 400);
      return null;
    }
    if (installed) emit({ phase: 'restart' });
    return (serverPort ? Promise.resolve(serverPort) : startServer()).then((port) => {
      running = false;
      emit({ phase: 'ready', port, version: activeBundle().version });
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
