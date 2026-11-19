// Tema: cor de destaque e fundo. É por aparelho, como o visual (core/viewmode.js): fica no localStorage e não vai
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

const DEFAULT = { accent: 'red', bg: 'dark' };
const valid = (list, id) => list.some((x) => x.id === id);
export const isFree = (part, id) => (part === 'accent' ? ACCENTS : BACKGROUNDS).some((x) => x.id === id && x.free);

// O que a pessoa escolheu (mesmo que pago e sem IPTVKZ+)
export function savedTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      accent: valid(ACCENTS, t.accent) ? t.accent : DEFAULT.accent,
      bg: valid(BACKGROUNDS, t.bg) ? t.bg : DEFAULT.bg,
    };
  } catch {
    return { ...DEFAULT };
  }
}

// O que vale na tela: o escolhido, com o pago trocado pelo padrão quando não há IPTVKZ+
export function theme() {
  const t = savedTheme();
  if (hasPlus()) return t;
  return {
    accent: isFree('accent', t.accent) ? t.accent : DEFAULT.accent,
    bg: isFree('bg', t.bg) ? t.bg : DEFAULT.bg,
  };
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
