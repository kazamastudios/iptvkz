// Testes do servidor local (npm test). Tudo roda nesta máquina: as listas, o guia e os "streams"
// são fictícios, gerados aqui mesmo por um servidor de teste em 127.0.0.1. Nenhuma lista real.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-test-'));
process.env.IPTVKZ_DATA = DATA;
const server = require('../src/server/index.js');
const net = require('../src/server/network.js');
const { buildFromM3U, prepareParts } = require('../src/server/catalog.js');

// ---------- provedor fictício ----------

const TS = Buffer.alloc(188 * 50, 0x47);
const XT = { user: 'demo', pass: 's3nha' };
let fake;
let FAKE;

function m3u(n, base) {
  const lines = [`#EXTM3U url-tvg="${base}/guia.xml.gz"`];
  for (let i = 0; i < n; i++) {
    const g = i % 3 === 0 ? 'Filmes' : i % 3 === 1 ? 'Notícias' : 'Série Teste';
    // séries com 10 episódios cada, como numa lista de verdade
    const name = g === 'Série Teste' ? `Série ${Math.floor(i / 30)} S01E${String(Math.floor(i / 3) % 10 + 1).padStart(2, '0')}` : `Canal ${i}`;
    const url = g === 'Filmes' ? `${base}/movie/${i}.mp4` : g === 'Série Teste' ? `${base}/series/${i}.mkv` : `${base}/live/${i}.m3u8`;
    lines.push(`#EXTINF:-1 tvg-id="c${i}" tvg-name="${name}" group-title="${g}",${name}`, url);
  }
  return lines.join('\n');
}

function xmltv() {
  const now = new Date();
  const fmt = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const a = new Date(now.getTime() - 3600000);
  const b = new Date(now.getTime() + 3600000);
  return `<?xml version="1.0"?><tv><channel id="c1"><display-name>Canal 1</display-name></channel>
<programme start="${fmt(a)}" stop="${fmt(b)}" channel="c1"><title>Jornal de teste</title><desc>Fictício</desc></programme></tv>`;
}

function xtreamApi(q, res) {
  // conta "lento": filmes e séries demoram, para testar a seção da tela chegando antes das outras
  const slow = q.get('username') === 'lento';
  if ((q.get('username') !== XT.user && !slow) || q.get('password') !== XT.pass) {
    return res.end(JSON.stringify({ user_info: { auth: 0 } }));
  }
  const action = q.get('action') || '';
  const body = {
    '': { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 30 * 86400), max_connections: '2' } },
    get_live_categories: [{ category_id: 1, category_name: 'Notícias' }],
    get_live_streams: [{ stream_id: 10, name: 'Canal X', category_id: 1, epg_channel_id: 'c1' }],
    get_vod_categories: [{ category_id: 2, category_name: 'Filmes' }],
    get_vod_streams: [{ stream_id: 20, name: 'Filme Teste (2020)', category_id: 2, container_extension: 'mp4' }],
    get_series_categories: [{ category_id: 3, category_name: 'Séries' }],
    get_series: [{ series_id: 30, name: 'Série Teste', category_id: 3 }],
    get_series_info: { info: { name: 'Série Teste' }, episodes: { 1: [{ id: 301, episode_num: 1, title: 'Ep 1', container_extension: 'mp4', season: 1 }] } },
  }[action];
  res.setHeader('Content-Type', 'application/json');
  const send = () => res.end(JSON.stringify(body == null ? [] : body));
  if (slow && ['get_vod_streams', 'get_series'].includes(action)) return setTimeout(send, 1500);
  send();
}

let variant = 'full';
const revalida = [];
const gzipPedidos = [];
const PICADA = '\ufeff' + m3u(40, 'http://exemplo.invalid').replace(/Canal/g, 'Canal Ação São João').split('\n').join('\r\n');

