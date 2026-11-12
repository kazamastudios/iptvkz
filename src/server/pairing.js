// Cadastro de lista pelo celular: a TV mostra um QR Code com uma chave de uso único, e o celular
// abre este formulário direto na TV, pela rede de casa. Nada passa por serviços de fora.
// A mesma página baixa uma lista no celular (com favoritos e histórico) e usa esse arquivo em outra TV.
const crypto = require('crypto');
const net = require('./network');
const backup = require('./backup');

const TTL = 15 * 60 * 1000;
const MAX_BODY = 60 * 1024 * 1024; // o backup pode trazer arquivos .m3u inteiros
const MAX_FIELD = 2048;
let enabled = false;
let session = null;

function enable() { enabled = true; }

function current(token) {
  if (!session || Date.now() > session.expires) { session = null; return null; }
  const a = Buffer.from(String(token));
  const b = Buffer.from(session.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? session : null;
}

// address: informado pelo app nativo onde o Node não pode listar as redes (Android 11+).
// list: a chave aberta para "Baixar lista no celular" só entrega essa lista, e nenhuma outra.
function begin(port, address, list) {
  if (!enabled) return { available: false };
  const given = /^\d+\.\d+\.\d+\.\d+$/.test(address || '') && net.isPrivate(address) && !net.isLoopback(address);
  const addr = given ? { address } : net.lanAddresses().find((a) => !a.virtual);
  if (!addr) return { available: false };
  session = { token: crypto.randomBytes(16).toString('hex'), expires: Date.now() + TTL, received: null, used: false, list: typeof list === 'string' ? list : null };
  return { available: true, token: session.token, url: `http://${addr.address}:${port}/pair/${session.token}` };
}

// A TV busca o que o celular enviou: uma lista (entregue uma vez só) ou o resumo de um backup.
function status(token) {
  const s = current(token);
  if (!s || !s.received) return { list: null, downloaded: !!(s && s.downloaded) };
  if (s.received.backup) return { restore: backup.summary(s.received.backup) };
  const list = s.received;
  session = null;
  return { list };
}

// Backup recebido do celular, entregue uma vez só para a TV aplicar depois da confirmação.
function takeRestore(token) {
  const s = current(token);
  if (!s || !s.received || !s.received.backup) return null;
  session = null;
  return s.received.backup;
}

function end(token) {
  if (current(token)) session = null;
}

function clean(body) {
  const text = (v) => String(v == null ? '' : v).trim().slice(0, MAX_FIELD);
  const name = text(body.name);
  if (body.type === 'xtream') {
    const list = { type: 'xtream', name, server: text(body.server), servers: String(body.servers == null ? '' : body.servers).slice(0, 8000), username: text(body.username), password: String(body.password == null ? '' : body.password).slice(0, MAX_FIELD) };
    return list.server && list.username && list.password ? list : null;
  }
  const url = text(body.url);
  return /^https?:\/\//i.test(url) ? { type: 'm3u', name, url } : null;
}

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

const EXPIRED = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IPTVKZ</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#08080b;color:#f4f4f8;font:18px system-ui;text-align:center;padding:24px;box-sizing:border-box">
<div><h2>Este código não vale mais</h2><p style="color:#a0a0b4">Abra “Adicionar lista” na TV e escaneie o novo QR Code.</p></div>`;

const FORM = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Adicionar lista · IPTVKZ</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#08080b;color:#f4f4f8;font:16px system-ui,-apple-system,sans-serif;padding:24px 18px}
main{max-width:460px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:20px 0 6px}p{color:#a0a0b4;margin:0 0 18px;font-size:14px;line-height:1.45}
.tabs{display:flex;gap:8px;margin-bottom:16px}.tabs button{flex:1 1 auto;padding:0 10px;white-space:nowrap;height:44px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#a0a0b4;font:inherit}
.tabs button.on{background:#ff2a2a;border-color:#ff2a2a;color:#fff;font-weight:600}
label{display:block;font-size:13px;color:#c9c9d8;margin:0 0 6px}input{width:100%;height:48px;padding:0 12px;margin:0 0 14px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#fff;font-size:16px}
input[type=file]{height:auto;padding:14px;border-style:dashed;font-size:15px;color:#c9c9d8}
.send{display:flex;align-items:center;justify-content:center;width:100%;height:50px;border:0;border-radius:10px;background:#ff2a2a;color:#fff;font:600 17px system-ui;text-decoration:none}
.send.alt{background:#14141d;border:1px solid #44445e}.send:disabled{opacity:.6}
.warn{padding:12px;border-radius:10px;background:#2a1a10;color:#ffd2a8;font-size:14px}
textarea{width:100%;padding:10px 12px;margin:0 0 14px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#fff;font:16px system-ui}
.more{background:none;border:0;color:#c9c9d8;font:14px system-ui;padding:0 0 14px;text-decoration:underline}
#err,#berr{color:#ff8a8a;font-size:14px;min-height:20px;margin-bottom:8px}.hidden{display:none}
</style></head><body><main>
<div id="done" class="hidden"><h1>Pronto!</h1><p id="donetext">A lista foi enviada. Continue na TV.</p></div>
<div id="main">
<h1>Adicionar lista</h1><p>Os dados vão direto para a sua TV, pela rede de casa.</p>
<div class="tabs"><button type="button" id="tx" class="on">Xtream</button><button type="button" id="tm">Link M3U</button><button type="button" id="tb">Carregar lista</button></div>
<form id="f">
<div id="px"><label for="s">Servidor (ou cole o link get.php)</label><input id="s" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="http://servidor.com:8080">
<button type="button" class="more" id="mb">+ O provedor deu mais de um servidor?</button>
<div id="ms" class="hidden"><label for="ss">Outros servidores do mesmo provedor</label><textarea id="ss" rows="4" autocapitalize="none" placeholder="Pode colar vários de uma vez, do jeito que vieram"></textarea></div>
<label for="u">Usuário</label><input id="u" autocomplete="off" autocapitalize="none"><label for="w">Senha</label><input id="w" type="password" autocomplete="off"></div>
<div id="pm" class="hidden"><label for="l">Link da lista</label><input id="l" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="http://…/lista.m3u"></div>
<label for="n">Nome (opcional)</label><input id="n" autocomplete="off" placeholder="Minha lista">
<div id="err"></div><button class="send" id="b">Enviar para a TV</button>
</form>
<div id="pb" class="hidden">
<h2>Carregar lista</h2><p>Escolha o arquivo que você baixou pelo botão “Baixar lista”, em outra TV (começa com “iptvkz-lista”). Ela entra nesta TV com favoritos e histórico; as outras listas continuam.</p>
<input type="file" id="a" accept=".json,application/json">
<div id="berr"></div><button class="send" id="rb" type="button">Carregar lista</button>
</div>
</div>
<div id="save" class="hidden"><h1>Baixar lista no celular</h1>
<p>Baixa um arquivo com a lista, os favoritos e o histórico dela. Em outro aparelho, abra “Adicionar lista”, escaneie o QR Code e use “Carregar lista”.</p>
<p class="warn">O arquivo contém o usuário e a senha da lista. Guarde com cuidado e não compartilhe.</p>
<a class="send" id="dl" download>Baixar lista</a>
<p id="saved" class="hidden" style="margin-top:16px">Download iniciado. Confira a pasta de downloads do celular.</p>
</div></main>
<script>
var type='xtream',$=function(i){return document.getElementById(i)};
function tab(t){type=t;$('tx').className=t==='xtream'?'on':'';$('tm').className=t==='m3u'?'on':'';$('tb').className=t==='backup'?'on':'';
$('f').className=t==='backup'?'hidden':'';$('pb').className=t==='backup'?'':'hidden';$('px').className=t==='xtream'?'':'hidden';$('pm').className=t==='m3u'?'':'hidden'}
$('tx').onclick=function(){tab('xtream')};$('tm').onclick=function(){tab('m3u')};$('tb').onclick=function(){tab('backup')};
var lista=new URLSearchParams(location.search).get('lista');
if(lista){$('main').className='hidden';$('save').className='';$('dl').href=location.pathname.replace(/\\/$/,'')+'/arquivo?lista='+encodeURIComponent(lista);$('dl').addEventListener('click',function(){$('saved').className=''})}
function finish(t){$('main').className='hidden';$('donetext').textContent=t;$('done').className=''}
$('mb').onclick=function(){$('mb').className='hidden';$('ms').className='';$('ss').focus()};
$('s').addEventListener('change',function(){try{var u=new URL($('s').value.trim()),a=u.searchParams.get('username'),b=u.searchParams.get('password');if(a&&b&&/get\\.php|player_api\\.php/i.test(u.pathname)){$('s').value=u.protocol+'//'+u.host;$('u').value=a;$('w').value=b}}catch(e){}});
$('f').addEventListener('submit',function(e){e.preventDefault();$('err').textContent='';$('b').disabled=true;
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,name:$('n').value,server:$('s').value,servers:$('ss').value,username:$('u').value,password:$('w').value,url:$('l').value})})
.then(function(r){if(r.ok){finish('A lista foi enviada. Continue na TV.');return}if(r.status===410){$('err').textContent='Este código expirou. Escaneie o novo QR Code na TV.'}else{$('err').textContent='Confira os campos e tente de novo.'}$('b').disabled=false})
.catch(function(){$('err').textContent='Não foi possível falar com a TV. Confira se o celular está no mesmo Wi-Fi.';$('b').disabled=false})});
$('rb').addEventListener('click',function(){$('berr').textContent='';var file=$('a').files[0];
if(!file){$('berr').textContent='Escolha o arquivo de backup.';return}
$('rb').disabled=true;file.text().then(function(t){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:t})})
.then(function(r){return r.json().catch(function(){return {}}).then(function(j){
if(r.ok){finish('Lista enviada. Confirme na TV.');return}
$('berr').textContent=r.status===410?'Este código expirou. Escaneie o novo QR Code na TV.':(j.error||'Não foi possível ler o arquivo.');$('rb').disabled=false})})
.catch(function(){$('berr').textContent='Não foi possível falar com a TV. Confira se o celular está no mesmo Wi-Fi.';$('rb').disabled=false})});
</script></body></html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('grande demais')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

function sendList(res, s, listId) {
  const data = (!s.list || s.list === listId) && backup.build(listId);
  if (!data) { res.writeHead(404, HEADERS); return res.end(EXPIRED); }
  s.downloaded = true;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="iptvkz-lista-${backup.slug(data.state.lists[0].name)}.json"`,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(data));
}

