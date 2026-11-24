// Roda antes da página no teste de navegador antigo (scripts/test-old-browser.js): tira do navegador o que o
// Chromium 51 (WebView do Android 7.0, piso do app) não tem e guarda todo erro de JavaScript da página.
/* eslint-disable no-extend-native */
const gone = [];
function drop(obj, name, label) {
  if (!obj || !(name in obj)) return;
  try {
    delete obj[name];
    if (name in obj) Object.defineProperty(obj, name, { value: undefined, configurable: true, writable: true });
    gone.push(label);
  } catch {}
}

const P = (C) => C && C.prototype;
// [objeto, nome, versão do Chromium em que apareceu]
const MISSING = [
  [Object, 'values', 54], [Object, 'entries', 54], [Object, 'getOwnPropertyDescriptors', 54],
  [Object, 'fromEntries', 73], [Object, 'hasOwn', 93],
  [P(String), 'padStart', 57], [P(String), 'padEnd', 57], [P(String), 'trimStart', 66], [P(String), 'trimEnd', 66],
  [P(String), 'matchAll', 73], [P(String), 'replaceAll', 85], [P(String), 'at', 92],
  [P(Array), 'flat', 69], [P(Array), 'flatMap', 69], [P(Array), 'at', 92], [P(Array), 'findLast', 97],
  [P(Array), 'findLastIndex', 97], [P(Array), 'toSorted', 110], [P(Array), 'toReversed', 110],
  [P(Promise), 'finally', 63], [Promise, 'allSettled', 76], [Promise, 'any', 85],
  [window, 'AbortController', 66], [window, 'AbortSignal', 66], [window, 'ResizeObserver', 64],
  [window, 'queueMicrotask', 71], [window, 'structuredClone', 98], [window, 'BroadcastChannel', 54],
  [P(Element), 'append', 54], [P(Element), 'prepend', 54], [P(Element), 'before', 54], [P(Element), 'after', 54],
  [P(Element), 'replaceWith', 54], [P(Element), 'replaceChildren', 86], [P(Element), 'toggleAttribute', 69],
  [P(Element), 'scrollTo', 61], [P(Element), 'scrollBy', 61], [P(Element), 'getAttributeNames', 61],
  [P(DocumentFragment), 'append', 54], [P(DocumentFragment), 'prepend', 54], [P(DocumentFragment), 'replaceChildren', 86],
  [P(Document), 'append', 54], [P(Document), 'prepend', 54], [P(Document), 'replaceChildren', 86],
  [P(CharacterData), 'before', 54], [P(CharacterData), 'after', 54], [P(CharacterData), 'replaceWith', 54],
  [typeof Intl !== 'undefined' && Intl, 'PluralRules', 63], [typeof Intl !== 'undefined' && Intl, 'RelativeTimeFormat', 71],
  [typeof Intl !== 'undefined' && Intl, 'ListFormat', 72],
  [navigator, 'clipboard', 66],
];
// O Chromium antigo ignora o "signal" do fetch (ele nem existia). O de hoje recusa o AbortController substituto
// dos polyfills; aqui o fetch faz como o antigo.
const RealSignal = window.AbortSignal;
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (init && init.signal && !(init.signal instanceof RealSignal)) {
    init = Object.assign({}, init);
    delete init.signal;
  }
  return realFetch(input, init);
};
for (const [obj, name, v] of MISSING) drop(obj, name, `${name} (${v})`);
// globalThis por último: o resto do arquivo não usa mais
drop(window, 'globalThis', 'globalThis (71)');

window.__oldGone = gone;
window.__errs = [];
window.addEventListener('error', (e) => {
  if (e && e.message) window.__errs.push(`${e.message} @ ${(e.filename || '').replace(location.origin, '')}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  // erro do próprio Electron (ele usa o que foi tirado acima), não do app
  if (r && r.stack && /node:electron\//.test(r.stack)) return;
  window.__errs.push('Promise rejeitada: ' + ((r && (r.stack || r.message)) || String(r)));
});
