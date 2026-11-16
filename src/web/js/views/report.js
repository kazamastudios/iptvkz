// "Relatar problema": abre a página de suporte do site já preenchida com o aparelho, a versão e o tipo do erro.
// O app não envia nada: quem envia é a pessoa, pelo formulário do site, depois de conferir e escrever o relato.
// Vão só dados técnicos (nada da lista: nem link, nem usuário, nem nomes). PC e celular: abre no navegador.
// TV (LG, Android TV): QR Code para terminar no celular.
import { h, ico, modal, toast, SITE, openSite, loadQrLib } from '../core/util.js';
import { S, buildLabel } from '../core/store.js';
import { TV, focusEl } from '../tv/tv.js';

// Os mesmos valores do campo "Em qual aparelho?" da página de suporte.
function device() {
  const ua = navigator.userAgent;
  if (window.webOSSystem || window.PalmSystem || /web0s|webos/i.test(ua)) return 'lg';
  if (window.IPTVKZAndroid) return TV.on ? 'atv' : 'android';
  if (/Electron\//.test(ua)) return /Windows/.test(ua) ? 'win' : /Macintosh|Mac OS X/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'outro';
  return 'browser';
}

function version() {
  const b = buildLabel();
  return [b.short.replace(/ · /g, ' '), b.dev ? 'Beta' : ''].filter(Boolean).join(' ').slice(0, 30);
}

// area, momento: valores do formulário do site; erro: código curto (ver public/js/suporte.js)
export function supportUrl({ area, momento, erro } = {}) {
  const q = new URLSearchParams({ de: 'app', tipo: 'erro', aparelho: device() });
  const v = S.build ? version() : '';
  if (v) q.set('versao', v);
  if (area) q.set('area', area);
  if (momento) q.set('momento', momento);
  if (erro) q.set('erro', erro);
  return `https://${SITE}/suporte.html?${q}`;
}

const NOTE = 'O app não envia nada sozinho: a página abre com o aparelho e a versão preenchidos, você conta o que aconteceu e decide se envia. Não escreva links, usuários ou senhas da lista.';

export async function reportProblem(info) {
  const url = supportUrl(info);
  if (!TV.on && openSite(url)) {
    toast('A página de suporte abriu no navegador.', 'ok');
    return;
  }
  // TV: QR Code e o endereço. Celular com o app antigo (sem como abrir o navegador): só o endereço, para digitar.
  const qrBox = TV.on ? h('div.report-qr') : null;
  const address = h('b', `${SITE}/`, h('wbr'), 'suporte.html');
  const m = modal('Relatar problema', h('div',
    h('div.report-box', qrBox,
      TV.on
        ? h('div', h('b', 'Escaneie com a câmera do celular'), h('p.muted', 'Ou abra no navegador: ', address))
        : h('div', h('b', 'Abra no navegador do aparelho:'), h('p', address))),
    h('p.faint.report-note', NOTE),
    h('div.row', { style: { justifyContent: 'flex-end', marginTop: '14px' } },
      h('button.btn.primary', { type: 'button', onclick: () => m.close() }, ico('check'), 'Pronto'))));
  if (!TV.on) return;
  focusEl(m.el.querySelector('.btn.primary'));
  try {
    await loadQrLib();
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    qrBox.append(h('img.pair-qr', { src: qr.createDataURL(5, 2), alt: 'QR Code da página de suporte' }));
  } catch {}
}

export const reportButton = (info, cls = '.btn') =>
  h('button' + cls, { type: 'button', onclick: () => reportProblem(info) }, ico(TV.on ? 'qr' : 'external'), 'Relatar problema');