function startFake() {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/lista.m3u') return res.end(m3u(30, FAKE));
    // lista que muda a cada teste: inteira, cortada no meio, uma página no lugar, ou bem menor
    if (u.pathname === '/varia.m3u') {
      const full = m3u(120, FAKE);
      if (variant === 'cut') {
        res.writeHead(200, { 'Content-Length': Buffer.byteLength(full) });
        res.write(full.slice(0, 2000));
        return setTimeout(() => res.destroy(), 50);
      }
      if (variant === 'html') return res.end('<!doctype html><html><body>Conta suspensa</body></html>');
      return res.end(variant === 'small' ? m3u(6, FAKE) : full);
    }
    // em pedaços de 7 bytes (acento partido entre pedaços), com BOM, quebras do Windows e sem quebra no fim
    if (u.pathname === '/picada.m3u') {
      const buf = Buffer.from(PICADA, 'utf8');
      res.writeHead(200, { 'Content-Length': buf.length });
      let i = 0;
      const next = () => { if (i >= buf.length) return res.end(); res.write(buf.subarray(i, i += 7)); setImmediate(next); };
      return next();
    }
    // revalidação: ?modo=etag (manda ETag), lm (manda Last-Modified) ou nada (não manda nenhum e ignora os pedidos
    // condicionais). Cada pedido fica anotado em revalida, com os cabeçalhos recebidos e o código respondido.
    if (u.pathname === '/revalida.m3u') {
      const modo = u.searchParams.get('modo');
      const inm = req.headers['if-none-match'] || null;
      const ims = req.headers['if-modified-since'] || null;
      const etag = '"lista-v1"';
      const lm = 'Wed, 11 Nov 2026 10:00:00 GMT';
      const same = (modo === 'etag' && inm === etag) || (modo === 'lm' && ims === lm);
      revalida.push({ modo, inm, ims, status: same ? 304 : 200 });
      const head = modo === 'etag' ? { ETag: etag } : modo === 'lm' ? { 'Last-Modified': lm } : {};
      if (same) { res.writeHead(304, head); return res.end(); }
      res.writeHead(200, head);
      return res.end(m3u(30, FAKE));
    }
    // comprimida quando o pedido aceita gzip; ?cortada=1 corta a conexão no meio
    if (u.pathname === '/gzip.m3u') {
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      gzipPedidos.push(gz);
      const body = gz ? zlib.gzipSync(m3u(90, FAKE)) : Buffer.from(m3u(90, FAKE));
      res.writeHead(200, gz ? { 'Content-Encoding': 'gzip', 'Content-Length': body.length } : { 'Content-Length': body.length });
      if (!u.searchParams.get('cortada')) return res.end(body);
      res.write(body.subarray(0, Math.floor(body.length / 2)));
      return setTimeout(() => res.destroy(), 50);
    }
    // lista sem o cabeçalho #EXTM3U (começa direto no #EXTINF): muitos provedores mandam assim
    if (u.pathname === '/sem-cabecalho.m3u') return res.end(m3u(12, FAKE).split('\n').slice(1).join('\n'));
    if (u.pathname === '/grande.m3u') return res.end(m3u(Number(u.searchParams.get('n')), FAKE));
    if (u.pathname === '/guia.xml.gz') return res.end(zlib.gzipSync(xmltv()));
    if (u.pathname === '/player_api.php') return xtreamApi(u.searchParams, res);
    if (u.pathname.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="chave.bin"\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nhttp://outro.invalid/seg2.ts\n');
    }
    if (u.pathname.endsWith('.ts')) {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : TS.length - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${TS.length}`, 'Content-Length': end - start + 1 });
        return res.end(TS.subarray(start, end + 1));
      }
      return res.end(TS);
    }
    if (u.pathname === '/lento.ts') return; // nunca responde
    res.writeHead(404);
    res.end();
  });
  return new Promise((r) => fake.listen(0, '127.0.0.1', () => { FAKE = `http://127.0.0.1:${fake.address().port}`; r(); }));
}

// ---------- cliente ----------

let BASE;
let HOSTPORT;

function request(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + p, { method, headers: { Host: HOSTPORT, ...headers } }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(parts);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8'), json });
      });
    });
    req.on('error', reject);
    if (body != null) req.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    else req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('tempo esgotado');
    await sleep(100);
  }
}

async function addLists(lists) {
  const current = (await request('GET', '/api/state')).json.lists.filter((l) => !lists.some((n) => n.id === l.id));
  const r = await request('PUT', '/api/state/lists', { body: [...current, ...lists], headers: { 'Content-Type': 'application/json' } });
  assert.strictEqual(r.status, 200);
}

test.before(async () => {
  await startFake();
  const { port } = await server.start({ port: 18787, host: '127.0.0.1', portFallback: true, keepAlive: true, pairing: true });
  BASE = `http://127.0.0.1:${port}`;
  HOSTPORT = `127.0.0.1:${port}`;
});

test.after(() => {
  fake.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  setImmediate(() => process.exit(0)); // o servidor do app não tem stop()
});

// ---------- segurança ----------

test('Host: aceita IP e nomes locais, recusa domínio de fora (DNS rebinding)', async () => {
  for (const h of ['127.0.0.1:8787', 'localhost:8787', '192.168.0.10:8787', '[::1]:8787', 'minha-tv:8787', 'tv.local', 'pc.lan', undefined]) {
    assert.ok(net.allowedHost(h), String(h));
  }
  for (const h of ['evil.com', 'rebind.attacker.net:8787', '127.0.0.1.nip.io']) assert.ok(!net.allowedHost(h), h);
  const r = await request('GET', '/api/state', { headers: { Host: 'rebind.attacker.net:8787' } });
  assert.strictEqual(r.status, 403);
});

test('Origin: outra origem não lê nem grava (CSRF)', async () => {
  const evil = { Origin: 'http://evil.com' };
  assert.strictEqual((await request('GET', '/api/state', { headers: evil })).status, 403);
  assert.strictEqual((await request('POST', '/api/state/settings', { headers: { ...evil, 'Content-Type': 'text/plain' }, body: '{}' })).status, 403);
  assert.strictEqual((await request('GET', '/api/state', { headers: { Origin: 'null' } })).status, 403);
  const same = await request('POST', '/api/state/catPrefs', { headers: { Origin: BASE }, body: {} });
  assert.strictEqual(same.status, 200);
});

