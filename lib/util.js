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

async function fetchText(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`O servidor respondeu ${res.status} (${safeHost(url)})`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`O servidor respondeu ${res.status} (${safeHost(url)})`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta inválida do servidor (não é JSON)');
  }
}

module.exports = { UA, hash, norm, fetchWithTimeout, fetchText, fetchJson, safeHost };