// Só vale com o pareamento ligado e de endereços da rede de casa (conferido por quem chama).
function handle(req, res, url) {
  const [token, sub = ''] = url.pathname.slice('/pair/'.length).split('/');
  const s = current(token);
  if (!s || s.used) {
    res.writeHead(410, HEADERS);
    return res.end(EXPIRED);
  }
  if (req.method === 'GET') {
    if (sub === 'arquivo') return sendList(res, s, url.searchParams.get('lista'));
    res.writeHead(200, HEADERS);
    return res.end(FORM);
  }
  if (req.method !== 'POST') {
    res.writeHead(405, HEADERS);
    return res.end();
  }
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  return readBody(req).then((text) => {
    const body = JSON.parse(text);
    if (body && body.app === 'iptvkz') {
      let data;
      try { data = backup.parse(text); } catch (err) { return json(400, { error: err.message }); }
      s.received = { backup: data };
      s.used = true;
      return json(200, { ok: true });
    }
    const list = clean(body);
    if (!list) { res.writeHead(400, HEADERS); return res.end(); }
    s.received = list;
    s.used = true;
    res.writeHead(200, HEADERS);
    res.end();
  }).catch(() => json(400, { error: 'O arquivo é grande demais ou não chegou inteiro.' }));
}

module.exports = { enable, enabled: () => enabled, begin, status, takeRestore, end, handle };
