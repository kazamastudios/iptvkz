// Atualização automática da interface e do servidor (só no canal Developer).
// Baixa do GitHub Releases um pacote assinado, confere a assinatura RSA e o SHA-256 e instala ao lado
// do que veio no IPK. O build da LG Content Store (canal Store) não inclui este arquivo.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const nodeUrl = require('url');
const zlib = require('zlib');

const CHECK_MS = 8000;
const DOWNLOAD_MS = 180000;

function get(url, deadline, onData, hops) {
  const finished = [];
  return new Promise((resolve, reject) => {
    const t = nodeUrl.parse(url);
    // HTTPS sempre; HTTP só para testes nesta máquina (127.0.0.1)
    const loopback = t.protocol === 'http:' && (t.hostname === '127.0.0.1' || t.hostname === 'localhost');
    if (t.protocol !== 'https:' && !loopback) return reject(new Error('Só HTTPS'));
    const req = (loopback ? http : https).get({
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

function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  fs.mkdirSync(dir);
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) {
    fs.readdirSync(p).forEach((f) => rmrf(path.join(p, f)));
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}

// base: URL com "/" no fim; publicKey: PEM; bundles: pasta das versões baixadas.
// builtinVersion(): versão que veio no IPK; log/emit: registro e fases para a abertura.
function createUpdater({ base, publicKey, bundles, builtinVersion, log, emit }) {
  const CURRENT = path.join(bundles, 'current');
  const REJECTED = path.join(bundles, 'rejected');
  const readInt = (file) => { try { return parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch (e) { return 0; } };
  const installedDir = (v) => path.join(bundles, String(v));

  // A versão baixada vale se for mais nova que a do IPK, não tiver falhado e estiver inteira.
  function downloaded() {
    const v = readInt(CURRENT);
    if (v > builtinVersion() && v !== readInt(REJECTED) && fs.existsSync(path.join(installedDir(v), 'server.js'))) {
      return { version: v, dir: installedDir(v) };
    }
    return null;
  }

  function reject(version) {
    try { mkdirp(bundles); fs.writeFileSync(REJECTED, String(version)); } catch (e) { log('não marcou a versão ruim: ' + e.message); }
  }

  const verified = (body, signatureB64) => crypto.createVerify('RSA-SHA256').update(body).verify(publicKey, String(signatureB64).trim(), 'base64');

  // Pacote: gzip de um JSON { caminho: base64 }. Grava ao lado e só depois troca o "current".
  function install(version, gz) {
    const files = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
    if (!files['server.js']) throw new Error('Pacote incompleto');
    const tmp = installedDir(version) + '.tmp';
    rmrf(tmp);
    Object.keys(files).forEach((rel) => {
      const target = path.join(tmp, rel);
      if (path.isAbsolute(rel) || path.relative(tmp, target).split(path.sep)[0] === '..') throw new Error('Caminho inválido no pacote');
      mkdirp(path.dirname(target));
      fs.writeFileSync(target, Buffer.from(files[rel], 'base64'));
    });
    rmrf(installedDir(version));
    fs.renameSync(tmp, installedDir(version));
    fs.writeFileSync(CURRENT + '.tmp', String(version));
    fs.renameSync(CURRENT + '.tmp', CURRENT);
    // guarda só a versão em uso, para não ocupar o armazenamento da TV
    fs.readdirSync(bundles).forEach((name) => {
      if (/^\d+$/.test(name) && Number(name) !== version) rmrf(path.join(bundles, name));
    });
  }

  // true = instalou uma versão nova. Sem internet ou GitHub fora, segue com a que já tem.
  function update(activeVersion) {
    emit({ phase: 'checking' });
    let manifest;
    return Promise.all([get(base + 'webos-update.json', CHECK_MS), get(base + 'webos-update.json.sig', CHECK_MS)])
      .then((r) => {
        if (!verified(r[0], r[1].toString('utf8'))) throw new Error('Assinatura inválida');
        manifest = JSON.parse(r[0].toString('utf8'));
        if (!(manifest.bundleVersion > activeVersion) || manifest.bundleVersion === readInt(REJECTED)) return false;
        if (!/^[\w.-]+$/.test(String(manifest.bundle))) throw new Error('Nome de pacote inválido');
        emit({ phase: 'download', percent: 0 });
        let lastPct = -1;
        return get(base + manifest.bundle, DOWNLOAD_MS, (got, total) => {
          const pct = total ? Math.floor((got / total) * 100) : 0;
          if (pct !== lastPct) { lastPct = pct; emit({ phase: 'download', percent: pct }); }
        }).then((gz) => {
          const sha = crypto.createHash('sha256').update(gz).digest('hex');
          if (sha !== manifest.bundleSha256) throw new Error('Arquivo baixado não confere');
          emit({ phase: 'installing' });
          mkdirp(bundles);
          install(manifest.bundleVersion, gz);
          return true;
        });
      })
      .catch((e) => { log('atualização: ' + e.message); return false; });
  }

  return { downloaded, reject, update };
}

module.exports = { createUpdater };
