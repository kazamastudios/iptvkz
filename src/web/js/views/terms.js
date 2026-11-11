// Termos de uso: aceite obrigatório na primeira vez (e quando a versão dos termos mudar).
import { h, ico, modal } from '../core/util.js';
import { S, setSetting, saveNow } from '../core/store.js';
import { focusEl, TV } from '../tv/tv.js';

export const TERMS_VERSION = 4;

// Termos e política completos no site. Na TV não há navegador à mão: mostra só o endereço para ler no celular.
const SITE = 'iptvkz.kazamastudios.com.br';
function siteLinks() {
  const style = { margin: '0 0 4px', fontSize: '13px' };
  if (TV.on) return h('p.muted', { style }, `Termos e política de privacidade completos em ${SITE}`);
  const link = (page, label) => h('a', { href: `https://${SITE}/${page}`, target: '_blank', rel: 'noopener' }, label);
  return h('p.muted', { style }, 'Versão completa no site: ', link('termos.html', 'Termos de uso'), ' · ', link('privacidade.html', 'Política de privacidade'));
}

let cache = null;
async function termsText() {
  if (!cache) {
    const res = await fetch('/termos.txt', { cache: 'no-cache' });
    cache = (await res.text()).replace(/^﻿/, '');
  }
  return cache;
}

// Títulos ("1. O QUE É...") viram <h4>; o resto, parágrafos.
function renderTerms(text) {
  const box = h('div.terms', { tabindex: '0', 'data-focus': '' });
  const lines = text.split(/\r?\n/);
  box.append(h('h3', lines.shift()));
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d+\.\s+[A-ZÀ-Ú ,]+$/.test(t)) box.append(h('h4', t));
    else if (/^Versão \d/.test(t)) box.append(h('p.faint', t));
    else box.append(h('p', t));
  }
  return box;
}

export function termsAccepted() {
  return Number(S.settings.termsAccepted || 0) >= TERMS_VERSION;
}

// Resolve quando o usuário aceitar. Sem aceite, o app não continua.
export async function ensureTerms() {
  if (termsAccepted()) return;
  const text = await termsText();
  return new Promise((resolve) => {
    const body = h('div');
    const accept = h('button.btn.primary', {
      onclick: async () => {
        accept.disabled = true;
        setSetting('termsAccepted', TERMS_VERSION);
        setSetting('termsAcceptedAt', Date.now());
        await saveNow('settings').catch(() => {});
        m.close();
        resolve();
      },
    }, ico('check'), 'Li e aceito');
    const showTerms = () => {
      body.replaceChildren(
        h('p.muted', { style: { marginTop: 0 } }, 'Antes de começar, leia e aceite os termos de uso.'),
        renderTerms(text),
        siteLinks(),
        h('div.form-actions', h('button.btn.ghost', { onclick: refuse }, 'Recusar'), accept));
      if (TV.on) setTimeout(() => focusEl(accept), 50);
    };
    const refuse = () => {
      body.replaceChildren(
        h('div.center-state', { style: { height: 'auto', padding: '30px 10px' } },
          ico('alert'),
          h('h2', { style: { fontSize: '20px' } }, 'É preciso aceitar os termos'),
          h('p', 'O IPTVKZ só pode ser usado por quem concorda com os termos de uso. Você pode lê-los de novo e decidir.'),
          h('button.btn', { onclick: showTerms }, 'Ler os termos de novo')));
      if (TV.on) setTimeout(() => focusEl(body.querySelector('button')), 50);
    };
    const m = modal('Termos de uso', body, { wide: true, locked: true });
    showTerms();
  });
}

export async function showTermsDialog() {
  const text = await termsText();
  const when = S.settings.termsAcceptedAt ? new Date(S.settings.termsAcceptedAt).toLocaleDateString('pt-BR') : null;
  modal('Termos de uso', [
    renderTerms(text),
    siteLinks(),
    when ? h('p.faint', { style: { margin: '12px 0 0', fontSize: '12px' } }, `Aceitos em ${when}.`) : null,
  ], { wide: true });
}