test('estáticos: interface sai, código do servidor e caminhos estranhos não', async () => {
  const home = await request('GET', '/');
  assert.strictEqual(home.status, 200);
  assert.match(home.text, /<html/i);
  for (const p of ['/../server/index.js', '/%2e%2e/server/index.js', '/..%2fserver%2findex.js', '/%E0%A4%A', '/a%00b']) {
    const r = await request('GET', p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.strictEqual((await request('GET', '/api/ping')).status, 200, 'servidor continua de pé');
});

test('proxy: sem CORS aberto, só http(s)', async () => {
  const r = await request('GET', '/proxy?url=' + encodeURIComponent(FAKE + '/live/1.ts'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['access-control-allow-origin'], undefined);
  for (const bad of ['file:///etc/passwd', 'ftp://x/y', 'nada']) {
    assert.strictEqual((await request('GET', '/proxy?url=' + encodeURIComponent(bad))).status, 400);
  }
});

// ---------- reprodução ----------

test('HLS: manifesto reescrito para passar pelo proxy (segmentos e chave)', async () => {
  const r = await request('GET', '/proxy?url=' + encodeURIComponent(FAKE + '/live/1.m3u8'));
  assert.strictEqual(r.status, 200);
  assert.match(r.headers['content-type'], /mpegurl/);
  const lines = r.text.split('\n');
  assert.ok(lines.includes('/proxy?url=' + encodeURIComponent(FAKE + '/live/seg1.ts')));
  assert.ok(lines.includes('/proxy?url=' + encodeURIComponent('http://outro.invalid/seg2.ts')));
  assert.ok(r.text.includes(`URI="/proxy?url=${encodeURIComponent(FAKE + '/live/chave.bin')}"`));
});

test('MPEG-TS: repassa bytes e pedidos parciais (Range)', async () => {
  const all = await request('GET', '/proxy?url=' + encodeURIComponent(FAKE + '/live/9.ts'));
  assert.strictEqual(all.buf.length, TS.length);
  const part = await request('GET', '/proxy?url=' + encodeURIComponent(FAKE + '/live/9.ts'), { headers: { Range: 'bytes=188-375' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.buf.length, 188);
  assert.match(part.headers['content-range'], /^bytes 188-375\//);
});

test('proxy: servidor fora do ar vira 502, sem derrubar nada', async () => {
  const r = await request('GET', '/proxy?url=' + encodeURIComponent('http://127.0.0.1:1/x.ts'));
  assert.strictEqual(r.status, 502);
});

test('troca rápida de canais: pedidos cancelados no meio não travam o servidor', async () => {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => {
      const req = http.get(BASE + '/proxy?url=' + encodeURIComponent(FAKE + `/live/${i}.ts`), { headers: { Host: HOSTPORT } }, (res) => { res.destroy(); resolve(); });
      req.on('error', resolve);
    });
  }
  const r = await request('GET', '/proxy?url=' + encodeURIComponent(FAKE + '/live/1.ts'));
  assert.strictEqual(r.buf.length, TS.length);
});

// ---------- listas ----------

test('M3U por link: canais, filmes e séries separados; atualizar lista', async () => {
  await addLists([{ id: 'm3uurl', type: 'm3u', source: 'url', name: 'Teste', url: FAKE + '/lista.m3u' }]);
  const r = await request('GET', '/api/catalog?list=m3uurl');
  assert.strictEqual(r.status, 200);
  const c = r.json.catalog;
  assert.strictEqual(c.live.items.length, 10);
  assert.strictEqual(c.movies.items.length, 10);
  assert.ok(c.series.items.length >= 1);
  const again = await request('GET', '/api/catalog?list=m3uurl&refresh=1');
  assert.ok(again.json.catalog.updatedAt >= c.updatedAt);
});

test('M3U por arquivo enviado', async () => {
  const up = await request('POST', '/api/m3u?list=m3ufile', { body: m3u(12, 'http://exemplo.invalid') });
  assert.strictEqual(up.status, 200);
  await addLists([{ id: 'm3ufile', type: 'm3u', source: 'file', name: 'Arquivo' }]);
  const r = await request('GET', '/api/catalog?list=m3ufile');
  assert.strictEqual(r.json.catalog.live.items.length, 4);
  assert.strictEqual((await request('POST', '/api/m3u?list=../x', { body: 'a' })).status, 400);
});

test('Xtream: login, catálogo, série sob demanda e senha errada', async () => {
  await addLists([
    { id: 'xt', type: 'xtream', name: 'XT', server: FAKE, username: XT.user, password: XT.pass },
    { id: 'xtbad', type: 'xtream', name: 'XT ruim', server: FAKE, username: XT.user, password: 'errada' },
  ]);
  const r = await request('GET', '/api/catalog?list=xt');
  assert.strictEqual(r.status, 200);
  const c = r.json.catalog;
  assert.strictEqual(c.live.items[0].url, `${FAKE}/live/demo/s3nha/10.m3u8`);
  assert.strictEqual(c.movies.items.length, 1);
  const s = await request('GET', `/api/series?list=xt&xid=30`);
  assert.strictEqual(s.status, 200);
  const status = await request('GET', '/api/list-status?list=xt');
  assert.strictEqual(status.json.state, 'active');
  const bad = await request('GET', '/api/catalog?list=xtbad');
  assert.strictEqual(bad.status, 500);
  assert.match(bad.json.error, /inválidos/);
  assert.ok(!bad.text.includes('errada'), 'a mensagem de erro não mostra a senha');
});

test('Xtream: a seção da tela chega antes das outras, e as outras esperam a mesma carga', async () => {
  await addLists([{ id: 'xtslow', type: 'xtream', name: 'XT lento', server: FAKE, username: 'lento', password: XT.pass }]);
  const t0 = Date.now();
  const live = await request('GET', '/api/catalog?list=xtslow&section=live');
  assert.strictEqual(live.status, 200);
  assert.ok(Date.now() - t0 < 1200, `canais chegaram em ${Date.now() - t0} ms, sem esperar filmes e séries`);
  assert.strictEqual(live.json.building, true);
  assert.strictEqual(live.json.catalog.live.items[0].name, 'Canal X');
  assert.strictEqual(live.json.catalog.movies, undefined, 'só a seção pedida');
  const movies = await request('GET', '/api/catalog?list=xtslow&section=movies&wait=1');
  assert.strictEqual(movies.json.catalog.movies.items.length, 1);
  assert.strictEqual(movies.json.catalog.updatedAt, live.json.catalog.updatedAt, 'mesma carga');
  // quando a carga termina, a seção vem da versão guardada (antes disso, ainda pode vir da carga em andamento)
  await until(async () => !(await request('GET', '/api/catalog/status?list=xtslow')).json.refreshing || null);
  const series = await request('GET', '/api/catalog?list=xtslow&section=series');
  assert.strictEqual(series.json.building, false, 'depois de pronta, vem da versão guardada');
  assert.strictEqual(series.json.catalog.series.items[0].name, 'Série Teste');
});

test('catálogo no disco: um arquivo por seção, abre a frio pela seção e some ao excluir a lista', async () => {
  await addLists([{ id: 'sec', type: 'm3u', name: 'Seções', url: `${FAKE}/lista.m3u` }]);
  const first = await request('GET', '/api/catalog?list=sec&section=live');
  assert.strictEqual(first.status, 200);
  const files = () => fs.readdirSync(DATA).filter((f) => f.startsWith('catalog-sec.')).sort();
  // grava por trás: espera o resumo e as três seções
  await until(async () => (files().length === 4 ? true : null));
  assert.ok(files().includes('catalog-sec.meta.json'));
  assert.deepStrictEqual(files().filter((f) => f !== 'catalog-sec.meta.json').map((f) => f.split('.').slice(-2, -1)[0]).sort(), ['live', 'movies', 'series']);
  // abrir a frio: o servidor esquece a lista e lê de novo do disco, seção por seção
  const catalogs = require('../src/server/catalog.js');
  catalogs.forget('sec');
  for (const sec of ['live', 'movies', 'series']) {
    const r = await request('GET', `/api/catalog?list=sec&section=${sec}`);
    assert.strictEqual(r.json.catalog.updatedAt, first.json.catalog.updatedAt);
    assert.ok(Array.isArray(r.json.catalog[sec].items));
  }
  const again = await request('GET', '/api/catalog?list=sec&section=live');
  assert.deepStrictEqual(again.json.catalog.live, first.json.catalog.live, 'mesmo conteúdo lido do disco');
  await request('DELETE', '/api/list?list=sec');
  assert.deepStrictEqual(files(), [], 'excluir a lista apaga os arquivos do catálogo');
});

test('catálogo no formato antigo (um arquivo só) abre e é convertido', async () => {
  await addLists([{ id: 'old', type: 'm3u', name: 'Antiga', url: `${FAKE}/lista.m3u` }]);
  const old = { v: 1, listId: 'old', updatedAt: Date.now(), epgUrl: '', live: { cats: [{ id: 'g1', name: 'Notícias' }], items: [{ id: 'l1', name: 'Canal', cat: 'g1', url: 'http://x/1' }] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] } };
  fs.writeFileSync(path.join(DATA, 'catalog-old.json'), JSON.stringify(old));
  const r = await request('GET', '/api/catalog?list=old&section=live');
  assert.strictEqual(r.json.catalog.live.items[0].name, 'Canal');
  await until(async () => (fs.existsSync(path.join(DATA, 'catalog-old.meta.json')) && !fs.existsSync(path.join(DATA, 'catalog-old.json')) ? true : null));
});

test('atualizar: lista cortada ou página no lugar mantêm a versão guardada, com aviso', async () => {
  variant = 'full';
  await addLists([{ id: 'var', type: 'm3u', name: 'Varia', url: `${FAKE}/varia.m3u` }]);
  const ok = await request('GET', '/api/catalog?list=var&section=live');
  assert.strictEqual(ok.status, 200);
  await until(async () => (fs.existsSync(path.join(DATA, 'catalog-var.meta.json')) ? true : null));
  for (const [v, msg] of [['cut', /incompleta|conectar/], ['html', /página/]]) {
    variant = v;
    const r = await request('GET', '/api/catalog?list=var&section=live&refresh=1');
    assert.strictEqual(r.status, 200, `${v}: a versão guardada continua`);
    assert.match(r.json.warning || '', msg);
    assert.strictEqual(r.json.catalog.updatedAt, ok.json.catalog.updatedAt);
    assert.strictEqual(r.json.catalog.live.items.length, ok.json.catalog.live.items.length);
  }
  // sem versão guardada, o erro vai para a tela
  variant = 'html';
  await addLists([{ id: 'var2', type: 'm3u', name: 'Varia 2', url: `${FAKE}/varia.m3u` }]);
  const bad = await request('GET', '/api/catalog?list=var2&section=live');
  assert.strictEqual(bad.status, 500);
  assert.match(bad.json.error, /página/);
});

test('atualizar: lista bem menor vale, e dá para voltar à anterior', async () => {
  variant = 'small';
  const r = await request('GET', '/api/catalog?list=var&section=live&refresh=1');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.catalog.shrunk, 'avisa que encolheu');
  assert.ok(r.json.catalog.shrunk.after < r.json.catalog.shrunk.before);
  const files = () => fs.readdirSync(DATA).filter((f) => f.startsWith('catalog-var.') && f !== 'catalog-var.meta.json');
  await until(async () => (files().length === 6 ? true : null)); // a nova e a anterior
  const back = await request('POST', '/api/catalog/shrunk?list=var&back=1');
  assert.strictEqual(back.status, 200);
  const after = await request('GET', '/api/catalog?list=var&section=live');
  assert.ok(!after.json.catalog.shrunk);
  assert.ok(after.json.catalog.live.items.length > r.json.catalog.live.items.length, 'a anterior voltou');
  await until(async () => (files().length === 3 ? true : null));
  variant = 'full';
});

// Atualizar a lista com o provedor dizendo que não mudou (304): não baixa nem monta, mantém as seções guardadas e
// renova a data no resumo. full=1 baixa inteira mesmo assim.
async function revalidates(id, modo, header, value) {
  await addLists([{ id, type: 'm3u', name: 'Revalida', url: `${FAKE}/revalida.m3u?modo=${modo}` }]);
  const meta = () => JSON.parse(fs.readFileSync(path.join(DATA, `catalog-${id}.meta.json`), 'utf8'));
  const first = await request('GET', `/api/catalog?list=${id}&section=live`);
  assert.strictEqual(first.status, 200);
  await until(async () => (fs.existsSync(path.join(DATA, `catalog-${id}.meta.json`)) ? true : null));
  assert.strictEqual(meta().validators[header], value, 'validador guardado no resumo');
  const files = meta().files;
  await new Promise((r) => setTimeout(r, 5));
  const n = revalida.length;
  const again = await request('GET', `/api/catalog?list=${id}&section=live&refresh=1`);
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(revalida.slice(n).map((x) => x.status), [304], 'perguntou e o provedor disse que não mudou');
  assert.strictEqual(revalida[n][header === 'etag' ? 'inm' : 'ims'], value);
  assert.ok(!again.json.warning);
  assert.deepStrictEqual(again.json.catalog.live, first.json.catalog.live, 'mesmo conteúdo');
  assert.ok(again.json.catalog.updatedAt > first.json.catalog.updatedAt, 'data renovada');
  assert.strictEqual(meta().updatedAt, again.json.catalog.updatedAt, 'data renovada no resumo guardado');
  assert.strictEqual(meta().files, files, 'mesmas seções no disco');
  // abre a frio: continua lendo as seções guardadas
  require('../src/server/catalog.js').forget(id);
  const cold = await request('GET', `/api/catalog?list=${id}&section=movies`);
  assert.strictEqual(cold.json.catalog.movies.items.length, 10);
  // full=1: baixa inteira, sem perguntar
  const full = await request('GET', `/api/catalog?list=${id}&section=live&refresh=1&full=1`);
  assert.strictEqual(full.status, 200);
  const last = revalida[revalida.length - 1];
  assert.deepStrictEqual([last.status, last.inm, last.ims], [200, null, null]);
  await request('DELETE', `/api/list?list=${id}`);
}

test('atualizar: lista que não mudou (304 com ETag) não é baixada de novo', () => revalidates('rev-etag', 'etag', 'etag', '"lista-v1"'));

test('atualizar: lista que não mudou (304 com Last-Modified) não é baixada de novo', () => revalidates('rev-lm', 'lm', 'lastModified', 'Wed, 11 Nov 2026 10:00:00 GMT'));

test('atualizar: provedor sem ETag nem Last-Modified baixa inteira, como antes', async () => {
  await addLists([{ id: 'rev-nada', type: 'm3u', name: 'Revalida', url: `${FAKE}/revalida.m3u?modo=nada` }]);
  const first = await request('GET', '/api/catalog?list=rev-nada&section=live');
  await until(async () => (fs.existsSync(path.join(DATA, 'catalog-rev-nada.meta.json')) ? true : null));
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog-rev-nada.meta.json'), 'utf8'));
  assert.strictEqual(meta.validators, undefined);
  await new Promise((r) => setTimeout(r, 5));
  const n = revalida.length;
  const again = await request('GET', '/api/catalog?list=rev-nada&section=live&refresh=1');
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(revalida.slice(n), [{ modo: 'nada', inm: null, ims: null, status: 200 }], 'sem pedido condicional');
  assert.ok(again.json.catalog.updatedAt > first.json.catalog.updatedAt);
  assert.deepStrictEqual(again.json.catalog.live, first.json.catalog.live);
  await request('DELETE', '/api/list?list=rev-nada');
});

test('M3U por link: pede a lista comprimida (gzip) e lê igual; comprimida e cortada mantém a anterior', async () => {
  await addLists([{ id: 'gz', type: 'm3u', name: 'Gzip', url: `${FAKE}/gzip.m3u` }]);
  const r = await request('GET', '/api/catalog?list=gz&section=live');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(gzipPedidos, [true], 'pediu gzip');
  const whole = await buildFromM3U(m3u(90, FAKE), { id: 'gz' });
  assert.deepStrictEqual(r.json.catalog.live, JSON.parse(JSON.stringify(whole.live)));
  await until(async () => (fs.existsSync(path.join(DATA, 'catalog-gz.meta.json')) ? true : null));
  await addLists([{ id: 'gz', type: 'm3u', name: 'Gzip', url: `${FAKE}/gzip.m3u?cortada=1` }]);
  const cut = await request('GET', '/api/catalog?list=gz&section=live&refresh=1');
  assert.strictEqual(cut.status, 200);
  assert.ok(cut.json.warning, 'avisa que não atualizou');
  assert.strictEqual(cut.json.catalog.updatedAt, r.json.catalog.updatedAt, 'a versão guardada continua');
  assert.strictEqual(cut.json.catalog.live.items.length, r.json.catalog.live.items.length);
  await request('DELETE', '/api/list?list=gz');
});

test('M3U sem o cabeçalho #EXTM3U: carrega e a verificação não bloqueia a lista', async () => {
  await addLists([{ id: 'semcab', type: 'm3u', name: 'Sem cabeçalho', url: `${FAKE}/sem-cabecalho.m3u` }]);
  const r = await request('GET', '/api/catalog?list=semcab&section=live');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.catalog.live.items.length, 4);
  const st = await request('GET', '/api/list-status?list=semcab');
  assert.strictEqual(st.json.state, 'active', 'não aparece como "o provedor recusou"');
  await request('DELETE', '/api/list?list=semcab');
});

test('erros de download em palavras: endereço inexistente e servidor que recusa a conexão', async () => {
  // uma porta que acabou de ficar livre: ninguém atende nela
  const closed = await new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  await addLists([
    { id: 'e404', type: 'm3u', name: '404', url: `${FAKE}/nao-existe.m3u` },
    { id: 'erecusa', type: 'm3u', name: 'Recusa', url: `http://127.0.0.1:${closed}/lista.m3u` },
  ]);
  const a = await request('GET', '/api/catalog?list=e404&section=live');
  assert.ok(a.status >= 400);
  assert.match(a.json.error, /não existe \(erro 404\)/);
  const b = await request('GET', '/api/catalog?list=erecusa&section=live');
  assert.strictEqual(b.status, 500);
  assert.match(b.json.error, /recusou a conexão/);
  assert.ok(!/fetch failed|ECONN/.test(b.json.error), 'sem o código técnico');
  await request('DELETE', '/api/list?list=e404');
  await request('DELETE', '/api/list?list=erecusa');
});

test('editar a lista com outro link: a nova vale, sem perguntar se volta à anterior', async () => {
  variant = 'full';
  await addLists([{ id: 'troca', type: 'm3u', name: 'Troca', url: `${FAKE}/varia.m3u` }]);
  const a = await request('GET', '/api/catalog?list=troca&section=live');
  assert.strictEqual(a.json.catalog.live.items.length, 40);
  await until(async () => (fs.existsSync(path.join(DATA, 'catalog-troca.meta.json')) ? true : null));
  // a pessoa editou e colou o link de outra lista, bem menor
  await addLists([{ id: 'troca', type: 'm3u', name: 'Troca', url: `${FAKE}/lista.m3u` }]);
  const b = await request('GET', '/api/catalog?list=troca&section=live&refresh=1');
  assert.strictEqual(b.json.catalog.live.items.length, 10);
  assert.ok(!b.json.catalog.shrunk, 'outro link não é "a lista encolheu"');
  await request('DELETE', '/api/list?list=troca');
});

test('M3U por link monta enquanto baixa: igual a montar com o texto inteiro', async () => {
  await addLists([{ id: 'pic', type: 'm3u', name: 'Picada', url: `${FAKE}/picada.m3u` }]);
  const sections = {};
  for (const sec of ['live', 'movies', 'series']) sections[sec] = (await request('GET', `/api/catalog?list=pic&section=${sec}`)).json.catalog[sec];
  const whole = await buildFromM3U(PICADA, { id: 'pic' });
  for (const sec of ['live', 'movies', 'series']) assert.deepStrictEqual(sections[sec], JSON.parse(JSON.stringify(whole[sec])), `seção ${sec} igual`);
  assert.ok(sections.live.items.some((c) => c.name.includes('Ação São João')), 'acentos inteiros');
  assert.ok(!sections.live.items.some((c) => /\r|\ufeff/.test(c.name + c.url)), 'sem quebra do Windows nem BOM nos nomes e links');
});

test('lista que derrubou o app ao montar não é montada de novo sozinha', async () => {
  await addLists([{ id: 'caiu', type: 'm3u', name: 'Caiu', url: `${FAKE}/lista.m3u` }]);
  // marca de uma montagem de antes desta abertura do app (o processo caiu no meio)
  const mark = path.join(DATA, 'building-caiu.mark');
  fs.writeFileSync(mark, '1');
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(mark, old, old);
  const r = await request('GET', '/api/catalog?list=caiu&section=live');
  assert.strictEqual(r.status, 500);
  assert.match(r.json.error, /grande demais/);
  const again = await request('GET', '/api/catalog?list=caiu&section=live&refresh=1');
  assert.strictEqual(again.status, 200, '"Tentar de novo" monta mesmo assim');
  assert.ok(!fs.existsSync(mark), 'a marca sai quando termina');
});

test('arquivo de lista: app, vídeo ou página não entram, com mensagem para a tela', async () => {
  const apk = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(200, 7)]);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(200)]);
  for (const [nome, body, msg] of [['apk', apk, /app/], ['mp4', mp4, /vídeo/], ['html', '<html>oi</html>', /página/], ['texto', 'oi', /não é uma lista M3U/]]) {
    // pelo app (PC e celular)
    const r = await request('POST', '/api/m3u?list=arq', { body });
    assert.strictEqual(r.status, 400, `${nome} recusado`);
    assert.match(r.json.error, msg);
    // pelo QR Code do celular
    const token = (await request('POST', '/api/pair/start', { body: { address: '192.168.0.50' } })).json.token;
    const p = await request('POST', `/pair/${token}/m3u?nome=${nome}`, { body });
    assert.strictEqual(p.status, 400, `${nome} recusado no QR Code`);
    assert.match(p.json.error, msg);
  }
  assert.ok(!fs.existsSync(path.join(DATA, 'm3u-arq.m3u')), 'nada gravado');
  // o get.php baixado do painel Xtream (sem .m3u no nome) é texto de lista: entra
  const ok = await request('POST', '/api/m3u?list=arq', { body: ['#EXTM3U', '#EXTINF:-1,Canal', 'http://x/1.ts', ''].join(String.fromCharCode(10)) });
  assert.strictEqual(ok.status, 200);
});

