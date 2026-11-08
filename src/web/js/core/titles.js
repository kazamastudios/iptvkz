// Títulos de episódio costumam vir como "Familia Moderna [L] S04 E20": tira o que só repete
// a série e o número, mantendo o nome real do episódio quando existe.
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CODES = [
  /\b[ST]\d{1,2}\s*[-_.]?\s*E[Pp]?\s*\d{1,4}\b/gi,
  /\b\d{1,2}x\d{1,4}\b/gi,
  /\b[ST]\d{1,2}\b/gi,
  /\bE[Pp]?\s?\d{1,4}\b/gi,
];
const EDGES = /^[\s\-–—_.:|,]+|[\s\-–—_.:|,]+$/g;

export function cleanEpisodeTitle(raw, serieName, num) {
  const generic = num ? `Episódio ${num}` : 'Episódio';
  let t = String(raw || '').replace(/\[[^\]]*\]/g, ' ').replace(/\((19|20)\d{2}\)/g, ' ');
  for (const re of CODES) t = t.replace(re, ' ');
  t = t.replace(/\s+/g, ' ').replace(EDGES, '');

  // tira o nome da série do começo
  const name = plain(String(serieName || '').replace(/\([^)]*\)/g, ' '));
  const words = t.split(' ');
  for (let n = words.length; n > 0; n--) {
    if (name && plain(words.slice(0, n).join(' ')) === name) {
      t = words.slice(n).join(' ').replace(EDGES, '');
      break;
    }
  }

  const check = plain(t);
  if (!check || /^\d+$/.test(check) || /^(ep|episodio|episode|capitulo|cap)( \d+)?$/.test(check)) return generic;
  return t;
}
