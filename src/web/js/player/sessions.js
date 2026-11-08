// Limite de telas da conta: antes de tocar, pergunta o que fazer se a conta já estiver em uso.
import { h, ico, modal } from '../core/util.js';
import { api, C, S } from '../core/store.js';
import { TV, focusEl } from '../tv/tv.js';

const KEY = 'iptvkz.device';

export function deviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'sem-id';
  }
}

// Nome o mais claro possível; o que o navegador não revela fica genérico.
export function nameFromUA(ua, host, tv) {
  if (/web0s|webos/i.test(ua)) return 'TV LG';
  if (/tizen|samsungbrowser.*tv|smarttv.*samsung/i.test(ua)) return 'TV Samsung';
  if (/aft[a-z]|silk/i.test(ua)) return 'Fire TV';
  if (/android.*tv|googletv|bravia|crkey/i.test(ua)) return 'Android TV';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  const android = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i);
  if (android) return android[1].trim() && android[1].trim() !== 'K' ? `Celular ${android[1].trim()}` : 'Celular Android';
  if (/android/i.test(ua)) return 'Celular Android';
  if (tv) return 'TV';
  if (host) return `Computador ${host}`;
  if (/macintosh/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'PC Windows';
  if (/linux/i.test(ua)) return 'PC Linux';
  return 'outro aparelho';
}

export function deviceName() {
  return nameFromUA(navigator.userAgent, S.host, TV.on);
}

const body = (extra) => JSON.stringify({ device: deviceId(), name: deviceName(), list: C()?.listId, ...extra });

export function heartbeat(title) {
  return api('/api/sessions/heartbeat', { method: 'POST', body: body({ title }) });
}

export function endScreen() {
  api('/api/sessions/end', { method: 'POST', body: body({}) }).catch(() => {});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Pede para a outra tela parar e espera ela soltar a conexão.
async function replaceScreen(target) {
  await api('/api/sessions/stop', { method: 'POST', body: body({ target }) });
  for (let i = 0; i < 14; i++) {
    await wait(500);
    const r = await api(`/api/sessions/gone?target=${encodeURIComponent(target)}`).catch(() => ({ gone: true }));
    if (r.gone) return;
  }
}

function label(s) {
  return s.title ? `${s.name} · ${s.title}` : s.name;
}

// true = pode tocar aqui; false = o usuário cancelou.
export async function claimScreen() {
  let info;
  try {
    info = await api(`/api/sessions?list=${encodeURIComponent(C().listId)}&device=${encodeURIComponent(deviceId())}`);
  } catch {
    return true; // sem resposta, não atrapalha quem quer assistir
  }
  const { others, maxCons } = info;
  if (!maxCons || others.length < maxCons) return true;

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const choose = async (s, box) => {
      box.replaceChildren(h('div.row', h('div.spinner.small'), h('span.muted', `Parando em ${s.name}…`)));
      await replaceScreen(s.device).catch(() => {});
      finish(true);
    };
    const box = h('div');
    if (others.length === 1) {
      const s = others[0];
      box.append(
        h('p.muted', { style: { marginTop: 0 } }, s.title ? `Tocando agora: ${s.title}.` : 'Tem algo tocando por lá.', ' Sua conta permite 1 tela por vez.'.replace('1 tela', `${maxCons} ${maxCons === 1 ? 'tela' : 'telas'}`)),
        h('div.form-actions',
          h('button.btn.ghost', { onclick: () => finish(false) }, `Deixar em ${s.name}`),
          h('button.btn.primary', { onclick: () => choose(s, box) }, ico('play'), 'Continuar aqui')));
    } else {
      box.append(
        h('p.muted', { style: { marginTop: 0 } }, `Sua conta permite ${maxCons} telas e todas estão em uso. Escolha qual substituir:`),
        h('div.screen-list', others.map((s) => h('button.screen-opt', { onclick: () => choose(s, box) }, ico('tv'), h('span', label(s))))),
        h('div.form-actions', h('button.btn.ghost', { onclick: () => finish(false) }, 'Cancelar')));
    }
    const title = others.length === 1 ? `Parece que você está assistindo em ${others[0].name}. Deseja continuar aqui?` : 'Todas as telas estão em uso';
    const m = modal(title, box, { onClose: () => finish(false) });
    if (TV.on) setTimeout(() => focusEl(box.querySelector('.btn.primary, .screen-opt')), 60);
  });
}
