// Utilidades compartilhadas do servidor.
const { StringDecoder } = require('string_decoder');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTVKZ/1.0';

function hash(str) {
  // FNV-1a 32 bits em base36: ids curtos e estáveis.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function norm(s) {
  s = String(s || '');
  // sem acento (a maioria dos nomes) não precisa do normalize, que é lento em celular e TV
  return (/[^\x00-\x7f]/.test(s) ? s.normalize('NFD') : s)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, opts = {}, ms = 90000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      ...opts,
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
    return res;
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error('Tempo esgotado ao acessar ' + safeHost(url));
    throw netError(url, err);
  } finally {
    clearTimeout(timer);
  }
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return 'o servidor'; }
}

// Falha de conexão em palavras: o código do Node (ou a mensagem, no fetch da TV LG) vira algo que a pessoa entende.
const NET_ERRORS = [
  [/ECONNREFUSED/, 'o servidor recusou a conexão; confira o endereço e a porta'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/, 'endereço não encontrado; confira se o link está certo'],
  [/ECONNRESET|socket hang up|other side closed|aborted/i, 'a conexão caiu no meio'],
  [/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT/, 'o servidor não respondeu a tempo'],
  [/EHOSTUNREACH|ENETUNREACH|ENETDOWN/, 'sem caminho até o servidor; confira a internet'],
  [/CERT|SSL|TLS|self.signed|unable to verify/i, 'problema no certificado de segurança (https); tente o link com http://'],
  [/bad port/i, 'porta não permitida no endereço'],
];
function netError(url, err) {
  const raw = [err && err.cause && err.cause.code, err && err.code, err && err.cause && err.cause.message, err && err.message].filter(Boolean).join(' ');
  let hit = NET_ERRORS.find(([re]) => re.test(raw));
  // Link http:// que deu erro de certificado: alguém no caminho desviou o pedido para uma página https que não é a
  // do servidor (é o que redes e operadoras fazem com endereços bloqueados). Mandar "usar http://" não faz sentido.
  if (hit && /certificado/.test(hit[1]) && /^http:/i.test(String(url))) {
    hit = [null, 'a rede desviou o acesso para outra página (certificado de segurança que não é o do servidor). Isso costuma acontecer quando a rede ou a operadora bloqueia o endereço; no Wi-Fi ou em outra rede o resultado pode ser outro'];
  }
  return new Error(`Não foi possível conectar a ${safeHost(url)}: ${hit ? hit[1] : raw || 'erro desconhecido'}.`);
}

// Resposta HTTP de erro em palavras (lista M3U, API do Xtream).
function httpError(url, status) {
  const host = safeHost(url);
  let msg;
  if (status === 404) msg = `${host} respondeu que o endereço não existe (erro 404). Confira o link com o seu provedor.`;
  else if (status === 401 || status === 403) msg = `${host} recusou o acesso (erro ${status}). A lista pode ter expirado ou o link mudou.`;
  else if (status === 429) msg = `${host} recebeu pedidos demais (erro 429). Espere um pouco e tente de novo.`;
  else if (status >= 500) msg = `O servidor ${host} está com problema (erro ${status}). Tente de novo mais tarde.`;
  else msg = `O servidor respondeu ${status} (${host})`;
  return Object.assign(new Error(msg), { status });
}

