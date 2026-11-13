// IPTVKZ: servidor local. Serve a interface, guarda os dados em data/,
// normaliza listas, processa o guia e faz proxy dos streams. Aceita o próprio PC e,
// se o "acesso pela rede" estiver ligado, aparelhos da rede de casa (TV).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { UA } = require('./util');
const store = require('./store');
const catalogs = require('./catalog');
const epg = require('./epg');
const net = require('./network');
const sessions = require('./sessions');
const { sendText } = require('./compress');
const pairing = require('./pairing');
const backup = require('./backup');
const ffmpeg = require('./ffmpeg');
const cast = require('./cast');

let PORT = Number(process.env.PORT) || 8787; // porta real (pode mudar no app de computador)
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = process.env.IPTVKZ_WEB || path.join(__dirname, '..', 'web');

// Versão, número da build e modo (produção/desenvolvimento), mostrados em Configurações → Sobre.
// scripts/build-info.js grava o arquivo na pasta da interface ao gerar cada pacote; rodando pelo código não há
// arquivo, e aí é desenvolvimento com a versão do package.json. Lido uma vez: uma atualização reinicia o app.
let buildCache = null;
function buildInfo() {
  if (buildCache) return buildCache;
  try {
    buildCache = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'build-info.json'), 'utf8'));
  } catch {
    let version = null;
    try { version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch {}
    buildCache = { version, build: null, channel: 'desenvolvimento', source: 'codigo', commit: null, date: null };
  }
  return buildCache;
}
const IDLE_MS = 5 * 60 * 1000;
const KEEPALIVE = (process.env.IPTVKZ_KEEPALIVE || process.env.MINHATV_KEEPALIVE) === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

let lastSeen = Date.now();
// Ganchos do app de computador (Electron): sair e "iniciar com o sistema".
const hooks = { onQuit: () => process.exit(0), autostart: null };
let openStreams = 0;

// ---------- helpers ----------

function sendJson(res, status, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Conteúdo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  return buf.length ? JSON.parse(buf.toString('utf8')) : {};
}

function requireList(id) {
  const list = id && store.getList(id);
  if (!list) {
    const err = new Error('Lista não encontrada');
    err.status = 404;
    throw err;
  }
  return list;
}

// ---------- proxy ----------

function proxied(u) {
  return '/proxy?url=' + encodeURIComponent(u);
}

function rewriteM3U8(text, base) {
  const abs = (u) => {
    try { return new URL(u, base).href; } catch { return u; }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxied(abs(u))}"`);
      return proxied(abs(t));
    })
    .join('\n');
}

function looksLikeManifest(url, ct) {
  if ((ct || '').toLowerCase().includes('mpegurl')) return true;
  try { return new URL(url).pathname.toLowerCase().endsWith('.m3u8'); } catch { return false; }
}

const PROXY_CONNECT_MS = 20000;

async function handleProxy(req, res, query) {
  let target;
  try {
    target = new URL(query.get('url'));
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('URL inválida');
  }

  const headers = { 'User-Agent': UA, Accept: '*/*' };
  if (req.headers.range) headers.Range = req.headers.range;

  const controller = new AbortController();
  res.on('close', () => controller.abort());
  // Servidor da lista que aceita a conexão e nunca responde: desiste depois de um tempo, em vez de deixar a
  // conexão pendurada (ela conta no limite de telas da lista). Só até a resposta começar; o vídeo pode durar horas.
  let timedOut = false;
  const connectTimer = setTimeout(() => { timedOut = true; controller.abort(); }, PROXY_CONNECT_MS);

  let upstream;
  try {
    upstream = await fetch(target.href, { headers, redirect: 'follow', signal: controller.signal });
    clearTimeout(connectTimer);
  } catch (err) {
    clearTimeout(connectTimer);
    if (timedOut && !res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('O servidor da lista não respondeu');
    }
    if (controller.signal.aborted) return;
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Falha ao conectar: ' + (err.cause?.code || err.message));
  }

  const ct = upstream.headers.get('content-type') || '';
  const finalUrl = upstream.url || target.href;
  // Sem Access-Control-Allow-Origin: só a própria interface (mesma origem) lê o que o proxy traz.
  const out = { 'Cache-Control': 'no-store' };

  if (upstream.ok && looksLikeManifest(finalUrl, ct) && !ct.includes('video/mp2t')) {
    const text = await upstream.text();
    if (text.trimStart().startsWith('#EXTM3U') && /#EXT-X-/.test(text)) {
      out['Content-Type'] = 'application/vnd.apple.mpegurl';
      res.writeHead(200, out);
      return res.end(rewriteM3U8(text, finalUrl));
    }
    out['Content-Type'] = ct || 'text/plain';
    res.writeHead(upstream.status, out);
    return res.end(text);
  }

  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) out[h] = v;
  }
  res.writeHead(upstream.status, out);
  if (!upstream.body) return res.end();

  openStreams++;
  let closed = false;
  const done = () => {
    if (!closed) {
      closed = true;
      openStreams--;
      lastSeen = Date.now();
    }
  };
  res.on('close', done);
  Readable.fromWeb(upstream.body)
    .on('error', () => res.destroy())
    .pipe(res);
}

