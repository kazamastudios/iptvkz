// Cadastro de lista pelo celular: a TV mostra um QR Code com uma chave de uso único, e o celular
// abre este formulário direto na TV, pela rede de casa. Nada passa por serviços de fora.
const crypto = require('crypto');
const net = require('./network');

const TTL = 15 * 60 * 1000;
const MAX_BODY = 16 * 1024;
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
function begin(port, address) {
  if (!enabled) return { available: false };
  const given = /^\d+\.\d+\.\d+\.\d+$/.test(address || '') && net.isPrivate(address) && !net.isLoopback(address);
  const addr = given ? { address } : net.lanAddresses().find((a) => !a.virtual);
  if (!addr) return { available: false };
  session = { token: crypto.randomBytes(16).toString('hex'), expires: Date.now() + TTL, received: null, used: false };
  return { available: true, token: session.token, url: `http://${addr.address}:${port}/pair/${session.token}` };
}

// A TV busca o que o celular enviou; entrega uma vez só.
function take(token) {
  const s = current(token);
  if (!s || !s.received) return null;
  const list = s.received;
  session = null;
  return list;
}

function end(token) {
  if (current(token)) session = null;
}

function clean(body) {
  const text = (v) => String(v == null ? '' : v).trim().slice(0, MAX_FIELD);
  const name = text(body.name);
  if (body.type === 'xtream') {
    const list = { type: 'xtream', name, server: text(body.server), username: text(body.username), password: String(body.password == null ? '' : body.password).slice(0, MAX_FIELD) };
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
main{max-width:460px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}p{color:#a0a0b4;margin:0 0 18px;font-size:14px}
.tabs{display:flex;gap:8px;margin-bottom:16px}.tabs button{flex:1;height:44px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#a0a0b4;font:inherit}
.tabs button.on{background:#ff2a2a;border-color:#ff2a2a;color:#fff;font-weight:600}
label{display:block;font-size:13px;color:#c9c9d8;margin:0 0 6px}input{width:100%;height:48px;padding:0 12px;margin:0 0 14px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#fff;font-size:16px}
.send{width:100%;height:50px;border:0;border-radius:10px;background:#ff2a2a;color:#fff;font:600 17px system-ui}.send:disabled{opacity:.6}
#err{color:#ff8a8a;font-size:14px;min-height:20px;margin-bottom:8px}.hidden{display:none}
</style></head><body><main>
<div id="done" class="hidden"><h1>Pronto!</h1><p>A lista foi enviada. Continue na TV.</p></div>
<form id="f">
<h1>Adicionar lista</h1><p>Os dados vão direto para a sua TV, pela rede de casa.</p>
<div class="tabs"><button type="button" id="tx" class="on">Xtream Codes</button><button type="button" id="tm">Link M3U</button></div>
<div id="px"><label for="s">Servidor (ou cole o link get.php)</label><input id="s" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="http://servidor.com:8080">
<label for="u">Usuário</label><input id="u" autocomplete="off" autocapitalize="none"><label for="w">Senha</label><input id="w" type="password" autocomplete="off"></div>
<div id="pm" class="hidden"><label for="l">Link da lista</label><input id="l" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="http://…/lista.m3u"></div>
<label for="n">Nome (opcional)</label><input id="n" autocomplete="off" placeholder="Minha lista">
<div id="err"></div><button class="send" id="b">Enviar para a TV</button>
</form></main>
<script>
var type='xtream',$=function(i){return document.getElementById(i)};
function tab(t){type=t;$('tx').className=t==='xtream'?'on':'';$('tm').className=t==='m3u'?'on':'';$('px').className=t==='xtream'?'':'hidden';$('pm').className=t==='m3u'?'':'hidden'}
$('tx').onclick=function(){tab('xtream')};$('tm').onclick=function(){tab('m3u')};
$('s').addEventListener('change',function(){try{var u=new URL($('s').value.trim()),a=u.searchParams.get('username'),b=u.searchParams.get('password');if(a&&b&&/get\\.php|player_api\\.php/i.test(u.pathname)){$('s').value=u.protocol+'//'+u.host;$('u').value=a;$('w').value=b}}catch(e){}});
$('f').addEventListener('submit',function(e){e.preventDefault();$('err').textContent='';$('b').disabled=true;
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,name:$('n').value,server:$('s').value,username:$('u').value,password:$('w').value,url:$('l').value})})
.then(function(r){if(r.ok){$('f').className='hidden';$('done').className='';return}if(r.status===410){$('err').textContent='Este código expirou. Escaneie o novo QR Code na TV.'}else{$('err').textContent='Confira os campos e tente de novo.'}$('b').disabled=false})
.catch(function(){$('err').textContent='Não foi possível falar com a TV. Confira se o celular está no mesmo Wi-Fi.';$('b').disabled=false})});
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

// Só vale com o pareamento ligado e de endereços da rede de casa (conferido por quem chama).
function handle(req, res, url) {
  const s = current(url.pathname.slice('/pair/'.length));
  if (!s || s.used) {
    res.writeHead(410, HEADERS);
    return res.end(EXPIRED);
  }
  if (req.method === 'GET') {
    res.writeHead(200, HEADERS);
    return res.end(FORM);
  }
  if (req.method !== 'POST') {
    res.writeHead(405, HEADERS);
    return res.end();
  }
  return readBody(req).then((text) => {
    const list = clean(JSON.parse(text));
    if (!list) { res.writeHead(400, HEADERS); return res.end(); }
    s.received = list;
    s.used = true;
    res.writeHead(200, HEADERS);
    res.end();
  }).catch(() => { res.writeHead(400, HEADERS); res.end(); });
}

module.exports = { enable, enabled: () => enabled, begin, take, end, handle };
