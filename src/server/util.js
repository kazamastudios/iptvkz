// Utilidades compartilhadas do servidor.
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
  return String(s || '')
    .normalize('NFD')
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

// Baixa o corpo inteiro. Lista grande em provedor lento pode levar minutos: o prazo só vence se o provedor
// ficar idleMs sem mandar nada (parou no meio) ou passar de maxMs no total. onProgress(recebido, total) a cada
// pedaço; total é 0 quando o provedor não informa o tamanho.
async function readText(url, { onProgress, idleMs = 45000, maxMs = 15 * 60000 } = {}) {
  const ctrl = new AbortController();
  let idle = setTimeout(() => ctrl.abort(), idleMs);
  const hard = setTimeout(() => ctrl.abort(), maxMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`O servidor respondeu ${res.status} (${safeHost(url)})`), { status: res.status });
    // com compressão, o tamanho informado é o comprimido: não serve de total
    const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let got = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), idleMs);
        chunks.push(chunk);
        got += chunk.length;
        if (onProgress) onProgress(got, total);
      }
    }
    return Buffer.concat(chunks, got).toString('utf8');
  } catch (err) {
    if (ctrl.signal.aborted) throw Object.assign(new Error('Tempo esgotado ao baixar de ' + safeHost(url)), { timeout: true });
    if (err.status) throw err;
    throw new Error('Não foi possível conectar a ' + safeHost(url) + ' (' + (err.cause?.code || err.message) + ')');
  } finally {
    clearTimeout(idle);
    clearTimeout(hard);
  }
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

module.exports = { UA, hash, norm, fetchWithTimeout, fetchText, fetchJson, safeHost };
