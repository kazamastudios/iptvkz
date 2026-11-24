// Teste do piso de navegador: abre o app (versão legacy) num Chromium sem o que o Chromium 51 não tem (WebView do
// Android 7.0, como nas TV box) e passa pelas telas principais, no modo PC e no modo TV. Falha com qualquer erro de
// JavaScript ou se o app não sair da abertura. Usa o Electron do projeto (nada para instalar).
//   npx electron scripts/test-old-browser.js        (no Linux sem tela: xvfb-run -a npx electron --no-sandbox ...)
// Lista fictícia, servida aqui mesmo; a pasta de dados é temporária e apagada no fim.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvkz-old-browser-'));
process.env.IPTVKZ_DATA = DATA;
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];

function fakeList(port) {
  const u = (p) => `http://127.0.0.1:${port}${p}`;
  let m = `#EXTM3U url-tvg="${u('/guia.xml')}"\n`;
  for (let i = 1; i <= 3; i++) m += `#EXTINF:-1 tvg-id="c${i}" group-title="Canais Teste",Canal Teste ${i}\n${u(`/live/${i}.ts`)}\n`;
  for (let i = 1; i <= 3; i++) m += `#EXTINF:-1 group-title="Filmes Teste",Filme Teste ${i} (2020)\n${u(`/movie/${i}.mp4`)}\n`;
  for (let s = 1; s <= 2; s++) for (let e = 1; e <= 3; e++) {
    m += `#EXTINF:-1 group-title="Séries Teste",Série Teste S0${s}E0${e}\n${u(`/series/s${s}e${e}.mp4`)}\n`;
  }
  return m;
}

function guide() {
  const ts = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const h = Date.now() - (Date.now() % 3600000);
  let x = '<?xml version="1.0" encoding="UTF-8"?><tv>';
  for (let c = 1; c <= 3; c++) {
    x += `<channel id="c${c}"><display-name>Canal Teste ${c}</display-name></channel>`;
    for (let i = -1; i < 4; i++) x += `<programme start="${ts(h + i * 3600000)}" stop="${ts(h + (i + 1) * 3600000)}" channel="c${c}"><title>Programa ${i + 2}</title></programme>`;
  }
  return x + '</tv>';
}

function startFake() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/lista.m3u') { res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' }); return res.end(fakeList(s.address().port)); }
      if (req.url === '/guia.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(guide()); }
      res.writeHead(404); res.end();
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function run() {
  const fake = await startFake();
  const server = require('../src/server/index.js');
  const { port } = await server.start({ port: 18797, host: '127.0.0.1', portFallback: true, keepAlive: true });
  const base = `http://127.0.0.1:${port}`;
  const api = (method, p, body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { preload: path.join(__dirname, 'test-old-browser-preload.js'), contextIsolation: false, sandbox: false },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (code, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(code).catch(() => false)) return true;
      await sleep(200);
    }
    throw new Error(`${what}: não aconteceu em ${ms / 1000} s`);
  };
  const errs = () => js('window.__errs.splice(0)');

  async function check(label, fn) {
    try {
      await fn();
      const e = await errs();
      if (e.length) throw new Error(e.join('\n      '));
      console.log(`ok   ${label}`);
    } catch (err) {
      const msg = await js("(document.querySelector('#splash .sp-msg')||{}).textContent||''").catch(() => '');
      failures.push(label);
      const txt = await js('document.body.innerText.slice(0, 160)').catch(() => '');
      if (txt) err.message += `\n      tela: ${txt.replace(/\s+/g, ' ')}`;
      console.log(`FALHOU ${label}\n      ${err.message}${msg ? `\n      abertura: ${msg}` : ''}`);
    }
  }

  // Abertura: a versão legacy tem de sair da abertura (termos na primeira vez)
  await win.loadURL(base + '/?legacy=1&tv=0');
  console.log('sem: ' + (await js('window.__oldGone.join(", ")')));
  await check('abre a versão legacy e mostra os termos', async () => {
    const legacy = await js("!!document.querySelector('script[src=\"/js/app.legacy.js\"]')");
    if (!legacy) throw new Error('não carregou /js/app.legacy.js');
    await until("!!document.querySelector('.modal-back.show')", 20000, 'termos na tela');
  });
  if (failures.length) return finish(1, fake);

  // Instância de teste (pasta temporária): aceita os termos para chegar às telas
  await js("[...document.querySelectorAll('.modal-back.show button')].find(b => /aceito/i.test(b.textContent)).click()");
  await sleep(1500); // a página grava o estado dela; a lista entra depois, para não ser sobrescrita
  await win.loadURL('about:blank');
  await api('PUT', '/api/state/lists', [{ id: 'teste', type: 'm3u', source: 'url', name: 'Lista teste', url: `http://127.0.0.1:${fake.address().port}/lista.m3u` }]);
  const first = async (section) => {
    const r = await (await api('GET', `/api/catalog?list=teste&section=${section}&wait=1`)).json();
    return r.catalog[section].items[0].id;
  };
  const movieId = await first('movies');
  const serieId = await first('series');

  for (const tv of ['0', '1']) {
    const mode = tv === '1' ? 'TV' : 'PC';
    await win.loadURL(`${base}/?legacy=1&tv=${tv}#/live`);
    await check(`${mode}: sai da abertura`, () => until("!document.getElementById('splash') || document.getElementById('splash').classList.contains('out')", 20000, 'abertura sumir'));
    const routes = [
      ['Ao vivo', '#/live', "document.querySelectorAll('.ch, .channel, [data-ch]').length > 0 || /Canal Teste/.test(document.body.innerText)"],
      ['Filmes', '#/movies', "/Filme Teste/.test(document.body.innerText)"],
      ['Séries', '#/series', "/Série Teste/.test(document.body.innerText)"],
      ['Guia', '#/guide', "/Programa/.test(document.body.innerText)"],
      ['Histórico', '#/history', 'true'],
      ['Buscar', '#/search?q=Teste', "/Teste/.test(document.body.innerText)"],
      ['Ajustes', '#/settings', "/Listas|Configura/.test(document.body.innerText)"],
    ];
    for (const [name, hash, ok] of routes) {
      await check(`${mode}: ${name}`, async () => {
        await js(`location.hash = ${JSON.stringify(hash)}`);
        await until(ok, 15000, `${name} com conteúdo`);
        await sleep(400);
      });
    }
    // página de um filme e de uma série
    for (const [name, hash, re] of [['filme', `#/movie?id=${encodeURIComponent(movieId)}`, 'Filme Teste'], ['série', `#/serie?id=${encodeURIComponent(serieId)}`, 'Epis']]) {
      await check(`${mode}: página de ${name}`, async () => {
        await js(`location.hash = ${JSON.stringify(hash)}`);
        await until(`/${re}/.test(document.body.innerText)`, 15000, `página de ${name}`);
        await sleep(800);
      });
    }
    // TV: o controle anda pela tela sem erro
    if (tv === '1') {
      await check('TV: setas e OK do controle', async () => {
        await js("location.hash = '#/movies'");
        await sleep(1200);
        for (const key of ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key.replace('Arrow', '') });
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key.replace('Arrow', '') });
          await sleep(150);
        }
      });
    }
  }
  return finish(failures.length ? 1 : 0, fake);
}

function finish(code, fake) {
  console.log(code ? `\n${failures.length} falha(s) no piso Chromium 51` : '\nPiso Chromium 51: tudo certo');
  try { fake.close(); } catch {}
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  app.exit(code);
}

app.whenReady().then(run).catch((e) => {
  console.error(e);
  app.exit(1);
});