test('EPG: guia .xml.gz da lista chega para o canal certo', async () => {
  const body = { list: 'm3uurl', chans: [{ k: 'a', e: 'c1', n: 'Canal 1' }] };
  const r = await until(async () => {
    const x = await request('POST', '/api/epg', { body });
    return x.json.status === 'ok' && x.json.data.a ? x : null;
  });
  assert.strictEqual(r.json.data.a[0][2], 'Jornal de teste');
});

test('favoritos, progresso e controle parental ficam salvos', async () => {
  await request('PUT', '/api/state/favorites', { body: { m3uurl: { live: ['l1'] } } });
  await request('PUT', '/api/state/progress', { body: { m3uurl: { m1: { t: 120, d: 3600 } } } });
  await request('PUT', '/api/state/settings', { body: { pin: '1234', activeList: 'm3uurl' } });
  const st = (await request('GET', '/api/state')).json;
  assert.deepStrictEqual(st.favorites.m3uurl.live, ['l1']);
  assert.strictEqual(st.progress.m3uurl.m1.t, 120);
  assert.strictEqual(st.settings.pin, '1234');
  assert.strictEqual((await request('PUT', '/api/state/qualquer', { body: {} })).status, 500);
});

test('baixar e carregar lista (com favoritos e histórico)', async () => {
  const exp = await request('GET', '/api/list-export?list=m3uurl');
  assert.strictEqual(exp.status, 200);
  assert.match(exp.headers['content-disposition'], /attachment/);
  const data = exp.json;
  assert.strictEqual(data.app, 'iptvkz');
  data.state.lists[0].name = 'Importada';
  const dry = await request('POST', '/api/list-import?dry=1', { body: data });
  assert.strictEqual(dry.json.summary.lists, 1);
  assert.strictEqual(dry.json.summary.favorites, 1);
  assert.strictEqual((await request('POST', '/api/list-import', { body: data })).status, 200);
  assert.strictEqual((await request('GET', '/api/state')).json.lists.find((l) => l.id === 'm3uurl').name, 'Importada');
  assert.strictEqual((await request('POST', '/api/list-import', { body: { app: 'outro' } })).status, 400);
});