// ---------- API ----------

// Endereço deste aparelho que a TV alcança: o da mesma rede que ela (primeiros 3 números do IP), senão o primeiro.
function addressFacing(tvIp) {
  const addrs = net.lanAddresses().filter((a) => !a.virtual);
  const prefix = String(tvIp).split('.').slice(0, 3).join('.') + '.';
  const same = addrs.find((a) => a.address.startsWith(prefix));
  return (same || addrs[0] || { address: '127.0.0.1' }).address;
}

// O FFmpeg lê o vídeo pelo proxy do próprio servidor (User-Agent da lista, redirecionamentos, HTTPS).
const localProxy = (u) => `http://127.0.0.1:${PORT}/proxy?url=${encodeURIComponent(u)}`;

const catalogText = new Map(); // listId -> { updatedAt, text }

function serializeCatalog(catalog) {
  const c = catalogText.get(catalog.listId);
  if (c && c.updatedAt === catalog.updatedAt) return c.text;
  const text = catalogs.fullText(catalog);
  catalogText.set(catalog.listId, { updatedAt: catalog.updatedAt, text });
  return text;
}

// Quantas telas a conta permite. Guarda por 2 min e nunca segura o play por mais de 2,5s.
const limits = new Map();
function accountLimit(list) {
  const c = limits.get(list.id);
  if (c && Date.now() - c.at < 120000) return Promise.resolve(c.value);
  const fresh = catalogs.checkStatus(list).then((r) => {
    const value = r.maxCons || null;
    limits.set(list.id, { at: Date.now(), value });
    return value;
  }).catch(() => (c ? c.value : null));
  return Promise.race([fresh, new Promise((done) => setTimeout(() => done(c ? c.value : null), 2500))]);
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;
  const m = req.method;

  if (p === '/api/ping') return sendJson(res, 200, { ok: true });

  // Assistir na TV (Cast e DLNA): procurar TVs, tocar, controlar. O vídeo sai pelo proxy deste servidor.
  if (p === '/api/cast/devices' && m === 'GET') return sendJson(res, 200, await cast.devices(q.get('fresh') === '1'));
  if (p === '/api/cast/status' && m === 'GET') return sendJson(res, 200, await cast.status());
  if (p === '/api/cast/play' && m === 'POST') {
    const b = JSON.parse((await readBody(req)).toString() || '{}');
    if (!/^https?:\/\//i.test(b.url || '')) return sendJson(res, 400, { error: 'Vídeo inválido' });
    return sendJson(res, 200, await cast.play({
      id: b.id, url: b.url, title: String(b.title || '').slice(0, 200), live: !!b.live, startAt: Number(b.startAt) || 0,
      // a TV busca o vídeo direto no provedor: continua tocando mesmo com este aparelho desligado
      mediaUrl: () => b.url,
    }));
  }
  if (p === '/api/cast/control' && m === 'POST') {
    const b = JSON.parse((await readBody(req)).toString() || '{}');
    return sendJson(res, 200, await cast.control(String(b.action), Number(b.t) || 0));
  }

  // Componente opcional de vídeo do PC (FFmpeg reduzido): estado, download e leitura das faixas de um vídeo.
  if (p === '/api/ffmpeg' && m === 'GET') return sendJson(res, 200, ffmpeg.status());
  if (p === '/api/ffmpeg/install' && m === 'POST') return sendJson(res, 200, ffmpeg.install());
  if (p === '/api/ffmpeg/probe' && m === 'GET') {
    if (!ffmpeg.installed()) return sendJson(res, 409, { error: 'Componente não instalado' });
    return sendJson(res, 200, await ffmpeg.probe(localProxy(q.get('url'))));
  }

  // Baixar lista / Carregar lista direto no navegador (computador), sem celular.
  if (p === '/api/list-export' && m === 'GET') {
    const data = backup.build(q.get('list'));
    if (!data) return sendJson(res, 404, { error: 'Lista não encontrada.' });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="iptvkz-lista-${backup.slug(data.state.lists[0].name)}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify(data));
  }
  if (p === '/api/list-import' && m === 'POST') {
    let data;
    try { data = backup.parse((await readBody(req, 60 * 1024 * 1024)).toString('utf8')); } catch (err) { return sendJson(res, 400, { error: err.message }); }
    if (q.get('dry') === '1') return sendJson(res, 200, { summary: backup.summary(data) });
    for (const id of backup.apply(data)) {
      catalogs.forget(id);
      epg.forget(id);
    }
    catalogText.clear();
    return sendJson(res, 200, { ok: true });
  }

  if (p.startsWith('/api/pair/')) {
    if (!req.isLocal) return sendJson(res, 403, { error: 'Só na própria TV' });
    if (p === '/api/pair/start' && m === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      return sendJson(res, 200, pairing.begin(PORT, body.address, body.list, body.mode));
    }
    if (p === '/api/pair/status' && m === 'GET') return sendJson(res, 200, pairing.status(q.get('token')));
    if (p === '/api/pair/restore' && m === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const data = pairing.takeRestore(body.token);
      if (!data) return sendJson(res, 410, { error: 'O backup não está mais disponível. Envie de novo pelo celular.' });
      for (const id of backup.apply(data)) {
        catalogs.forget(id);
        epg.forget(id);
      }
      catalogText.clear();
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/pair/end' && m === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      pairing.end(body.token);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (p === '/api/state' && m === 'GET') {
    return sendJson(res, 200, { ...store.getState(), dataDir: store.DATA, local: req.isLocal, host: req.isLocal ? os.hostname() : null, build: buildInfo() });
  }

  if (p === '/api/info' && m === 'GET') {
    return sendJson(res, 200, {
      local: req.isLocal,
      lanAccess: net.lanEnabled(),
      addresses: net.lanAddresses(),
      port: PORT,
      autostart: hooks.autostart ? hooks.autostart.get() : net.autostartEnabled(),
      desktop: !!hooks.autostart,
    });
  }

  // Daqui pra baixo, ações que só fazem sentido no próprio PC.
  if (!req.isLocal && ['/api/quit', '/api/autostart'].includes(p)) {
    return sendJson(res, 403, { error: 'Disponível só no computador.' });
  }

  if (p === '/api/autostart' && m === 'POST') {
    const body = await readJsonBody(req);
    const on = hooks.autostart ? await hooks.autostart.set(!!body.on) : await net.setAutostart(!!body.on);
    return sendJson(res, 200, { autostart: on });
  }

  if (p.startsWith('/api/state/') && (m === 'PUT' || m === 'POST')) {
    const key = p.slice('/api/state/'.length);
    store.setState(key, await readJsonBody(req));
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/catalog' && m === 'GET') {
    const list = requireList(q.get('list'));
    const force = q.get('refresh') === '1';
    if (force) {
      catalogs.forget(list.id);
      epg.forget(list.id);
    }
    // Uma seção só (live, movies, series): a tela pede a que vai mostrar primeiro e as outras depois.
    // Na primeira carga de uma lista Xtream, a seção vem assim que chega do provedor (partial).
    const section = q.get('section');
    if (catalogs.SECTIONS.includes(section)) {
      const r = await catalogs.getSection(list, section, { force, wait: q.get('wait') === '1' });
      const head = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (force) {
        const url = epg.sourceUrl(list, r.catalog || r.meta);
        if (url) epg.refresh(list.id, url).catch(() => {});
      }
      if (r.partial) {
        const body = `{"refreshing":false,"building":true,"catalog":${JSON.stringify({ ...r.meta, [section]: r.data })}}`;
        return sendText(req, res, 200, head, body);
      }
      const parts = catalogs.partsOf(r.catalog);
      const body = `{"refreshing":${r.refreshing},"building":${r.building},"catalog":{${parts.meta},"${section}":${parts[section]}}}`;
      const memo = r.refreshing || r.building ? null : parts.memo[section] || (parts.memo[section] = {});
      return sendText(req, res, 200, head, body, memo);
    }
    const { catalog, refreshing } = await catalogs.getCatalog(list, { force });
    const epgUrl = force && epg.sourceUrl(list, catalog);
    if (epgUrl) epg.refresh(list.id, epgUrl).catch(() => {});
    const body = `{"refreshing":${refreshing},"catalog":${serializeCatalog(catalog)}}`;
    // 19 MB viram poucos MB: é o que mais pesa ao abrir o app na TV
    const memo = refreshing ? null : catalogText.get(catalog.listId);
    return sendText(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body, memo);
  }

  if (p === '/api/sessions' && m === 'GET') {
    const list = requireList(q.get('list'));
    return sendJson(res, 200, { others: sessions.others(list.id, q.get('device')), maxCons: await accountLimit(list) });
  }
  if (p === '/api/sessions/heartbeat' && m === 'POST') return sendJson(res, 200, sessions.heartbeat(await readJsonBody(req)));
  if (p === '/api/sessions/end' && m === 'POST') {
    sessions.end((await readJsonBody(req)).device);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/sessions/stop' && m === 'POST') {
    const b = await readJsonBody(req);
    sessions.stop(b.target, b.name);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/sessions/gone' && m === 'GET') return sendJson(res, 200, { gone: sessions.isGone(q.get('target')) });

  if (p === '/api/net' && m === 'GET') return sendJson(res, 200, await net.checkInternet());

  if (p === '/api/list-speed' && m === 'POST') {
    const b = await readJsonBody(req);
    // a senha pode não vir (lista já salva): usa a da lista guardada
    const saved = b.id ? store.getList(b.id) : null;
    const cfg = { server: b.server, servers: b.servers, username: b.username || (saved && saved.username), password: b.password || (saved && saved.password) };
    if (!cfg.server || !cfg.username) return sendJson(res, 400, { error: 'Preencha servidor e usuário.' });
    return sendJson(res, 200, await catalogs.speedTest(cfg));
  }

  if (p === '/api/list-status' && m === 'GET') {
    return sendJson(res, 200, await catalogs.checkStatus(requireList(q.get('list'))));
  }

  // medições do carregamento das listas (modo de depuração e testes de desempenho), só no próprio aparelho
  if (p === '/api/diag' && m === 'GET') {
    if (!req.isLocal) return sendJson(res, 403, { error: 'Só no próprio aparelho' });
    return sendJson(res, 200, { ...require('./diag').last, memMB: Math.round(process.memoryUsage().rss / 1048576), node: process.version });
  }
  if (p === '/api/catalog/status' && m === 'GET') {
    const id = q.get('list');
    return sendJson(res, 200, { refreshing: catalogs.isRefreshing(id), updatedAt: catalogs.updatedAtOf(id), progress: catalogs.progressOf(id) });
  }

  if (p === '/api/m3u' && m === 'POST') {
    const id = q.get('list');
    if (!/^[\w-]+$/.test(id || '')) return sendJson(res, 400, { error: 'id inválido' });
    const buf = await readBody(req, 300 * 1024 * 1024);
    fs.writeFileSync(store.file(`m3u-${id}.m3u`), buf);
    catalogs.forget(id);
    return sendJson(res, 200, { ok: true, bytes: buf.length });
  }

  if (p === '/api/list' && m === 'DELETE') {
    const id = q.get('list');
    if (!/^[\w-]+$/.test(id || '')) return sendJson(res, 400, { error: 'id inválido' });
    catalogs.forget(id);
    epg.forget(id);
    catalogText.delete(id);
    store.removeListFiles(id);
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/series' && m === 'GET') {
    const list = requireList(q.get('list'));
    return sendJson(res, 200, await catalogs.xtreamSeriesInfo(list, q.get('xid')));
  }

  if (p === '/api/vod' && m === 'GET') {
    const list = requireList(q.get('list'));
    return sendJson(res, 200, await catalogs.xtreamVodInfo(list, q.get('xid')));
  }

  if (p === '/api/epg' && m === 'POST') {
    const body = await readJsonBody(req);
    const list = requireList(body.list);
    // só o endereço do guia: ler o catálogo inteiro do disco a cada consulta pesava segundos na TV e no celular
    return sendJson(res, 200, epg.query(list, { epgUrl: catalogs.epgUrlOf(list.id) }, body.chans, { force: !!body.force }));
  }

  if (p === '/api/quit' && m === 'POST') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => hooks.onQuit(), 200);
    return;
  }

  return sendJson(res, 404, { error: 'Rota não encontrada' });
}

// ---------- estáticos ----------

const staticGz = new Map();

// App Beta (qualquer build fora da versão publicada, e rodando pelo código): a página nasce com a classe "beta"
// (tema âmbar, ver app.css) e os logos saem na versão âmbar (img/*-beta.*, de scripts/make-beta-icons.py).
const isBeta = () => buildInfo().channel !== 'producao';
const BETA_IMG = /^\/img\/(logo-horizontal|logo-sidebar|icon|icon-192|icon-small|icon-256)\.(png|webp)$/;

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = null; }
  if (rel === '/') rel = '/index.html';
  if (rel && isBeta() && BETA_IMG.test(rel)) rel = rel.replace(/\.(png|webp)$/, '-beta.$1');
  const file = rel && !rel.includes('\0') ? path.normalize(path.join(PUBLIC, rel)) : '';
  // com o separador no fim, "src/web-outra" não passa por "src/web"
  if (!file.startsWith(path.join(PUBLIC, path.sep))) {
    res.writeHead(403);
    return res.end();
  }
  const missing = () => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  };
  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()) return missing();
    // o aparelho pergunta se mudou; sem mudança, não baixa de novo
    const etag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
    // Cache: tocadores com a versão no endereço (?v=) ficam até a próxima versão; imagens e bibliotecas, um dia.
    // Página e código do app são sempre conferidos (o ETag evita baixar de novo o que não mudou).
    const versioned = rel.startsWith('/vendor/') && /[?&]v=[^&]+/.test(req.url);
    const longLived = rel.startsWith('/vendor/') || rel.startsWith('/img/') || /^\/favicon/.test(rel);
    const cache = versioned ? 'public, max-age=31536000, immutable' : longLived ? 'public, max-age=86400' : 'no-cache';
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) return missing();
      if (rel === '/index.html' && isBeta()) data = Buffer.from(data.toString('utf8').replace('<html lang="pt-BR">', '<html lang="pt-BR" class="beta">'));
      if (/^(text|application\/json)|javascript|svg/.test(headers['Content-Type'])) {
        let memo = staticGz.get(file);
        if (!memo || memo.etag !== etag) staticGz.set(file, (memo = { etag }));
        return sendText(req, res, 200, headers, data, memo);
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

// ---------- servidor ----------

const BLOCKED_PAGE = `<!doctype html><meta charset="utf-8"><title>IPTVKZ</title>
<body style="background:#0a0a0f;color:#eee;font:22px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
<div><h1 style="color:#ff2a2a">IPTVKZ</h1><p>O acesso pela rede está desligado.</p>
<p style="color:#999">No computador, abra Configurações → TV e outros aparelhos → ligue “Permitir acesso pela rede”.</p></div>`;

const FORBIDDEN = (res, text) => {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
};

const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress;
  req.isLocal = net.isLoopback(ip);
  // Um site aberto no navegador não pode usar o servidor: nem por um domínio apontado para cá
  // (DNS rebinding) nem mandando pedidos de outra origem (CSRF).
  if (!net.allowedHost(req.headers.host)) return FORBIDDEN(res, 'Endereço não permitido. Use o IP do aparelho.');
  if (!net.sameOrigin(req.headers.origin, req.headers.host)) return FORBIDDEN(res, 'Origem não permitida.');
  // cadastro pelo celular: só esta rota, com chave de uso único, e só de redes domésticas
  if (pairing.enabled() && net.isPrivate(ip) && req.url.startsWith('/pair/')) {
    return pairing.handle(req, res, new URL(req.url, 'http://localhost'));
  }
  // a TV que está recebendo uma transmissão (Assistir na TV) busca o vídeo, mesmo sem o acesso pela rede ligado
  const castMedia = cast.allowed(ip) && req.url.startsWith('/proxy?');
  if (!req.isLocal && !castMedia && !(net.isPrivate(ip) && net.lanEnabled())) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(BLOCKED_PAGE);
  }
  lastSeen = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/proxy') {
    handleProxy(req, res, url.searchParams).catch((err) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(err.message || err));
    });
    return;
  }
  // vídeo com o áudio convertido pelo componente do PC (só para quem usa este servidor)
  if (url.pathname === '/remux') {
    if (!ffmpeg.installed() || !/^https?:\/\//i.test(url.searchParams.get('url') || '')) { res.writeHead(404); return res.end(); }
    openStreams++;
    res.on('close', () => { openStreams--; });
    const n = (k) => Math.max(0, Number(url.searchParams.get(k)) || 0);
    ffmpeg.stream(req, res, localProxy(url.searchParams.get('url')), { start: n('start'), audio: n('audio'), hevc: url.searchParams.get('hevc') === '1', video: String(url.searchParams.get('video') || '').slice(0, 20) });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      if (res.headersSent) return res.end();
      sendJson(res, err.status || 500, { error: err.message || String(err) });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});
