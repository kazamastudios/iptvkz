// "Assistir na TV" fora do player (página do filme ou da série): escolhe uma TV da rede e manda o vídeo direto para
// ela. A TV busca o vídeo no provedor e toca sozinha; este aparelho pode até fechar o app. Na TV (LG, Android TV)
// o botão não aparece: não faz sentido mandar de uma TV para outra.
import { h, ico, modal, toast } from '../core/util.js';
import { api } from '../core/store.js';
import { TV } from '../tv/tv.js';

// Desligado (12/11/2026): pelo Cast e pelo DLNA a TV abre o player padrão dela, não o IPTVKZ. Volta quando o
// celular puder mandar o vídeo para o próprio IPTVKZ da TV. Com false, nenhum botão "Assistir na TV" aparece.
export const CAST_ENABLED = false;

// media: () => { url, title, live, startAt } (calculado na hora do clique: progresso e versão podem ter mudado)
export function castButton(media) {
  if (!CAST_ENABLED || TV.on) return null;
  return h('button.btn', { title: 'Mandar para uma TV da rede', onclick: () => openCastPicker(media()) }, ico('cast'), 'Assistir na TV');
}

export function openCastPicker(media) {
  const box = h('div.cast-pick');
  const m = modal('Assistir na TV', box);
  const send = async (dev) => {
    m.close();
    toast(`Abrindo na TV ${dev.name}...`, 'info', 2500);
    try {
      await api('/api/cast/play', { method: 'POST', body: JSON.stringify({ id: dev.id, url: media.url, title: media.title, live: !!media.live, startAt: media.startAt || 0 }) });
      toast(`Tocando na TV ${dev.name}. Pode fechar o app.`, 'ok', 5000);
    } catch (err) {
      toast(`Não deu para tocar na TV: ${err.message}`, 'error');
    }
  };
  const load = async (fresh) => {
    box.replaceChildren(h('div.row', { style: { gap: '10px' } }, h('div.spinner.small'), h('span.muted', 'Procurando TVs na rede...')));
    let list = [];
    try { list = await api(`/api/cast/devices${fresh ? '?fresh=1' : ''}`); } catch {}
    if (!box.isConnected) return;
    const again = h('button.btn.ghost', { type: 'button', onclick: () => load(true) }, ico('refresh'), 'Procurar de novo');
    box.replaceChildren(
      ...(list.length
        ? list.map((d) => h('button.btn.cast-dev', { type: 'button', onclick: () => send(d) }, ico('tv'),
          h('span', d.name + (d.model && d.model !== d.name ? ` (${d.model})` : ''))))
        : [h('p.muted', 'Nenhuma TV encontrada. Ela precisa estar ligada e no mesmo Wi-Fi. Funciona com Android TV, Google TV, Chromecast e TVs com DLNA (LG, Samsung e outras).')]),
      again);
  };
  load(false);
}