test('pareamento pelo celular: chave de uso único, lista entregue uma vez', async () => {
  const start = await request('POST', '/api/pair/start', { body: { address: '192.168.0.50' } });
  assert.ok(start.json.available);
  const token = start.json.token;
  assert.match(start.json.url, /^http:\/\/192\.168\.0\.50:\d+\/pair\/[0-9a-f]{32}$/);
  assert.strictEqual((await request('GET', '/pair/' + 'f'.repeat(32))).status, 410);
  const form = await request('GET', '/pair/' + token);
  assert.strictEqual(form.status, 200);
  const sent = await request('POST', '/pair/' + token, { body: { type: 'm3u', name: 'Do celular', url: 'http://exemplo.invalid/l.m3u' } });
  assert.strictEqual(sent.status, 200);
  assert.strictEqual((await request('POST', '/pair/' + token, { body: { type: 'm3u', url: 'http://b.invalid/' } })).status, 410, 'só uma vez');
  const got = await request('GET', '/api/pair/status?token=' + token);
  assert.strictEqual(got.json.list.url, 'http://exemplo.invalid/l.m3u');
  assert.strictEqual((await request('GET', '/api/pair/status?token=' + token)).json.list, null);
});

test('pareamento: link sem http é consertado e o que falta é dito ao celular', async () => {
  const token = (await request('POST', '/api/pair/start', { body: { address: '192.168.0.50' } })).json.token;
  const miss = await request('POST', '/pair/' + token, { body: { type: 'xtream', server: 'servidor.invalid:8080', username: 'demo' } });
  assert.strictEqual(miss.status, 400);
  assert.strictEqual(miss.json.error, 'Falta preencher a senha.');
  const bad = await request('POST', '/pair/' + token, { body: { type: 'm3u', url: 'não sei o link' } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.error, /não parece certo/);
  // recusar não gasta a chave: o mesmo QR continua valendo
  for (const [typed, fixed] of [['exemplo.invalid/l.m3u', 'http://exemplo.invalid/l.m3u'], ['htp:/exemplo.invalid:8000/get.php?a=1', 'http://exemplo.invalid:8000/get.php?a=1']]) {
    const t = (await request('POST', '/api/pair/start', { body: { address: '192.168.0.50' } })).json.token;
    assert.strictEqual((await request('POST', '/pair/' + t, { body: { type: 'm3u', url: typed } })).status, 200, typed);
    assert.strictEqual((await request('GET', '/api/pair/status?token=' + t)).json.list.url, fixed);
  }
});

test('pareamento: arquivo .m3u mandado pelo celular vira a lista de arquivo na TV', async () => {
  const start = () => request('POST', '/api/pair/start', { body: { address: '192.168.0.50' } }).then((r) => r.json.token);
  let token = await start();
  const page = await request('POST', `/pair/${token}/m3u?nome=x.m3u`, { body: '<!doctype html><html>Conta suspensa</html>' });
  assert.strictEqual(page.status, 400);
  assert.match(page.json.error, /página da internet/);
  // recusado não gasta a chave
  const sent = await request('POST', `/pair/${token}/m3u?nome=Do%20celular.m3u`, { body: m3u(12, 'http://exemplo.invalid') });
  assert.strictEqual(sent.status, 200);
  const got = (await request('GET', '/api/pair/status?token=' + token)).json.list;
  assert.deepStrictEqual([got.type, got.source, got.name], ['m3u', 'file', 'Do celular']);
  assert.match(got.pairFile, /^[0-9a-f]{16}$/);
  // a TV salva a lista: o arquivo passa a ser o dela
  assert.strictEqual((await request('POST', `/api/m3u-pair?list=pf&file=${got.pairFile}`)).status, 200);
  assert.strictEqual((await request('POST', `/api/m3u-pair?list=pf&file=${got.pairFile}`)).status, 410, 'uma vez só');
  assert.strictEqual((await request('POST', '/api/m3u-pair?list=pf&file=../../x')).status, 410);
  await addLists([{ id: 'pf', type: 'm3u', source: 'file', name: 'Do celular' }]);
  const c = await request('GET', '/api/catalog?list=pf&section=live');
  assert.strictEqual(c.json.catalog.live.items.length, 4);
  assert.ok(!fs.readdirSync(DATA).some((f) => f.startsWith('m3u-pair-')), 'nada sobrando do envio');
  await request('DELETE', '/api/list?list=pf');
});

test('lista grande: 60 mil entradas montam em poucos segundos', async () => {
  const text = m3u(60000, 'http://exemplo.invalid');
  const t0 = Date.now();
  const c = await buildFromM3U(text, { id: 'big' });
  const ms = Date.now() - t0;
  // a conversão em lotes (com pausas) tem de dar exatamente o mesmo texto que a conversão de uma vez
  const parts = await prepareParts(c);
  for (const k of ['live', 'movies', 'series']) assert.strictEqual(parts[k], JSON.stringify(c[k]), `seção ${k} igual`);
  assert.strictEqual(c.live.items.length, 20000);
  assert.strictEqual(c.movies.items.length, 20000);
  assert.ok(ms < 15000, `levou ${ms} ms`);
  console.log(`  lista de 60 mil entradas: ${ms} ms`);
});

test('baixar lista no celular: a chave só entrega a lista escolhida na TV', async () => {
  const start = await request('POST', '/api/pair/start', { body: { address: '192.168.0.50', list: 'm3uurl' } });
  const token = start.json.token;
  assert.strictEqual((await request('GET', `/pair/${token}/arquivo?lista=xt`)).status, 404, 'outra lista, com senha, não sai');
  const ok = await request('GET', `/pair/${token}/arquivo?lista=m3uurl`);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.app, 'iptvkz');
  await request('POST', '/api/pair/end', { body: { token } });
  assert.strictEqual((await request('GET', `/pair/${token}/arquivo?lista=m3uurl`)).status, 410, 'depois de fechar, a chave não vale');
});

