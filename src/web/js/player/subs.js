// Legendas: leitura de .srt/.vtt (UTF-8 ou Windows-1252) e busca de falas por tempo.

export async function readSubFile(file) {
  const buf = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  const cues = parseSubs(text);
  if (!cues.length) throw new Error('Não encontrei falas nesse arquivo de legenda.');
  return cues;
}

function toSec(ts) {
  const m = ts.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +m[4].padEnd(3, '0') / 1000 : 0);
}

export function parseSubs(text) {
  const blocks = text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const s = toSec(a);
    const e = toSec(z.trim().split(/\s+/)[0]);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const txt = lines.slice(ti + 1).join('\n').trim();
    if (txt) cues.push({ s, e, text: txt });
  }
  cues.sort((x, y) => x.s - y.s);
  return cues;
}

// Falas ativas em t (lista ordenada por início). Funciona com arrays e TextTrackCueList.
export function cuesAt(list, t, getS = (c) => c.s, getE = (c) => c.e) {
  const n = list.length;
  if (!n) return [];
  let lo = 0;
  let hi = n - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (getS(list[mid]) <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out = [];
  for (let i = idx; i >= 0 && i > idx - 8; i--) {
    const c = list[i];
    if (getE(c) > t) out.unshift(c);
  }
  return out;
}

// Mantém só <i>, <b>, <u>; remove o resto (inclusive tags ASS tipo {\an8}).
export function subHtml(text) {
  return String(text)
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>')
    .replace(/&lt;\/?[^&]*&gt;/g, '')
    .replace(/\n/g, '<br>');
}