// A primeira carga de uma lista grande, num provedor lento, fica minutos no mesmo pedido (/api/catalog): o
// padrão do Node (5 min) cortaria. Quem limita é o download (util.readText), não o servidor.
server.requestTimeout = 0;

// Inicia o servidor. Rodando direto (`npm start`) usa a porta fixa e encerra se ela já estiver
// ocupada; no app de computador tenta as próximas portas e não desliga por inatividade.
// idleMs (TV LG): encerra depois desse tempo sem a interface aberta e sem vídeo tocando, mesmo com
// keepAlive. A interface avisa a cada minuto (core/lifeline.js); fechar o app para os avisos.
function start({ port = PORT, host = HOST, keepAlive = KEEPALIVE, portFallback = false, onQuit, autostart, pairing: withPairing, idleMs } = {}) {
  if (withPairing) pairing.enable();
  if (onQuit) hooks.onQuit = onQuit;
  if (autostart) hooks.autostart = autostart;
  return new Promise((resolve, reject) => {
    let tries = 0;
    const listen = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && portFallback && tries++ < 15) return listen(p + 1);
        reject(err);
      });
      server.listen(p, host, () => {
        PORT = p;
        if (idleMs > 0) {
          setInterval(() => {
            if (openStreams === 0 && Date.now() - lastSeen > idleMs) {
              console.log('App fechado, encerrando.');
              hooks.onQuit();
            }
          }, 30000).unref();
        } else if (!keepAlive) {
          setInterval(() => {
            if (net.lanEnabled()) return; // a TV precisa encontrar o servidor ligado
            if (openStreams === 0 && Date.now() - lastSeen > IDLE_MS) {
              console.log('Sem uso há 5 minutos, encerrando.');
              process.exit(0);
            }
          }, 30000).unref();
        }
        resolve({ server, port: p });
      });
    };
    listen(port);
  });
}

module.exports = { start, lanEnabled: net.lanEnabled };

if (require.main === module) {
  start().then(
    ({ port }) => console.log(`
  IPTVKZ rodando em  http://localhost:${port}
`),
    (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`IPTVKZ já está rodando em http://localhost:${PORT}`);
        process.exit(0);
      }
      throw err;
    },
  );
}