test('Assistir na TV: mensagem do Cast e resposta do mDNS são lidas certo', () => {
  const { encodeCast, decodeCast, parseDns, dnsName } = require('../src/server/cast.js')._test;
  // Cast: o que mandamos volta igual ao ler (4 bytes de tamanho + protobuf)
  const msg = encodeCast('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', { type: 'LAUNCH', appId: 'CC1AD845', requestId: 7 });
  assert.strictEqual(msg.readUInt32BE(0), msg.length - 4);
  const back = decodeCast(msg.subarray(4));
  assert.strictEqual(back.ns, 'urn:x-cast:com.google.cast.receiver');
  assert.deepStrictEqual(back.data, { type: 'LAUNCH', appId: 'CC1AD845', requestId: 7 });
  // mDNS: resposta de um Chromecast (PTR + SRV + TXT + A, com nome comprimido)
  const name = dnsName('Sala._googlecast._tcp.local');
  const rec = (n, type, data) => { const h = Buffer.alloc(10); h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt16BE(data.length, 8); return Buffer.concat([n, h, data]); };
  const kv = (t) => Buffer.concat([Buffer.from([Buffer.byteLength(t)]), Buffer.from(t)]);
  const txt = Buffer.concat([kv('fn=Sala'), kv('md=Google TV')]);
  const srvData = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), Buffer.from([0xc0, 12])]);
  const a = Buffer.from([192, 168, 1, 50]);
  const head = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 4, 0, 0, 0, 0]);
  const pkt = Buffer.concat([head, rec(dnsName('_googlecast._tcp.local'), 12, name), rec(Buffer.from([0xc0, 12]), 33, srvData), rec(Buffer.from([0xc0, 12]), 16, txt), rec(dnsName('sala.local'), 1, a)]);
  const recs = parseDns(pkt);
  assert.strictEqual(recs.find((r) => r.type === 33).port, 8009);
  assert.deepStrictEqual(recs.find((r) => r.type === 16).txt, { fn: 'Sala', md: 'Google TV' });
  assert.strictEqual(recs.find((r) => r.type === 1).ip, '192.168.1.50');
});
