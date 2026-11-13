// "Instalar na TV": passo a passo para levar o app à TV, aberto do PC ou do celular. As TVs não aceitam
// instalação mandada pela rede; é a TV que busca o app. Android TV/Fire TV/TV Box: pelo app Downloader, que
// aceita digitar um endereço (o site redireciona /apk para o APK da última versão, ver public/_worker.js).
import { h, ico, modal } from '../core/util.js';

const SITE = 'iptvkz.kazamastudios.com.br';
const SHORT = `${SITE}/apk`;

const TVS = {
  android: {
    label: 'Android TV, Google TV, Fire TV, TV Box',
    body: () => [
      h('ol.install-steps',
        h('li', h('b', 'Instale o app Downloader'), ' pela loja da TV (Google Play na Android TV, Appstore na Fire TV). É gratuito.'),
        h('li', h('b', 'Abra o Downloader e digite o endereço:'), h('div.install-url', SHORT)),
        h('li', h('b', 'Permita a instalação'), ': na primeira vez, a TV pede para liberar o Downloader a instalar apps. Libere e confirme “Instalar”.'),
        h('li', 'Abra o ', h('b', 'IPTVKZ'), ' na lista de apps da TV e adicione a sua lista (pelo QR Code fica mais fácil).')),
      h('p.faint', 'O endereço baixa sempre a última versão oficial. Depois de instalado, o app se atualiza sozinho.'),
    ],
  },
  lg: {
    label: 'TV LG (webOS)',
    body: () => [
      h('p', 'Na LG, os apps só entram pela ', h('b', 'LG Content Store'), '. O IPTVKZ está em análise na loja e aparece lá assim que for aprovado: é só procurar por “IPTVKZ”.'),
      h('p.faint', `Quem já usa o Modo Desenvolvedor da LG pode instalar o arquivo .ipk, que fica em ${SITE}.`),
    ],
  },
  other: {
    label: 'Samsung e outras',
    body: () => [
      h('p', 'Ainda não há app do IPTVKZ para essas TVs.'),
      h('p', 'Duas saídas: uma ', h('b', 'TV Box Android'), ' ou um Fire TV Stick ligado na TV (aí vale o passo a passo de Android TV), ou abrir o IPTVKZ pelo navegador da TV com este computador ligado (opção “Permitir acesso pela rede de casa”, acima).'),
    ],
  },
};

export function openInstallTv() {
  let current = 'android';
  const tabs = h('div.seg.install-tabs');
  const body = h('div.install-body');
  const render = () => {
    tabs.replaceChildren(...Object.entries(TVS).map(([k, t]) =>
      h('button' + (k === current ? '.on' : ''), { type: 'button', onclick: () => { current = k; render(); } }, t.label)));
    body.replaceChildren(...TVS[current].body());
  };
  render();
  modal('Instalar o IPTVKZ na TV', h('div', h('p.muted', 'Escolha o tipo da sua TV:'), tabs, body), { wide: true });
}

export const installTvButton = () => h('button.btn', { type: 'button', onclick: openInstallTv }, ico('tv'), 'Instalar na TV');
