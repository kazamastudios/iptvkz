// Cadastro de lista pelo celular: a TV mostra um QR Code com uma chave de uso único, e o celular
// abre este formulário direto na TV, pela rede de casa. Nada passa por serviços de fora.
// A mesma página baixa uma lista no celular (com favoritos e histórico) e usa esse arquivo em outra TV.
const crypto = require('crypto');
const fs = require('fs');
const net = require('./network');
const backup = require('./backup');
const store = require('./store');
const catalogs = require('./catalog');
const { m3uFileProblem } = require('./util');

const TTL = 15 * 60 * 1000;
const MAX_BODY = 60 * 1024 * 1024; // o backup pode trazer arquivos .m3u inteiros
const MAX_FIELD = 2048;
const MAX_M3U = 300 * 1024 * 1024; // arquivo .m3u mandado pelo celular (o mesmo limite do envio pelo computador)
// Arquivo .m3u que chegou pelo celular, esperando a TV salvar a lista: m3u-pair-<id>.m3u na pasta de dados.
const pairName = (id) => `m3u-pair-${id}.m3u`;

// Arquivos do celular que a TV não chegou a usar (fechou o formulário): saem depois de um dia.
function dropOldPairFiles() {
  let names = [];
  try { names = fs.readdirSync(store.DATA).filter((f) => /^m3u-pair-[0-9a-f]+\.(m3u|tmp)$/.test(f)); } catch {}
  for (const f of names) {
    try { if (Date.now() - fs.statSync(store.file(f)).mtimeMs > 86400000) fs.unlinkSync(store.file(f)); } catch {}
  }
}

// A TV salvou a lista: o arquivo do celular vira o arquivo da lista (como o enviado pelo computador).
function adoptFile(fileId, listId) {
  if (!/^[0-9a-f]{16}$/.test(fileId || '') || !/^[\w-]+$/.test(listId || '')) return false;
  try {
    fs.renameSync(store.file(pairName(fileId)), store.file(`m3u-${listId}.m3u`));
    return true;
  } catch {
    return false;
  }
}

// Recebe o .m3u do celular direto no disco, em pedaços (sem juntar 100 MB na memória da TV). Confere o começo:
// precisa ser uma lista (como na montagem: #EXTM3U, #EXTINF ou já os links).
function receiveM3u(req) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomBytes(8).toString('hex');
    const tmp = store.file(`m3u-pair-${id}.tmp`);
    const out = fs.createWriteStream(tmp);
    let size = 0;
    let head = '';
    let failed = null;
    const fail = (msg) => {
      if (failed) return;
      failed = new Error(msg);
      req.unpipe(out);
      out.destroy();
      fs.unlink(tmp, () => {});
      reject(failed);
    };
    req.on('data', (c) => {
      size += c.length;
      if (head.length < 1024) head += c.toString('latin1', 0, Math.min(c.length, 1024));
      if (size > MAX_M3U) { fail('O arquivo passa de 300 MB.'); req.destroy(); }
    });
    req.on('error', () => fail('O arquivo não chegou inteiro. Tente de novo.'));
    req.on('aborted', () => fail('O arquivo não chegou inteiro. Tente de novo.'));
    out.on('error', () => fail('Não foi possível gravar o arquivo na TV (sem espaço?).'));
    out.on('finish', () => {
      if (failed) return;
      if (!size) { fs.unlink(tmp, () => {}); return reject(new Error('O arquivo está vazio.')); }
      const problem = m3uFileProblem(head);
      if (problem) {
        fs.unlink(tmp, () => {});
        return reject(new Error(problem));
      }
      try { fs.renameSync(tmp, store.file(pairName(id))); } catch (e) { return fail('Não foi possível gravar o arquivo na TV.'); }
      resolve({ id, size });
    });
    req.pipe(out);
  });
}
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
// mode 'edit': o celular edita essa lista (dados, servidores, atualizar, excluir); a TV aplica cada pedido.
function begin(port, address, list, mode) {
  if (!enabled) return { available: false };
  dropOldPairFiles();
  const given = /^\d+\.\d+\.\d+\.\d+$/.test(address || '') && net.isPrivate(address) && !net.isLoopback(address);
  const addr = given ? { address } : net.lanAddresses().find((a) => !a.virtual);
  if (!addr) return { available: false };
  session = { token: crypto.randomBytes(16).toString('hex'), expires: Date.now() + TTL, received: null, used: false, list: typeof list === 'string' ? list : null, mode: mode === 'edit' && typeof list === 'string' ? 'edit' : null };
  return { available: true, token: session.token, url: `http://${addr.address}:${port}/pair/${session.token}` };
}

