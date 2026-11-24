// Tema: cor de destaque, fundo e o jeito das capas (tamanho, cantos, o que aparece nelas). É por aparelho, como o visual (core/viewmode.js): fica no localStorage e não vai
// para o servidor. As cores além do vermelho e os fundos Preto e Grafite são do IPTVKZ+ (core/premium.js): sem ele,
// a pessoa experimenta em Configurações, e o tema volta ao sair de lá. O CSS dos temas está em css/app.css.
import { hasPlus } from './premium.js';

const KEY = 'iptvkz.theme';

// color: amostra na tela de escolha (no Beta, o padrão "Vermelho" aparece âmbar, como o resto do Beta)
export const ACCENTS = [
  { id: 'red', label: 'Vermelho', color: '#ff2a2a', free: true },
  { id: 'blue', label: 'Azul', color: '#3d8bff' },
  { id: 'green', label: 'Verde', color: '#22c55e' },
  { id: 'purple', label: 'Roxo', color: '#a970ff' },
  { id: 'pink', label: 'Rosa', color: '#ff4fa3' },
  { id: 'cyan', label: 'Ciano', color: '#22d3ee' },
];

export const BACKGROUNDS = [
  { id: 'dark', label: 'Escuro', color: '#08080b', card: '#1a1a25', free: true },
  { id: 'black', label: 'Preto', color: '#000000', card: '#121219', note: 'Bom para telas OLED' },
  { id: 'graphite', label: 'Grafite', color: '#1a1b21', card: '#282a33' },
];

// Capas do seu jeito (css/app.css: html[data-psize], [data-pradius], [data-phide])
export const SIZES = [
  { id: 's', label: 'Pequena' },
  { id: 'm', label: 'Média', free: true },
  { id: 'l', label: 'Grande' },
];
export const RADII = [
  { id: 'square', label: 'Retos' },
  { id: 'round', label: 'Arredondados', free: true },
  { id: 'soft', label: 'Bem redondos' },
];
// o que aparece sobre a capa (e o nome embaixo): a pessoa esconde o que não quer ver
export const OVERLAYS = [
  { id: 'tags', label: 'Dublado e Legendado' },
  { id: 'rating', label: 'Nota' },
  { id: 'year', label: 'Ano' },
  { id: 'seen', label: 'Assistido e episódio' },
  { id: 'bar', label: 'Barra de progresso' },
  { id: 'name', label: 'Nome embaixo' },
];

const DEFAULT = { accent: 'red', bg: 'dark', size: 'm', radius: 'round', hide: [] };
const LISTS = { accent: ACCENTS, bg: BACKGROUNDS, size: SIZES, radius: RADII };
const valid = (list, id) => list.some((x) => x.id === id);
const cleanHide = (v) => (Array.isArray(v) ? OVERLAYS.map((o) => o.id).filter((id) => v.includes(id)) : []);
// grátis: o padrão de cada parte (em "hide", não esconder nada)
export const isFree = (part, id) => (part === 'hide' ? !cleanHide(id).length : LISTS[part].some((x) => x.id === id && x.free));

// O que a pessoa escolheu (mesmo que pago e sem IPTVKZ+)
export function savedTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { hide: cleanHide(t.hide) };
    for (const [part, list] of Object.entries(LISTS)) out[part] = valid(list, t[part]) ? t[part] : DEFAULT[part];
    return out;
  } catch {
    return { ...DEFAULT };
  }
}

// O que vale na tela: o escolhido, com o pago trocado pelo padrão quando não há IPTVKZ+
export function theme() {
  const t = savedTheme();
  if (hasPlus()) return t;
  const out = {};
  for (const part of Object.keys(DEFAULT)) out[part] = isFree(part, t[part]) ? t[part] : DEFAULT[part];
  return out;
}

let shown = null; // tema em prévia (não salvo), ou null
export const isPreviewing = () => !!shown;
// o que está na tela agora: a prévia ou o que vale
export const currentTheme = () => shown || theme();

// Marca o <html> para o CSS. Sem o atributo, vale o padrão (vermelho; âmbar no Beta).
export function applyTheme(t = theme()) {
  const html = document.documentElement;
  if (t.accent === DEFAULT.accent) delete html.dataset.accent; else html.dataset.accent = t.accent;
  if (t.bg === DEFAULT.bg) delete html.dataset.bg; else html.dataset.bg = t.bg;
  if (t.size === DEFAULT.size) delete html.dataset.psize; else html.dataset.psize = t.size;
  if (t.radius === DEFAULT.radius) delete html.dataset.pradius; else html.dataset.pradius = t.radius;
  if (!t.hide.length) delete html.dataset.phide; else html.dataset.phide = t.hide.join(' ');
  // Android: a abertura nativa (antes da página carregar) usa a mesma cor na próxima vez. Prévia não conta.
  const a = window.IPTVKZAndroid;
  if (!shown && a && a.setThemeAccent) try { a.setThemeAccent(t.accent); } catch {}
}

export function setTheme(part, id) {
  const t = { ...savedTheme(), [part]: id };
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
  if (shown) { shown = { ...shown, [part]: id }; applyTheme(shown); } else applyTheme();
}

// Mostra um tema sem salvar (item pago sem IPTVKZ+). Volta ao sair de Configurações ou com endPreview().
export function previewTheme(part, id) {
  shown = { ...currentTheme(), [part]: id };
  applyTheme(shown);
}

export function endPreview() {
  if (!shown) return;
  shown = null;
  applyTheme();
}

window.addEventListener('hashchange', () => {
  if (shown && !location.hash.startsWith('#/settings')) endPreview();
});
// a compra (ou "Simular sem IPTVKZ+" no Beta) muda o que vale
window.addEventListener('iptvkz:plus', () => { shown = null; applyTheme(); });
