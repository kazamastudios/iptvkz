// Configurações → Personalização: cor de destaque e fundo (IPTVKZ+). Sem o IPTVKZ+, um item pago é só experimentado:
// aparece na hora e volta ao sair de Configurações (core/theme.js). PC: clique e hover; TV: setas e OK, com o mesmo
// destaque do hover no foco; celular: toque. Trocar o tema só troca variáveis do CSS: nada anima.
import { h, ico, confirmDialog } from '../core/util.js';
import { TV, focusEl } from '../tv/tv.js';
import { isBeta } from '../core/debug.js';
import { hasPlus } from '../core/premium.js';
import { ACCENTS, BACKGROUNDS, theme, currentTheme, savedTheme, setTheme, previewTheme, isPreviewing } from '../core/theme.js';

const PAID = 'As outras cores e os fundos Preto e Grafite fazem parte do IPTVKZ+, que chega em breve.';

// Android: o ícone do app na tela inicial também pode ter a cor do tema (um atalho por cor no manifesto). Trocar
// pode fechar o app e desfazer atalhos fixados, então é só quando a pessoa pede, com aviso. Usa a cor que vale
// (sem prévia): sem IPTVKZ+, só o padrão.
function iconCard(render) {
  const nat = window.IPTVKZAndroid;
  if (!nat || !nat.setLauncherIcon || !nat.launcherIcon) return null;
  let icon = 'red';
  try { icon = nat.launcherIcon() || 'red'; } catch {}
  const want = theme().accent;
  const name = (id) => (id === 'red' ? (isBeta() ? 'o padrão' : 'Vermelho') : (ACCENTS.find((a) => a.id === id) || {}).label);
  const change = async () => {
    const ok = await confirmDialog('Trocar o ícone do app?',
      `O ícone na tela inicial passa a ser ${name(want)}. O Android pode fechar o IPTVKZ na troca: é só abrir de novo. Se você fixou o app na tela inicial, talvez precise fixar outra vez.`,
      'Trocar ícone');
    if (!ok) return;
    try { nat.setLauncherIcon(want); } catch {}
    render('icon');
  };
  return h('div.pref',
    h('div.lbl', 'Ícone do app'),
    h('div.sub', `Na tela inicial do aparelho: ${name(icon)}.`),
    want === icon
      ? h('div.sub', 'Igual à cor de destaque.')
      : h('button.btn.small', { type: 'button', 'data-theme': 'icon', onclick: change }, ico('refresh'), `Usar ${name(want)} no ícone`));
}

export function personalizeSection() {
  const sec = h('div.set-section.personalize');

  const swatch = (part, item, plus, cur) => {
    const on = cur[part] === item.id;
    const locked = !item.free && !plus;
    // no Beta, o padrão é âmbar (a cor do Beta), não vermelho
    const beta = part === 'accent' && item.id === 'red' && isBeta();
    const label = beta ? 'Padrão' : item.label;
    const color = beta ? '#ffb547' : item.color;
    return h('button.swatch' + (part === 'bg' ? '.bg' : '') + (on ? '.on' : ''), {
      type: 'button',
      title: label + (item.note ? ` (${item.note})` : ''),
      'aria-label': label + (locked ? ', IPTVKZ+, experimentar' : ''),
      'aria-pressed': String(on),
      'data-theme': part + ':' + item.id,
      // texto, não objeto: Object.assign no style não aceita variáveis do CSS
      style: part === 'bg' ? `--sw: ${color}; --sw-card: ${item.card}` : `--sw: ${color}`,
      onclick: () => {
        if (locked) previewTheme(part, item.id); else setTheme(part, item.id);
        render(part + ':' + item.id);
      },
    },
    part === 'bg' ? h('span.sw-card') : null,
    part === 'bg' ? h('span.sw-name', label) : null,
    on ? ico('check', 'sw-check') : null,
    locked ? h('span.sw-lock', ico('lock')) : null);
  };

  function render(refocus) {
    const plus = hasPlus();
    const cur = currentTheme();
    const saved = savedTheme();
    // um pago escolhido antes (no Beta, por exemplo) e agora sem IPTVKZ+: avisa por que não está valendo
    const dropped = !plus && !isPreviewing() && (cur.accent !== saved.accent || cur.bg !== saved.bg);
    let note;
    if (plus) note = isBeta() ? 'Beta: todos os temas liberados para teste.' : 'Obrigado por apoiar o IPTVKZ!';
    else if (isPreviewing()) note = `Prévia: o tema volta ao sair de Configurações. ${PAID}`;
    else if (dropped) note = `O tema escolhido antes é do IPTVKZ+ e não está valendo agora. ${PAID}`;
    else note = `${PAID} Escolha um para experimentar.`;
    sec.replaceChildren(
      h('h3', 'Personalização ', h('span.plus-tag', 'IPTVKZ+')),
      h('p', 'Cor e fundo do app. Vale só neste aparelho.'),
      h('div.pref-grid',
        h('div.pref', h('div.lbl', 'Cor de destaque'), h('div.sub', 'Botões, seleção e o foco do controle.'),
          h('div.swatches', { role: 'group', 'aria-label': 'Cor de destaque' }, ...ACCENTS.map((a) => swatch('accent', a, plus, cur)))),
        h('div.pref', h('div.lbl', 'Fundo'), h('div.sub', 'Preto é bom para telas OLED.'),
          h('div.swatches', { role: 'group', 'aria-label': 'Fundo' }, ...BACKGROUNDS.map((b) => swatch('bg', b, plus, cur)))),
        iconCard(render)),
      h('p.faint.plus-note' + (plus ? '' : '.locked'), { role: 'status' }, plus ? null : ico('lock'), note));
    if (refocus) {
      // o botão do ícone some depois da troca: o foco do controle vai para a cor escolhida
      const el = sec.querySelector(`[data-theme="${refocus}"]`) || sec.querySelector('.swatch.on');
      if (el) TV.on ? focusEl(el) : el.focus({ preventScroll: true });
    }
  }

  render();
  // "Simular sem IPTVKZ+" (Beta) ou, na fase 2, a compra: redesenha com o que vale agora
  const onPlus = () => { if (!sec.isConnected) return window.removeEventListener('iptvkz:plus', onPlus); render(); };
  window.addEventListener('iptvkz:plus', onPlus);
  return sec;
}