// Baixa o corpo e entrega o texto em pedaços (onText) conforme chega. Lista grande em provedor lento pode levar
// minutos: o prazo só vence se o provedor ficar idleMs sem mandar nada (parou no meio) ou passar de maxMs no total.
// onProgress(recebido, total) a cada pedaço; total é 0 quando o provedor não informa o tamanho.
// headers: cabeçalhos a mais no pedido (If-None-Match / If-Modified-Since, para perguntar se a lista mudou).
// Devolve também o ETag e o Last-Modified da resposta (null quando o provedor não manda). Com 304 (não mudou),
// não lê nada e devolve notModified: true.
// raw: entrega os bytes (Buffer) em vez de texto, para quem separa as linhas nos bytes (byteLines)
async function readBody(url, onText, { onProgress, headers, raw = false, idleMs = 45000, maxMs = 15 * 60000 } = {}) {
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), idleMs);
  const hard = setTimeout(() => ctrl.abort(), maxMs);
  // erro de quem recebe o texto (a montagem da lista): sai como está, não como "não foi possível conectar"
  const give = (t) => {
    try { onText(t); } catch (e) { throw Object.assign(e, { handler: true }); }
  };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      // Lista comprimida chega bem menor (texto repetitivo: 60 MB viram poucos MB). O fetch do Node já pede isso
      // sozinho; o da TV LG (shim.js) só manda o que recebe, mas descomprime a resposta: aqui pedimos sempre.
      // Só neste download: o proxy de vídeo repassa a resposta como vem e não pode receber comprimido.
      headers: Object.assign({ 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' }, headers),
      signal: ctrl.signal,
    });
    const etag = res.headers.get('etag') || null;
    const lastModified = res.headers.get('last-modified') || null;
    if (res.status === 304) {
      // sem corpo; fecha a resposta para não segurar a conexão
      if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
      return { notModified: true, etag, lastModified, got: 0, total: 0 };
    }
    if (!res.ok) {
      if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
      throw httpError(url, res.status);
    }
    // com compressão, o tamanho informado é o comprimido: não serve de total (nem para ver se chegou inteira; aí
    // quem acusa a lista cortada é a descompressão, que falha sem o fim do arquivo)
    const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
    // decodifica cada pedaço assim que chega (StringDecoder cuida de acento partido entre pedaços)
    const decoder = new StringDecoder('utf8');
    let got = 0;
    let sinceYield = 0;
    if (res.body) {
      // getReader funciona no fetch do Node e no da TV LG (platforms/webos/service/shim.js). Lá, cancelar o
      // pedido não encerra a leitura: o prazo vencido também precisa soltar a espera.
      const reader = res.body.getReader();
      const aborted = new Promise((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      aborted.catch(() => {});
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), idleMs);
        const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        got += buf.length;
        give(raw ? buf : decoder.write(buf));
        if (onProgress) onProgress(got, total);
        // com os dados já chegando de uma vez (rede local, provedor rápido), a leitura não dava vez ao resto do
        // servidor: uma pausa a cada ~512 KB deixa as outras respostas saírem
        if ((sinceYield += buf.length) >= 512 * 1024) { sinceYield = 0; await new Promise((r) => setImmediate(r)); }
      }
    }
    if (!raw) give(decoder.end());
    // o provedor fechou a conexão antes do fim: a lista chegou pela metade e não pode substituir a anterior
    if (total && got < total) {
      throw Object.assign(new Error(`A lista chegou incompleta (${Math.round(got / 1048576)} de ${Math.round(total / 1048576)} MB). Tente de novo.`), { status: 'incomplete' });
    }
    return { got, total, etag, lastModified };
  } catch (err) {
    if (err.handler) throw err;
    if (ctrl.signal.aborted) throw Object.assign(new Error('Tempo esgotado ao baixar de ' + safeHost(url)), { timeout: true });
    if (err.status) throw err;
    throw netError(url, err);
  } finally {
    clearTimeout(idle);
    clearTimeout(hard);
  }
}

// Lista JSON grande (os itens do Xtream: dezenas de MB) lida item por item enquanto chega: cada objeto do array de
// fora vira um JSON.parse pequeno, e onItem guarda só o que interessa. Interpretar tudo de uma vez travava a TV Box
// por ~9 s e punha a lista inteira na memória. Resposta que não é um array (erro, objeto) é lida inteira no fim.
async function streamJsonArray(url, onItem, opts) {
  let mode = 0; // 0: antes do '['; 1: dentro do array; 2: não é array (junta tudo)
  let depth = 0;
  let inStr = false;
  let esc = false;
  let piece = '';
  const whole = [];
  await readBody(url, (t) => {
    if (mode === 2) { whole.push(t); return; }
    let from = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (mode === 0) {
        if (c === 91) { mode = 1; from = i + 1; } // [
        else if (c > 32 && c !== 0xfeff) { mode = 2; whole.push(t.slice(i)); return; }
        continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (c === 92) esc = true; // barra invertida: o próximo caractere é literal
        else if (c === 34) inStr = false; // aspas: fim do texto
        continue;
      }
      if (c === 34) inStr = true;
      else if (c === 123 || c === 91) { if (depth === 0) { piece = ''; from = i; } depth++; }
      else if (c === 125 || c === 93) {
        if (depth === 0) continue; // ] do fim
        depth--;
        if (depth === 0) {
          onItem(JSON.parse(piece + t.slice(from, i + 1)));
          piece = '';
          from = i + 1;
        }
      }
    }
    if (depth > 0) piece += t.slice(from);
  }, opts);
  if (mode === 2) {
    const v = JSON.parse(whole.join(''));
    if (Array.isArray(v)) v.forEach(onItem);
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => { if (x && typeof x === 'object') onItem(x); });
  }
}

