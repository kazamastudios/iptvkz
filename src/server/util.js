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
    throw new Error('Não foi possível conectar a ' + safeHost(url) + ' (' + (err.cause?.code || err.message) + ')');
  } finally {
    clearTimeout(timer);
  }
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return 'o servidor'; }
}

// Baixa o corpo e entrega o texto em pedaços (onText) conforme chega. Lista grande em provedor lento pode levar
// minutos: o prazo só vence se o provedor ficar idleMs sem mandar nada (parou no meio) ou passar de maxMs no total.
// onProgress(recebido, total) a cada pedaço; total é 0 quando o provedor não informa o tamanho.
// headers: cabeçalhos a mais no pedido (If-None-Match / If-Modified-Since, para perguntar se a lista mudou).
// Devolve também o ETag e o Last-Modified da resposta (null quando o provedor não manda). Com 304 (não mudou),
// não lê nada e devolve notModified: true.
async function readBody(url, onText, { onProgress, headers, idleMs = 45000, maxMs = 15 * 60000 } = {}) {
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
    if (!res.ok) throw Object.assign(new Error(`O servidor respondeu ${res.status} (${safeHost(url)})`), { status: res.status });
    // com compressão, o tamanho informado é o comprimido: não serve de total (nem para ver se chegou inteira; aí
    // quem acusa a lista cortada é a descompressão, que falha sem o fim do arquivo)
    const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
    // decodifica cada pedaço assim que chega (StringDecoder cuida de acento partido entre pedaços)
    const decoder = new StringDecoder('utf8');
    let got = 0;
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
        give(decoder.write(buf));
        if (onProgress) onProgress(got, total);
      }
    }
    give(decoder.end());
    // o provedor fechou a conexão antes do fim: a lista chegou pela metade e não pode substituir a anterior
    if (total && got < total) {
      throw Object.assign(new Error(`A lista chegou incompleta (${Math.round(got / 1048576)} de ${Math.round(total / 1048576)} MB). Tente de novo.`), { status: 'incomplete' });
    }
    return { got, total, etag, lastModified };
  } catch (err) {
    if (err.handler) throw err;
    if (ctrl.signal.aborted) throw Object.assign(new Error('Tempo esgotado ao baixar de ' + safeHost(url)), { timeout: true });
    if (err.status) throw err;
    throw new Error('Não foi possível conectar a ' + safeHost(url) + ' (' + (err.cause?.code || err.message) + ')');
  } finally {
    clearTimeout(idle);
    clearTimeout(hard);
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
async function streamLines(url, onLine, opts) {
  let carry = '';
  let head = '';
  const r = await readBody(url, (t) => {
    if (head.length < 200) head += t.slice(0, 200 - head.length);
    let text = carry + t;
    let pos = 0;
    for (let nl = text.indexOf('\n'); nl >= 0; nl = text.indexOf('\n', pos)) {
      onLine(text.slice(pos, nl));
      pos = nl + 1;
    }
    carry = text.slice(pos);
    text = null;
  }, opts);
  if (r.notModified) return { head, notModified: true, etag: r.etag, lastModified: r.lastModified };
  if (carry) onLine(carry);
  return { head, etag: r.etag, lastModified: r.lastModified };
}

const fetchText = (url, opts) => readText(url, opts);

async function fetchJson(url, opts) {
  const text = await readText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta inválida do servidor (não é JSON)');
  }
}

module.exports = { UA, hash, norm, fetchWithTimeout, fetchText, fetchJson, streamLines, safeHost };
