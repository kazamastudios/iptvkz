// Celular: as categorias viram um seletor nativo (o do Android ou do iPhone), no lugar da faixa que rolava de lado.
// Ele lê os botões já montados na lista de categorias (.cat-item), e escolher uma opção clica no botão dela:
// a navegação continua a mesma do PC e da TV. Só é criado no celular (isPhone), então não pesa na TV.
import { h } from './util.js';

export const isPhone = () => !document.documentElement.classList.contains('tv-wide') && window.matchMedia('(max-width: 760px)').matches;

export function catSelect(catList) {
  const sel = h('select.input.cat-select', { 'aria-label': 'Categoria' });
  const sync = () => {
    const items = [...catList.querySelectorAll('.cat-item')];
    sel.replaceChildren(...items.map((b, i) => {
      const name = b.querySelector('.name');
      const n = b.querySelector('.n');
      return h('option', { value: String(i), selected: b.classList.contains('on') },
        `${name ? name.textContent : b.textContent}${n && n.textContent ? ` (${n.textContent})` : ''}`);
    }));
  };
  sel.addEventListener('change', () => {
    const b = catList.querySelectorAll('.cat-item')[Number(sel.value)];
    if (b) b.click();
  });
  // a lista é redesenhada ao trocar de categoria: o seletor acompanha
  new MutationObserver(sync).observe(catList, { childList: true });
  sync();
  return sel;
}