// O corpo inteiro como texto.
async function readText(url, opts) {
  const texts = [];
  await readBody(url, (t) => texts.push(t), opts);
  return texts.join('');
}

// Linha a linha, enquanto chega (sem guardar o texto inteiro). head: o começo do texto, para mensagens de erro.
// Repassa o que readBody devolve (notModified, etag, lastModified).
// Separa as linhas direto nos bytes e decodifica cada linha sozinha. Separar depois de decodificar o pedaço inteiro
// deixava cada nome e cada link guardado preso ao pedaço de 64 KB de onde saiu: no fim, a lista inteira continuava
// na memória (na TV LG, com limite de ~320 MB, o serviço caía com um arquivo de 69 MB). A quebra de linha é um byte
// ASCII, então nunca parte um acento ao meio.
function byteLines(onLine) {
  let carry = null;
  let head = '';
  return {
    get head() { return head; },
    push(chunk) {
      let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      carry = null;
      if (head.length < 200) head += buf.toString('utf8', 0, Math.min(buf.length, 200)).slice(0, 200 - head.length);
      let start = 0;
      for (let nl = buf.indexOf(10); nl >= 0; nl = buf.indexOf(10, start)) {
        onLine(buf.toString('utf8', start, nl));
        start = nl + 1;
      }
      // o resto (linha incompleta) é copiado, para o pedaço inteiro não ficar preso
      if (start < buf.length) carry = Buffer.from(buf.subarray(start));
      buf = null;
    },
    end() {
      if (carry) onLine(carry.toString('utf8'));
      carry = null;
    },
  };
}

// Linha a linha, enquanto chega (sem guardar o texto inteiro). head: o começo do texto, para mensagens de erro.
async function streamLines(url, onLine, opts) {
  const lines = byteLines(onLine);
  const r = await readBody(url, (buf) => lines.push(buf), { ...opts, raw: true });
  if (r.notModified) return { head: lines.head, notModified: true, etag: r.etag, lastModified: r.lastModified };
  lines.end();
  return { head: lines.head, etag: r.etag, lastModified: r.lastModified };
}

const fetchText = (url, opts) => readText(url, opts);

// Uma nova tentativa quando a conexão cai no meio (ou foi fechada pelo provedor enquanto o app estava ocupado e o
// pedido seguinte tentou reaproveitá-la). Não repete prazo esgotado nem resposta de erro do servidor.
async function fetchJson(url, opts) {
  let text;
  try {
    text = await readText(url, opts);
  } catch (err) {
    if (err.timeout || err.status || err.handler) throw err;
    text = await readText(url, opts);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta inválida do servidor (não é JSON)');
  }
}

// Confere o começo de um arquivo de lista M3U (texto) antes de aceitar: o arquivo pode ser qualquer coisa que a pessoa
// escolheu (um app .apk, um vídeo, uma página salva). Devolve a mensagem para a tela, ou null se parece uma lista.
// Aceita .m3u, .m3u8, .txt e o get.php baixado do painel Xtream: o que vale é o conteúdo, não o nome.
function m3uFileProblem(head) {
  // o começo pode chegar como latin1 (bytes): a marca BOM do UTF-8 aparece como três caracteres
  const h = String(head || '').replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, '');
  if (!h.trim()) return 'O arquivo está vazio.';
  // binário: byte zero, ou o começo de um app (.apk é um zip: PK), programa, PDF, imagem ou vídeo (ftyp)
  if (/\u0000/.test(h) || /^(PK\u0003\u0004|MZ|%PDF|\u007FELF|\u0089PNG|GIF8|\u00FF\u00D8)/.test(h) || /^[^]{4}ftyp/.test(h)) {
    return 'Esse arquivo não é uma lista: parece um app, um vídeo, uma imagem ou um documento. Escolha o arquivo .m3u que o provedor mandou.';
  }
  if (/^\s*</.test(h)) return 'Esse arquivo é uma página da internet, não uma lista M3U. Escolha o arquivo .m3u que o provedor mandou.';
  // começo de lista, ou um #EXTINF logo adiante (algumas começam com outro comentário)
  if (!/^\s*(#EXTM3U|#EXTINF|#EXTGRP|(https?|rtmp|rtsp|udp|rtp):\/\/)/i.test(h) && !/^#EXTINF/im.test(h)) {
    return 'Esse arquivo não é uma lista M3U. Escolha o arquivo .m3u que o provedor mandou.';
  }
  return null;
}

module.exports = { UA, hash, norm, fetchWithTimeout, fetchText, fetchJson, streamLines, byteLines, m3uFileProblem, streamJsonArray, safeHost };
