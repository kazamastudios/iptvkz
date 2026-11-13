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
const { buildFromM3U } = require('../src/server/catalog.js');

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
  if (q.get('username') !== XT.user || q.get('password') !== XT.pass) {
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
  res.end(JSON.stringify(body == null ? [] : body));
}

function startFake() {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/lista.m3u') return res.end(m3u(30, FAKE));
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

test('lista grande: 60 mil entradas montam em poucos segundos', () => {
  const text = m3u(60000, 'http://exemplo.invalid');
  const t0 = Date.now();
  const c = buildFromM3U(text, { id: 'big' });
  const ms = Date.now() - t0;
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