// A TV busca o que o celular enviou: uma lista (entregue uma vez só) ou o resumo de um backup.
function status(token) {
  const s = current(token);
  if (!s || !s.received) return { list: null, downloaded: !!(s && s.downloaded) };
  if (s.received.edit) {
    // edição: entrega o pedido e a chave continua valendo para os próximos (menos depois de excluir)
    const e = s.received.edit;
    s.received = null;
    if (e.action === 'delete') session = null;
    return { edit: e };
  }
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

function cleanEdit(f) {
  const text = (v) => String(v == null ? '' : v).trim().slice(0, MAX_FIELD);
  f = f && typeof f === 'object' ? f : {};
  return {
    name: text(f.name), server: text(f.server), username: text(f.username), url: text(f.url), epgUrl: text(f.epgUrl),
    servers: (Array.isArray(f.servers) ? f.servers : []).slice(0, 30).map(text).filter(Boolean),
    password: String(f.password == null ? '' : f.password).slice(0, MAX_FIELD),
  };
}

// Link colado no celular: sem http (o mais comum) ganha http://, e o http digitado errado (htp:/, http;//) é
// consertado. Igual ao formulário da TV (fixLink em src/web/js/views/lists.js).
function fixLink(text) {
  let t = String(text || '').trim().replace(/^[<("']+/, '').replace(/[>)"']+$/, '');
  const sch = t.match(/^h?t{1,2}p{1,2}(s?)(?:[:;.]+\/*|\/+)/i);
  if (sch) t = `http${sch[1] ? 's' : ''}://` + t.slice(sch[0].length);
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)|^localhost(:\d+)?([/?#]|$)/i.test(t)) t = 'http://' + t;
  return t;
}

// O que o celular mandou, conferido. Sem condição de virar lista: { error } com o que falta, para o celular mostrar.
function clean(body) {
  const text = (v) => String(v == null ? '' : v).trim().slice(0, MAX_FIELD);
  const name = text(body.name);
  if (body.type === 'xtream') {
    const list = { type: 'xtream', name, server: text(body.server), servers: String(body.servers == null ? '' : body.servers).slice(0, 8000), username: text(body.username), password: String(body.password == null ? '' : body.password).slice(0, MAX_FIELD) };
    const missing = [!list.server && 'o servidor', !list.username && 'o usuário', !list.password && 'a senha'].filter(Boolean);
    if (missing.length) return { error: `Falta preencher ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} e ${missing[missing.length - 1]}` : missing[0]}.` };
    return list;
  }
  const url = fixLink(body.url);
  if (!url) return { error: 'Cole o link da lista.' };
  if (!/^https?:\/\/[^/\s]+/i.test(url)) return { error: 'Esse link não parece certo. Ele começa com http:// e tem o endereço do provedor, como http://servidor.com/lista.m3u' };
  return { type: 'm3u', name, url };
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
.tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px}.tabs button{padding:0 10px;white-space:nowrap;height:44px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#a0a0b4;font:inherit}
.tabs button.on{background:#ff2a2a;border-color:#ff2a2a;color:#fff;font-weight:600}
label{display:block;font-size:13px;color:#c9c9d8;margin:0 0 6px}input{width:100%;height:48px;padding:0 12px;margin:0 0 14px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#fff;font-size:16px}
input[type=file]{height:auto;padding:14px;border-style:dashed;font-size:15px;color:#c9c9d8}
.send{display:flex;align-items:center;justify-content:center;width:100%;height:50px;border:0;border-radius:10px;background:#ff2a2a;color:#fff;font:600 17px system-ui;text-decoration:none}
.send.alt{background:#14141d;border:1px solid #44445e}.send:disabled{opacity:.6}
.warn{padding:12px;border-radius:10px;background:#2a1a10;color:#ffd2a8;font-size:14px}
textarea{width:100%;padding:10px 12px;margin:0 0 14px;border-radius:10px;border:1px solid #33334a;background:#14141d;color:#fff;font:16px system-ui}
.more{background:none;border:0;color:#c9c9d8;font:14px system-ui;padding:0 0 14px;text-decoration:underline}
#err,#berr{color:#ff8a8a;font-size:14px;min-height:20px;margin-bottom:8px}.hidden{display:none}
#up{height:6px;background:#2a2a38;border-radius:3px;overflow:hidden;margin-top:12px}#up i{display:block;height:100%;background:#ffb547;transform-origin:left;transform:scaleX(0);transition:transform .2s}
</style></head><body><main>
<div id="done" class="hidden"><h1>Pronto!</h1><p id="donetext">A lista foi enviada. Continue na TV.</p></div>
<div id="main">
<h1>Adicionar lista</h1><p>Os dados vão direto para a sua TV, pela rede de casa.</p>
<div class="tabs"><button type="button" id="tx" class="on">Xtream</button><button type="button" id="tm">Link M3U</button><button type="button" id="tf">Arquivo M3U</button><button type="button" id="tb">Lista IPTVKZ</button></div>
<form id="f">
<div id="px"><label for="s">Servidor (ou cole o link get.php)</label><input id="s" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="http://servidor.com:8080">
<button type="button" class="more" id="mb">+ O provedor deu mais de um servidor?</button>
<div id="ms" class="hidden"><label for="ss">Outros servidores do mesmo provedor</label><textarea id="ss" rows="4" autocapitalize="none" placeholder="Pode colar vários de uma vez, do jeito que vieram"></textarea></div>
<label for="u">Usuário</label><input id="u" autocomplete="off" autocapitalize="none"><label for="w">Senha</label><input id="w" type="password" autocomplete="off"></div>
<div id="pm" class="hidden"><label for="l">Link da lista</label><input id="l" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="http://…/lista.m3u"></div>
<div id="pf" class="hidden"><label for="mf">Arquivo da lista (.m3u)</label><input type="file" id="mf" accept=".m3u,.m3u8,.txt,.php,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"></div>
<label for="n">Nome (opcional)</label><input id="n" autocomplete="off" placeholder="Minha lista">
<div id="err"></div><button class="send" id="b">Enviar para a TV</button><div id="up" class="hidden"><i></i></div>
</form>
<div id="pb" class="hidden">
<h2>Lista IPTVKZ</h2><p>Escolha o arquivo que você baixou pelo botão “Baixar lista”, em outra TV (começa com “iptvkz-lista”). Ela entra nesta TV com favoritos e histórico; as outras listas continuam.</p>
<input type="file" id="a" accept=".json,application/json">
<div id="berr"></div><button class="send" id="rb" type="button">Carregar lista</button>
</div>
</div>
<div id="save" class="hidden"><h1>Baixar lista no celular</h1>
<p>Baixa um arquivo com a lista, os favoritos e o histórico dela. Em outro aparelho, abra “Adicionar lista”, escaneie o QR Code e use “Lista IPTVKZ”.</p>
<p class="warn">O arquivo contém o usuário e a senha da lista. Guarde com cuidado e não compartilhe.</p>
<a class="send" id="dl" download>Baixar lista</a>
<p id="saved" class="hidden" style="margin-top:16px">Download iniciado. Confira a pasta de downloads do celular.</p>
</div></main>
<script>
var type='xtream',$=function(i){return document.getElementById(i)};
function tab(t){type=t;$('tx').className=t==='xtream'?'on':'';$('tm').className=t==='m3u'?'on':'';$('tf').className=t==='file'?'on':'';$('tb').className=t==='backup'?'on':'';
$('f').className=t==='backup'?'hidden':'';$('pb').className=t==='backup'?'':'hidden';$('px').className=t==='xtream'?'':'hidden';$('pm').className=t==='m3u'?'':'hidden';$('pf').className=t==='file'?'':'hidden'}
$('tx').onclick=function(){tab('xtream')};$('tm').onclick=function(){tab('m3u')};$('tf').onclick=function(){tab('file')};$('tb').onclick=function(){tab('backup')};
var lista=new URLSearchParams(location.search).get('lista');
if(lista){$('main').className='hidden';$('save').className='';$('dl').href=location.pathname.replace(/\\/$/,'')+'/arquivo?lista='+encodeURIComponent(lista);$('dl').addEventListener('click',function(){$('saved').className=''})}
function finish(t){$('main').className='hidden';$('donetext').textContent=t;$('done').className=''}
$('mb').onclick=function(){$('mb').className='hidden';$('ms').className='';$('ss').focus()};
$('s').addEventListener('change',function(){try{var u=new URL($('s').value.trim()),a=u.searchParams.get('username'),b=u.searchParams.get('password');if(a&&b&&/get\\.php|player_api\\.php/i.test(u.pathname)){$('s').value=u.protocol+'//'+u.host;$('u').value=a;$('w').value=b}}catch(e){}});
function answer(r){if(r.ok){finish('A lista foi enviada. Continue na TV.');return}return r.json().catch(function(){return {}}).then(function(j){
$('up').className='hidden';$('err').textContent=r.status===410?'Este código expirou. Escaneie o novo QR Code na TV.':(j.error||'Confira os campos e tente de novo.');$('b').disabled=false;$('b').textContent='Enviar para a TV'})}
// envio com andamento (o fetch não informa quanto do arquivo já subiu); devolve algo com a cara da resposta do fetch
function send(url,body,onp){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open('POST',url);
x.upload.onprogress=function(e){if(e.lengthComputable)onp(e.loaded/e.total)};
x.onload=function(){ok({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve().then(function(){return JSON.parse(x.responseText)})}})};
x.onerror=no;x.send(body)})}
// confere o arquivo antes de enviar (um app ou um vídeo não sobem à toa): o servidor da TV confere de novo
var BIN='Esse arquivo não é uma lista: parece um app, um vídeo, uma imagem ou um documento. Escolha o arquivo .m3u que o provedor mandou.';
function headOf(f){return new Promise(function(ok){var r=new FileReader();r.onload=function(){ok(String(r.result||''))};r.onerror=function(){ok('')};r.readAsBinaryString(f.slice(0,2048))})}
function m3uBad(h){var t=h.replace(/^ï»¿/,'');if(!t.trim())return 'O arquivo está vazio.';for(var i=0;i<t.length;i++)if(t.charCodeAt(i)===0)return BIN;
if(t.slice(0,2)==='PK'||t.slice(0,2)==='MZ'||t.slice(0,4)==='%PDF'||t.slice(1,4)==='PNG'||t.slice(4,8)==='ftyp')return BIN;t=t.trim();
if(t.charAt(0)==='<')return 'Esse arquivo é uma página da internet, não uma lista M3U. Escolha o arquivo .m3u que o provedor mandou.';
if(!/^(#EXTM3U|#EXTINF|#EXTGRP|https?:|rtmp:|rtsp:|udp:|rtp:)/i.test(t)&&!/#EXTINF/i.test(t))return 'Esse arquivo não é uma lista M3U. Escolha o arquivo .m3u que o provedor mandou.';return ''}
function lost(){$('up').className='hidden';$('err').textContent='Não foi possível falar com a TV. Confira se o celular está no mesmo Wi-Fi.';$('b').disabled=false;$('b').textContent='Enviar para a TV'}
$('f').addEventListener('submit',function(e){e.preventDefault();$('err').textContent='';
if(type==='file'){var mf=$('mf').files[0];if(!mf){$('err').textContent='Escolha o arquivo .m3u da lista.';return}
headOf(mf).then(function(h){var bad=m3uBad(h);if(bad){$('err').textContent=bad;return}$('b').disabled=true;$('b').textContent='Enviando... 0%';$('up').className='';
send(location.pathname.replace(/\\/$/,'')+'/m3u?nome='+encodeURIComponent($('n').value.trim()||mf.name),mf,function(p){var n=Math.round(p*100);
$('b').textContent=n<100?'Enviando para a TV... '+n+'%':'Guardando na TV...';$('up').firstChild.style.transform='scaleX('+p+')'}).then(answer).catch(lost);});return}
$('b').disabled=true;
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,name:$('n').value,server:$('s').value,servers:$('ss').value,username:$('u').value,password:$('w').value,url:$('l').value})}).then(answer).catch(lost)});
$('rb').addEventListener('click',function(){$('berr').textContent='';var file=$('a').files[0];
if(!file){$('berr').textContent='Escolha o arquivo da lista baixada (começa com “iptvkz-lista”).';return}
if(file.size>50*1048576||!/[.]json$/i.test(file.name)){$('berr').textContent='Esse arquivo não é uma lista baixada do IPTVKZ. O certo começa com “iptvkz-lista” e termina em .json.';return}
$('rb').disabled=true;file.text().then(function(t){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:t})})
.then(function(r){return r.json().catch(function(){return {}}).then(function(j){
if(r.ok){finish('Lista enviada. Confirme na TV.');return}
$('berr').textContent=r.status===410?'Este código expirou. Escaneie o novo QR Code na TV.':(j.error||'Não foi possível ler o arquivo.');$('rb').disabled=false})})
.catch(function(){$('berr').textContent='Não foi possível falar com a TV. Confira se o celular está no mesmo Wi-Fi.';$('rb').disabled=false})});
</script></body></html>`;

const STYLE = FORM.match(/<style>[\s\S]*?<\/style>/)[0];

const EDIT_FORM = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Editar lista · IPTVKZ</title>${STYLE}<style>
.rows{display:grid;gap:8px;margin-bottom:14px}.srow{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:#14141d;border:1px solid #33334a}
.srow.on{border-color:#ff2a2a}.srow .h{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.tag{font-size:11px;padding:2px 6px;border-radius:6px;background:#ff2a2a;color:#fff}.ms{font-size:13px}.good{color:#3ecf8e}.warn{color:#f5b642}.bad{color:#ff8a8a}
.sm{height:34px;padding:0 10px;border-radius:8px;border:1px solid #44445e;background:#1c1c28;color:#fff;font:14px system-ui}
.bar{position:sticky;bottom:0;background:#08080b;padding:12px 0 4px}.acts{display:flex;gap:8px;margin:6px 0 18px}.acts .sm{flex:1;height:44px}.danger{border-color:#7a2a2a;color:#ff8a8a}
#ok{color:#3ecf8e;font-size:14px;min-height:20px;margin-bottom:8px}
</style></head><body><main>
<div id="done" class="hidden"><h1>Pronto!</h1><p id="donetext"></p></div>
<div id="main">
<h1>Editar lista</h1><p id="sub">Carregando...</p>
<div class="tabs" id="tabs"><button type="button" id="t1" class="on">Dados</button><button type="button" id="t2">Servidores</button></div>
<div id="p1">
<label for="n">Nome</label><input id="n" autocomplete="off">
<div id="xt"><label for="u">Usuário</label><input id="u" autocomplete="off" autocapitalize="none"><label for="w">Senha</label><input id="w" type="password" autocomplete="off"></div>
<div id="mu" class="hidden"><label for="l">Link da lista</label><input id="l" autocomplete="off" autocapitalize="none" inputmode="url"></div>
<label for="g">Guia de programação (EPG), opcional</label><input id="g" autocomplete="off" autocapitalize="none" inputmode="url" placeholder="Vazio: usa o guia da lista">
<h2>Ações</h2><div class="acts"><button type="button" class="sm" id="ra">Atualizar lista</button><button type="button" class="sm danger" id="da">Excluir lista</button></div>
</div>
<div id="p2" class="hidden">
<p>Mesmo usuário e senha. O primeiro é o que está em uso; se ele cair, o app usa o próximo.</p>
<div class="rows" id="rows"></div>
<label for="ns">Adicionar servidor</label><textarea id="ns" rows="2" autocapitalize="none" placeholder="Pode colar vários de uma vez"></textarea>
<div class="acts"><button type="button" class="sm" id="ad">Adicionar</button><button type="button" class="sm" id="te">Testar servidores</button></div>
</div>
<div class="bar"><div id="err"></div><div id="ok"></div><button class="send" id="sv" type="button">Salvar na TV</button></div>
</div></main>
<script>
var $=function(i){return document.getElementById(i)},base=location.pathname.replace(/\\/$/,''),L=null,srv=[],res={};
function tab(n){$('t1').className=n===1?'on':'';$('t2').className=n===2?'on':'';$('p1').className=n===1?'':'hidden';$('p2').className=n===2?'':'hidden'}
$('t1').onclick=function(){tab(1)};$('t2').onclick=function(){tab(2)};
function short(s){return String(s).replace(/^https?:\\/\\//,'')}
function rows(){var b=$('rows');b.innerHTML='';srv.forEach(function(s,i){var r=res[s],d=document.createElement('div');d.className='srow'+(i===0?' on':'');
var h=document.createElement('span');h.className='h';h.textContent=short(s);d.appendChild(h);
if(i===0){var t=document.createElement('span');t.className='tag';t.textContent='EM USO';d.appendChild(t)}
if(r){var m=document.createElement('span');m.className='ms '+(r.ms==null?'bad':r.ms<800?'good':r.ms<2000?'warn':'bad');m.textContent=r.ms==null?(r.state==='offline'?'fora do ar':'recusou'):r.ms+' ms';d.appendChild(m)}
if(i>0){var u=document.createElement('button');u.type='button';u.className='sm';u.textContent='Usar';u.onclick=function(){srv.splice(i,1);srv.unshift(s);rows()};d.appendChild(u);
var x=document.createElement('button');x.type='button';x.className='sm danger';x.textContent='Tirar';x.onclick=function(){srv.splice(i,1);rows()};d.appendChild(x)}
b.appendChild(d)})}
function post(sub,obj){return fetch(base+(sub?'/'+sub:''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}).then(function(r){if(r.status===410)throw new Error('Este código expirou. Abra o QR Code de novo na TV.');if(!r.ok)throw new Error('Não deu certo. Tente de novo.');return r.json().catch(function(){return {}})})}
function msg(e,o){$('err').textContent=e||'';$('ok').textContent=o||''}
function fail(e){msg(e&&e.message&&e.message.indexOf('fetch')<0?e.message:'Não foi possível falar com a TV. Confira se o celular está no mesmo Wi-Fi.')}
fetch(base+'/dados').then(function(r){if(!r.ok)throw new Error('Este código expirou. Abra o QR Code de novo na TV.');return r.json()}).then(function(d){L=d;
$('sub').textContent='As mudanças vão direto para a TV, pela rede de casa.';$('n').value=d.name||'';$('g').value=d.epgUrl||'';
if(d.type==='xtream'){$('u').value=d.username||'';$('w').value=d.password||'';srv=[d.server].concat(d.servers||[]);rows()}
else{$('xt').className='hidden';$('tabs').className='hidden';if(d.source!=='file'){$('mu').className='';$('l').value=d.url||''}}
}).catch(fail);
$('ad').onclick=function(){$('ns').value.split(/[\\s,;|]+/).filter(Boolean).forEach(function(s){if(srv.indexOf(s)<0)srv.push(s)});$('ns').value='';rows()};
$('te').onclick=function(){if(!srv.length)return;msg('','Testando um servidor de cada vez...');$('te').disabled=true;post('teste',{servers:srv}).then(function(r){res={};srv=r.results.map(function(x){res[x.server]=x;return x.server});rows();msg('','Teste pronto.')}).catch(fail).then(function(){$('te').disabled=false})};
$('sv').onclick=function(){if(!L)return;$('sv').disabled=true;msg();
post('',{edit:{action:'save',fields:{name:$('n').value,server:srv[0]||'',servers:srv.slice(1),username:$('u').value,password:$('w').value,url:$('l').value,epgUrl:$('g').value}}}).then(function(){msg('','Salvo na TV.')}).catch(fail).then(function(){$('sv').disabled=false})};
$('ra').onclick=function(){post('',{edit:{action:'refresh'}}).then(function(){msg('','A TV está atualizando a lista.')}).catch(fail)};
$('da').onclick=function(){if(!confirm('Excluir esta lista da TV? Favoritos e progresso dela também serão apagados.'))return;post('',{edit:{action:'delete'}}).then(function(){$('main').className='hidden';$('donetext').textContent='A lista foi excluída da TV.';$('done').className=''}).catch(fail)};
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

// Edição pelo celular: a página, os dados da lista, o teste de servidores e os pedidos (salvar, atualizar, excluir).
function handleEdit(req, res, s, sub, json) {
  const list = store.getList(s.list);
  if (!list) { res.writeHead(410, HEADERS); return res.end(EXPIRED); }
  if (req.method === 'GET') {
    if (sub === 'dados') {
      const { name, type, source, server, servers, username, password, url, epgUrl } = list;
      return json(200, { name, type, source, server, servers: servers || [], username, password, url, epgUrl });
    }
    res.writeHead(200, HEADERS);
    return res.end(EDIT_FORM);
  }
  if (req.method !== 'POST') { res.writeHead(405, HEADERS); return res.end(); }
  return readBody(req).then(async (text) => {
    const body = JSON.parse(text || '{}');
    if (sub === 'teste') {
      const all = (Array.isArray(body.servers) ? body.servers : []).slice(0, 30).map((x) => String(x || '').trim()).filter(Boolean);
      if (!all.length || list.type !== 'xtream') return json(400, { error: 'Sem servidores para testar.' });
      return json(200, await catalogs.speedTest({ server: all[0], servers: all.slice(1), username: list.username, password: list.password }));
    }
    const e = body && body.edit;
    if (!e || !['save', 'refresh', 'delete'].includes(e.action)) return json(400, { error: 'Pedido inválido.' });
    s.received = { edit: { id: s.list, action: e.action, fields: e.action === 'save' ? cleanEdit(e.fields) : null } };
    return json(200, { ok: true });
  }).catch(() => json(400, { error: 'Pedido inválido.' }));
}

// Só vale com o pareamento ligado e de endereços da rede de casa (conferido por quem chama).
function handle(req, res, url) {
  const [token, sub = ''] = url.pathname.slice('/pair/'.length).split('/');
  const s = current(token);
  if (!s || s.used) {
    res.writeHead(410, HEADERS);
    return res.end(EXPIRED);
  }
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (s.mode === 'edit') return handleEdit(req, res, s, sub, json);
  if (req.method === 'GET') {
    if (sub === 'arquivo') return sendList(res, s, url.searchParams.get('lista'));
    res.writeHead(200, HEADERS);
    return res.end(FORM);
  }
  if (req.method !== 'POST') {
    res.writeHead(405, HEADERS);
    return res.end();
  }
  // arquivo .m3u: chega cru (o corpo é o arquivo) e o nome vai no endereço
  if (sub === 'm3u') {
    return receiveM3u(req).then(({ id, size }) => {
      if (s !== current(token) || s.used) { fs.unlink(store.file(pairName(id)), () => {}); return json(410, { error: 'Este código expirou. Escaneie o novo QR Code na TV.' }); }
      const name = String(url.searchParams.get('nome') || '').replace(/\.(m3u8?|txt)$/i, '').trim().slice(0, 120);
      s.received = { type: 'm3u', source: 'file', name, pairFile: id, size };
      s.used = true;
      return json(200, { ok: true });
    }, (err) => json(400, { error: err.message }));
  }
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
    if (list.error) return json(400, { error: list.error });
    s.received = list;
    s.used = true;
    res.writeHead(200, HEADERS);
    res.end();
  }).catch(() => json(400, { error: 'O arquivo é grande demais ou não chegou inteiro.' }));
}

module.exports = { enable, enabled: () => enabled, begin, status, takeRestore, end, handle, adoptFile };
