// Teclado na tela para o modo TV: funciona com setas/OK, ponteiro e números do controle,
// sem depender do teclado do sistema (que nem toda TV abre para páginas da web).
import { h, isBack } from '../core/util.js';
import { TV, move, DIRS, focusEl, lockInput, hasNativeKeyboard, startNativeInput, endNativeInput, nativeKeyboardOpen } from './tv.js';

const TEXT_TYPES = /^(text|search|url|email|password|tel|number)$/;
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm._@', ':/?&=+#%~!'];

let active = null; // { input, root, setValue, close }

export function isTextInput(el) {
  return !!el && el.tagName === 'INPUT' && !el.dataset.native && TEXT_TYPES.test(el.type) && (!el.readOnly || !!el.dataset.tvlock) && !el.disabled;
}

export function isKeyboardOpen() {
  return !!active;
}

function dirOf(e) {
  return DIRS[e.key] || { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[e.keyCode];
}

export function openKeyboard(input) {
  if (!TV.on || !isTextInput(input)) return;
  if (active) active.close(false);

  input.setAttribute('inputmode', 'none');
  const numeric = input.classList.contains('pin-input');
  const isPassword = input.type === 'password';
  let upper = false;
  let reveal = false;
  let value = input.value;

  const field = input.closest('.field');
  const labelEl = field && field.querySelector('label');
  const title = (labelEl && labelEl.textContent) || input.getAttribute('aria-label') || (input.placeholder || 'Digite').replace(/\s*\(\s*\/\s*\)\s*$/, '');
  const shown = h('div.tvkb-value');
  const paint = () => {
    shown.textContent = isPassword && !reveal ? '•'.repeat(value.length) : value;
    shown.classList.toggle('empty', !value);
  };

  const apply = (next) => {
    if (input.maxLength >= 0) next = next.slice(0, input.maxLength);
    value = next;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    value = input.value; // o campo pode ter filtrado o texto
    paint();
    // o PIN se confirma sozinho no 4º dígito e fecha o diálogo
    if (active && input.closest('.modal-back:not(.show)')) close(false);
  };
  const type = (ch) => apply(value + (upper ? ch.toUpperCase() : ch));
  const erase = () => apply(value.slice(0, -1));

  const finish = () => {
    if (numeric && input.form) {
      if (input.form.requestSubmit) input.form.requestSubmit();
      else input.form.querySelector('[type=submit]').click();
      value = input.value;
      paint();
      if (input.closest('.modal-back:not(.show)')) close(false);
      return;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  };

  const key = (label, fn, cls = '') => h('button.tvkb-key' + (cls ? '.' + cls : ''), { type: 'button', onclick: fn }, label);
  const grid = h('div.tvkb-grid' + (numeric ? '.numeric' : ''));
  let shiftBtn = null;
  const letters = [];

  if (numeric) {
    for (const d of '123456789') grid.append(key(d, () => type(d)));
    grid.append(key('Apagar', erase), key('0', () => type('0')), key('OK', finish, 'ok'));
  } else {
    for (const row of ROWS) {
      for (const ch of row) {
        const b = key(ch, () => type(ch));
        if (/[a-z]/.test(ch)) letters.push(b);
        grid.append(b);
      }
    }
    const refreshCase = () => {
      for (const b of letters) b.textContent = upper ? b.textContent.toUpperCase() : b.textContent.toLowerCase();
      shiftBtn.classList.toggle('on', upper);
    };
    shiftBtn = key('Maiúsc.', () => { upper = !upper; refreshCase(); }, 'w2');
    grid.append(
      shiftBtn,
      key('Espaço', () => apply(value + ' '), isPassword ? 'w2' : 'w3'),
      isPassword ? key('Mostrar', (e) => { reveal = !reveal; e.currentTarget.textContent = reveal ? 'Ocultar' : 'Mostrar'; paint(); }) : null,
      key('Apagar', erase, 'w2'),
      key('Limpar', () => apply('')),
      key('OK', finish, 'ok w2'),
    );
  }

  const root = h('div.tvkb', h('div.tvkb-panel',
    h('div.tvkb-head', h('span.tvkb-title', title), h('span.tvkb-hint', 'Voltar fecha o teclado')),
    shown,
    grid));
  document.getElementById('overlayRoot').append(root);
  paint();

  function close(refocus) {
    if (!active || active.root !== root) return;
    active = null;
    root.remove();
    if (refocus && document.contains(input)) input.focus({ preventScroll: true });
  }

  active = { input, root, close, type, erase, finish };
  focusEl(grid.querySelector(numeric ? '.tvkb-key' : '.tvkb-key:nth-child(11)'));
}

// O que entra no campo se soma ao que já está nele: sem limpar, a nova busca vira "antiga nova" e não acha nada.
function newSearch(input) {
  if (input.id === 'globalSearch') input.value = '';
}

// Texto que entra com o teclado escondido veio do ditado: a TV esconde o teclado enquanto escuta a voz.
// Ao confirmar o ditado, a busca já roda; então fecha o teclado e leva o foco para os resultados.
let dictated = null;
let dictationTimer = 0;
function onInput(e) {
  const el = e.target;
  if (!TV.on || !el || !el.dataset || !el.dataset.native || nativeKeyboardOpen() || !el.value.trim()) return;
  dictated = el;
  clearTimeout(dictationTimer);
  dictationTimer = setTimeout(() => {
    if (dictated === el && document.activeElement === el) finishDictation(el);
  }, 500);
}
function finishDictation(input) {
  dictated = null;
  clearTimeout(dictationTimer);
  finishNative(input);
}

// De preferência o teclado do aparelho; o do app fica para o PIN e para quando o nativo não abrir.
function openEntry(input) {
  dictated = null;
  newSearch(input);
  if (hasNativeKeyboard() && !input.classList.contains('pin-input')) startNativeInput(input, openKeyboard);
  else openKeyboard(input);
}

// Fecha o teclado da TV (sai do campo) e avisa quem usa o campo; a busca decide para onde vai o foco.
function finishNative(input) {
  endNativeInput();
  input.blur();
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const untouched = input.dispatchEvent(new Event('tvsubmit', { cancelable: true }));
  if (untouched) focusEl(input);
}

function onKey(e) {
  if (!TV.on) return;
  if (!active) {
    const el = document.activeElement;
    const enter = e.key === 'Enter' || e.keyCode === 13;
    if (el && el.dataset && el.dataset.native) {
      // Teclado da TV aberto: as teclas são dele. Enter com texto digitado é "terminei".
      if (nativeKeyboardOpen()) {
        e.stopPropagation();
        if (enter && el.value.trim()) {
          e.preventDefault();
          finishNative(el);
        }
        return;
      }
      // Fechado: OK logo depois do ditado confirma a busca; fora isso, OK abre de novo
      // e qualquer outra tecla volta a navegar.
      if (enter) {
        e.preventDefault();
        e.stopPropagation();
        if (dictated === el && el.value.trim()) {
          finishDictation(el);
          return;
        }
        dictated = null;
        newSearch(el);
        startNativeInput(el, openKeyboard);
      } else endNativeInput();
      return;
    }
    if (!enter) return;
    // OK em cima de um campo de texto abre o teclado
    if (isTextInput(el)) {
      e.preventDefault();
      e.stopPropagation();
      openEntry(el);
    }
    return;
  }
  // Com o teclado aberto, nada chega ao resto do app.
  e.stopPropagation();
  e.preventDefault();
  const dir = dirOf(e);
  if (isBack(e)) active.close(true);
  else if (dir) move(dir);
  else if (e.key === 'Enter' || e.keyCode === 13) {
    if (document.activeElement && document.activeElement.classList.contains('tvkb-key')) document.activeElement.click();
  } else if (e.key === 'Backspace') active.erase();
  else if (e.key && e.key.length === 1) active.type(e.key);
  else if (e.keyCode >= 48 && e.keyCode <= 57) active.type(String(e.keyCode - 48)); // números do controle
}

export function initTvKeyboard() {
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('input', onInput, true);
  // Ponteiro do Magic Remote em um campo de texto
  document.addEventListener('click', (e) => {
    if (TV.on && isTextInput(e.target)) openEntry(e.target);
  }, true);
  // Evita abrir o teclado do sistema por cima do nosso
  document.addEventListener('mousedown', (e) => lockInput(e.target), true);
  document.addEventListener('focusin', (e) => {
    lockInput(e.target);
    if (TV.on && isTextInput(e.target) && e.target.getAttribute('inputmode') !== 'none') e.target.setAttribute('inputmode', 'none');
  }, true);
}
