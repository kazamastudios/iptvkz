// Visualização escolhida (Clássica, Streaming...). É por aparelho, como o modo TV: quem prefere Streaming na TV
// pode querer outra coisa no celular. Fica no localStorage e não vai para o servidor.
const KEY = 'iptvkz.view';

export const VIEW_MODES = [
  { id: 'classic', label: 'Clássica', icon: 'viewGrid' },
  { id: 'stream', label: 'Streaming', icon: 'viewStream' },
];

export function viewMode() {
  try {
    const v = localStorage.getItem(KEY);
    return VIEW_MODES.some((m) => m.id === v) ? v : 'classic';
  } catch {
    return 'classic';
  }
}

export function setViewMode(id) {
  if (id === viewMode()) return;
  try { localStorage.setItem(KEY, id); } catch {}
  applyViewMode();
  window.dispatchEvent(new Event('iptvkz:view'));
}

// Marca o <html> para o CSS (data-view="stream").
export function applyViewMode() {
  document.documentElement.dataset.view = viewMode();
}
