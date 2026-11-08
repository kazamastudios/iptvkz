// Diálogo de PIN (4 dígitos). Funciona com teclado, teclado numérico do controle e mouse.
import { h, modal } from '../util.js';
import { TV, focusEl } from '../tv.js';

/**
 * opts: { title, text, confirm: pedir duas vezes, check: (pin) => boolean }
 * Resolve com o PIN digitado ou null (cancelado).
 */
export function pinDialog({ title, text, confirm = false, check = null }) {
  return new Promise((resolve) => {
    let done = false;
    let first = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const msg = h('p.muted', { style: { marginTop: 0 } }, text);
    const err = h('div.error-box.hidden');
    const input = h('input.pin-input', {
      type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', 'aria-label': 'PIN',
    });
    const ok = h('button.btn.primary', { type: 'submit' }, 'Confirmar');
    const form = h('form', msg, err, h('div', { style: { display: 'flex', justifyContent: 'center', margin: '8px 0 18px' } }, input),
      h('div.form-actions', h('button.btn.ghost', { type: 'button', onclick: () => finish(null) }, 'Cancelar'), ok));
    const showErr = (t) => { err.textContent = t; err.classList.toggle('hidden', !t); };
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value.length === 4 && !confirm) form.requestSubmit ? form.requestSubmit() : ok.click();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = input.value;
      if (!/^\d{4}$/.test(pin)) return showErr('O PIN tem 4 números.');
      if (check && !check(pin)) {
        input.value = '';
        return showErr('PIN incorreto.');
      }
      if (confirm && first == null) {
        first = pin;
        input.value = '';
        showErr('');
        msg.textContent = 'Digite o mesmo PIN de novo para confirmar.';
        input.focus();
        return;
      }
      if (confirm && pin !== first) {
        first = null;
        input.value = '';
        msg.textContent = text;
        return showErr('Os PINs não batem. Comece de novo.');
      }
      finish(pin);
    });
    const m = modal(title, form, { onClose: () => finish(null) });
    setTimeout(() => (TV.on ? focusEl(input) : input.focus()), 60);
  });
}
