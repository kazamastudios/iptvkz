// Configurações: listas, categorias (ocultar/ordenar), reprodução e sobre.
import { h, ico, fmtAgo, confirmDialog, toast, modal } from '../core/util.js';
import { installTvButton } from './installtv.js';
import { isBeta, debugOn, setDebug } from '../core/debug.js';
import {
  S, C, activeList, orderedCats, setCatHidden, setCatOrder, resetCats, setSetting, saveNow, api,
  parentalEnabled, adultLocked, pinHash, checkPin, unlockAdult, lockAdult, setCatAdult, adultCatCount, buildLabel,
} from '../core/store.js';
import { pinDialog } from './pin.js';
import { TV, setTvMode, exitApp, focusEl } from '../tv/tv.js';
import { showTermsDialog } from './terms.js';
import { openListSave, downloadList, openServers, canPhoneEdit } from './lists.js';

const TYPE = { xtream: 'Xtream Codes', url: 'Link M3U', file: 'Arquivo M3U' };

function listType(l) {
  return l.type === 'xtream' ? 'xtream' : l.source === 'file' ? 'file' : 'url';
}

function host(l) {
  const raw = l.type === 'xtream' ? l.server : l.url;
  if (!raw) return ''; // lista de arquivo: não tem endereço
  try { return new URL(/^https?:/.test(raw) ? raw : 'http://' + raw).host; } catch { return ''; }
}

export function settingsView(params, ctx) {
  ctx.setTitle('Configurações');
  const page = h('div.page.settings');

  // ---------- listas ----------
  const cards = h('div.list-cards');
  const act = activeList();
  // a lista em uso sempre primeiro (à esquerda)
  for (const l of [...S.lists].sort((x, y) => (act && y.id === act.id) - (act && x.id === act.id))) {
    const isActive = act && l.id === act.id;
    const t = listType(l);
    const stats = h('div.stats');
    if (isActive && C()) {
      const c = C();
      stats.append(
        h('span', `${c.live.items.length.toLocaleString('pt-BR')} canais`),
        h('span', `${c.movies.items.length.toLocaleString('pt-BR')} filmes`),
        h('span', `${c.series.items.length.toLocaleString('pt-BR')} séries`),
      );
    }
    cards.append(h('div.list-card' + (isActive ? '.active' : ''),
      h('div.top', ico(t === 'xtream' ? 'server' : t === 'file' ? 'file' : 'link'),
        h('div', { style: { minWidth: 0, flex: 1 } }, h('div.nm', l.name), h('div.ty', [TYPE[t], host(l)].filter(Boolean).join(' · '))),
        isActive ? h('span.badge.onair', 'EM USO') : null),
      stats,
      isActive && C() ? h('div.faint', { style: { fontSize: '12px' } }, `Atualizada ${fmtAgo(C().updatedAt)}`) : null,
      h('div.acts',
        !isActive ? h('button.btn.small.primary', { onclick: () => ctx.useList(l.id) }, 'Usar esta') : null,
        h('button.btn.small', { onclick: () => ctx.refreshList(l.id) }, ico('refresh'), 'Atualizar'),
        h('button.btn.small', { onclick: () => ctx.editList(l) }, ico('edit'), 'Editar'),
        // o resto num menu: o cartão fica com poucos botões (no PC, na TV e no celular)
        h('button.btn.small', { title: 'Mais opções desta lista', onclick: () => listMenu(l) }, ico('more'), 'Mais'))));
  }
  // Mais opções de uma lista: janela com uma opção por linha (funciona igual com mouse, controle e toque)
  function listMenu(l) {
    const isXt = listType(l) === 'xtream';
    let m;
    const item = (icon, label, hint, fn, danger) => h('button.btn.menu-opt' + (danger ? '.danger' : ''), { type: 'button', onclick: () => { m.close(); fn(); } },
      ico(icon), h('span', h('b', label), hint ? h('small', hint) : null));
    m = modal(l.name, h('div.list-opts',
      isXt ? item('server', 'Servidores', 'Testar e trocar o endereço do provedor', () => openServers(l, (nl) => ctx.refreshList(nl.id))) : null,
      canPhoneEdit() ? item('qr', 'Editar pelo celular', 'QR Code para mudar a lista no celular', () => ctx.phoneEdit(l)) : null,
      item('download', 'Baixar lista', TV.on ? 'Leva a lista para outro aparelho pelo celular' : 'Arquivo para usar em outro aparelho', () => (TV.on ? openListSave(l) : downloadList(l))),
      item('trash', 'Excluir lista', 'Apaga também favoritos e progresso dela', async () => {
        if (await confirmDialog('Excluir lista', `Excluir “${l.name}”? Favoritos e progresso dessa lista também serão apagados.`, 'Excluir', true)) ctx.deleteList(l.id);
      }, true)));
    setTimeout(() => focusEl(m.el ? m.el.querySelector('.menu-opt') : document.querySelector('.modal .menu-opt')), 50);
  }

  // até 2 listas: bloco à direita delas; com 3 ou mais, uma linha própria embaixo
  cards.append(h('button.list-card.add-card' + (S.lists.length >= 3 ? '.add-row' : ''), { onclick: () => ctx.addList() }, ico('plus'), 'Adicionar lista'));
  // sem nenhuma lista não há o que trocar: a dica é adicionar
  const listHint = !S.lists.length ? 'Nenhuma lista ainda. Adicione a sua para começar.'
    : TV.on || !matchMedia('(max-width: 760px)').matches ? 'Troque de lista pelo seletor no topo da barra lateral.' : 'Troque de lista pelo último botão da barra de baixo, o que mostra o nome da lista.';
  page.append(h('div.set-section', h('h3', 'Listas'), h('p', listHint), cards));

  // ---------- categorias ----------
  if (C()) {
    let section = 'live';
    const editor = h('div.cat-editor');
    const tabs = h('div.tabs');
    const names = { live: 'TV ao Vivo', movies: 'Filmes', series: 'Séries' };
    const renderTabs = () => tabs.replaceChildren(...Object.entries(names).map(([k, n]) =>
      h('button' + (k === section ? '.on' : ''), { onclick: () => { section = k; renderTabs(); renderEditor(); } }, n)));
    let dragId = null;

    function renderEditor() {
      const cats = orderedCats(section);
      editor.replaceChildren();
      if (!cats.length) {
        editor.append(h('div.empty', 'Nenhuma categoria nesta seção.'));
        return;
      }
      for (const c of cats) {
        const row = h('div.cat-row' + (c.hidden ? '.off' : ''), { draggable: 'true' },
          h('span.grip', { title: 'Arraste para reordenar' }, ico('grip')),
          h('span.nm', c.name), h('span.n', String(c.count)),
          adultLocked() ? null : h('button.adult-tag' + (c.adult ? '.on' : ''), {
            title: c.adult ? 'Marcada como adulta (clique para desmarcar)' : 'Marcar como conteúdo adulto',
            onclick: () => { setCatAdult(section, c.id, !c.adult); renderEditor(); ctx.refreshNav(); },
          }, '18+'),
          h('button.icon-btn', { title: 'Subir', onclick: () => move(c.id, -1) }, ico('up')),
          h('button.icon-btn', { title: 'Descer', onclick: () => move(c.id, 1) }, ico('down')),
          h('button.icon-btn', {
            title: c.hidden ? 'Mostrar' : 'Ocultar',
            onclick: () => { setCatHidden(section, c.id, !c.hidden); renderEditor(); ctx.refreshNav(); },
          }, ico(c.hidden ? 'eyeOff' : 'eye')));
        row.addEventListener('dragstart', () => { dragId = c.id; row.classList.add('drag'); });
        row.addEventListener('dragend', () => { row.classList.remove('drag'); dragId = null; });
        row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
        row.addEventListener('dragleave', () => row.classList.remove('over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('over');
          if (!dragId || dragId === c.id) return;
          const ids = orderedCats(section).map((x) => x.id).filter((id) => id !== dragId);
          ids.splice(ids.indexOf(c.id), 0, dragId);
          setCatOrder(section, ids);
          renderEditor();
        });
        editor.append(row);
      }
    }
    function move(id, d) {
      const ids = orderedCats(section).map((x) => x.id);
      const i = ids.indexOf(id);
      const j = i + d;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      setCatOrder(section, ids);
      renderEditor();
    }
    renderTabs();
    renderEditor();
    page.append(h('div.set-section',
      h('h3', 'Categorias'),
      h('p', `Oculte o que você não assiste e arraste para mudar a ordem. Vale só para “${act ? act.name : ''}”.`),
      tabs,
      editor,
      h('div.row', { style: { marginTop: '10px' } },
        h('button.btn.small', { onclick: () => { resetCats(section); renderEditor(); ctx.refreshNav(); } }, ico('refresh'), 'Mostrar todas e restaurar ordem'))));
  }

  // ---------- TV e outros aparelhos ----------
  const sw = (checked, onchange, label) => {
    const input = h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked, e.target) });
    return h('label.switch', input, h('span.tr'), h('span', label));
  };
  const tvBody = h('div.pref-grid');
  const tvSec = h('div.set-section',
    h('h3', 'TV e outros aparelhos'),
    h('p', 'Assista na TV pelo navegador dela. Este computador funciona como servidor e precisa ficar ligado.'),
    tvBody);
  page.append(tvSec);

  function renderTv(info) {
    // redesenhar não pode tirar o foco do controle remoto da opção que acabou de mudar
    const focused = TV.on ? [...tvBody.querySelectorAll('.switch')].indexOf(document.activeElement) : -1;
    if (focused >= 0) setTimeout(() => focusEl(tvBody.querySelectorAll('.switch')[focused]), 0);
    tvBody.replaceChildren();
    if (info.local) {
      const lan = !!S.settings.lanAccess;
      const addrs = info.addresses.filter((a) => !a.virtual);
      const list = addrs.length ? addrs : info.addresses;
      tvBody.append(h('div.pref',
        h('div.lbl', 'Permitir acesso pela rede de casa'),
        h('div.sub', 'Só aparelhos da sua rede (TV, celular). Com isso ligado, o servidor não desliga sozinho.'),
        sw(lan, async (on) => {
          setSetting('lanAccess', on);
          await saveNow('settings').catch(() => {});
          renderTv(await api('/api/info'));
        }, lan ? 'Ligado' : 'Desligado')));
      if (lan) {
        tvBody.append(h('div.pref', { style: { gridColumn: 'span 2' } },
          h('div.lbl', 'Na TV, abra o navegador e digite:'),
          list.length
            ? list.map((a) => h('div', { style: { font: '700 26px var(--font-display)', color: 'var(--accent)', letterSpacing: '.3px' } },
              `${a.address}:${info.port}`, a.virtual ? h('span.faint', { style: { fontSize: '13px', fontWeight: 400 } }, `  (${a.name})`) : null))
            : h('div.muted', 'Não encontrei este computador na rede. Ele está conectado ao Wi-Fi ou cabo?'),
          h('div.sub', 'Depois, salve nos favoritos do navegador da TV. Se o Windows perguntar se o Node.js pode acessar a rede, permita em “Redes privadas”.'),
          h('div.sub', 'Dica: se o endereço mudar de vez em quando, reserve um IP fixo para este computador no roteador.')));
      }
      tvBody.append(h('div.pref',
        h('div.lbl', info.desktop ? 'Iniciar com o sistema' : 'Iniciar com o Windows'),
        h('div.sub', info.desktop
          ? 'Abre o IPTVKZ em segundo plano (na bandeja) quando o computador liga. Útil para usar só pela TV.'
          : 'Liga o servidor sozinho quando o computador inicia, sem abrir janela. Útil para usar só pela TV.'),
        sw(!!info.autostart, async (on, input) => {
          try {
            const r = await api('/api/autostart', { method: 'POST', body: JSON.stringify({ on }) });
            input.checked = r.autostart;
          } catch (e) {
            input.checked = !on;
          }
        }, 'Automático')));
    } else {
      tvBody.append(h('div.pref', h('div.lbl', 'Você está acessando pela rede'),
        h('div.sub', 'As opções de rede e inicialização ficam no computador que roda o IPTVKZ.')));
    }
    // do PC ou do celular: como levar o app para a TV (na própria TV não faz sentido)
    if (!TV.on || navigator.maxTouchPoints > 0) {
      tvBody.append(h('div.pref',
        h('div.lbl', 'Instalar o IPTVKZ na TV'),
        h('div.sub', 'Android TV, Fire TV e TV Box instalam sem cabo e sem loja; a LG, pela loja da LG.'),
        installTvButton()));
    }
    tvBody.append(h('div.pref',
      h('div.lbl', 'Modo TV neste aparelho'),
      h('div.sub', 'Letras maiores e navegação pelas setas e OK do controle remoto. Liga sozinho em TVs.'),
      sw(TV.on, (on) => { setTvMode(on); ctx.refreshNav(); }, 'Modo TV')));
  }
  renderTv({ local: S.local !== false, addresses: [], port: location.port || 8787, autostart: false });
  api('/api/info').then(renderTv).catch(() => {});

  // ---------- controle dos pais ----------
  const pc = h('div.pref-grid');
  page.append(h('div.set-section',
    h('h3', 'Controle dos pais'),
    h('p', 'Esconde canais, filmes e séries adultos em todos os aparelhos. Para ver, é preciso o PIN.'),
    pc));
  const rerender = () => ctx.rerender();
  if (!parentalEnabled()) {
    pc.append(h('div.pref',
      h('div.lbl', 'Desativado'),
      h('div.sub', 'Categorias como “Adultos”, “XXX” e “+18” são reconhecidas sozinhas; dá para marcar outras em Categorias.'),
      h('div.row', h('button.btn.small.primary', {
        onclick: async () => {
          const pin = await pinDialog({ title: 'Criar PIN', text: 'Escolha um PIN de 4 dígitos. Ele será pedido para mostrar conteúdo adulto.', confirm: true });
          if (!pin) return;
          setSetting('parentalPin', pinHash(pin));
          await saveNow('settings').catch(() => {});
          lockAdult();
          toast('Controle dos pais ativado', 'ok');
          rerender();
        },
      }, ico('lock'), 'Ativar controle dos pais'))));
  } else {
    const locked = adultLocked();
    pc.append(h('div.pref',
      h('div.lbl', locked ? 'Ativo: conteúdo adulto escondido' : 'Liberado neste aparelho'),
      h('div.sub', locked
        ? 'Digite o PIN para mostrar o conteúdo adulto até fechar o app.'
        : `Fica liberado até você bloquear ou fechar o app. ${adultCatCount()} categorias marcadas como adultas.`),
      h('div.row', { style: { flexWrap: 'wrap' } },
        locked
          ? h('button.btn.small.primary', {
            onclick: async () => {
              const pin = await pinDialog({ title: 'Desbloquear', text: 'Digite o PIN do controle dos pais.', check: checkPin });
              if (pin && unlockAdult(pin)) { toast('Conteúdo adulto liberado neste aparelho', 'ok'); rerender(); }
            },
          }, ico('unlock'), 'Desbloquear')
          : h('button.btn.small.primary', { onclick: () => { lockAdult(); toast('Bloqueado'); rerender(); } }, ico('lock'), 'Bloquear agora'),
        h('button.btn.small', {
          onclick: async () => {
            const cur = await pinDialog({ title: 'Trocar PIN', text: 'Primeiro, o PIN atual.', check: checkPin });
            if (!cur) return;
            const pin = await pinDialog({ title: 'Novo PIN', text: 'Escolha o novo PIN de 4 dígitos.', confirm: true });
            if (!pin) return;
            setSetting('parentalPin', pinHash(pin));
            await saveNow('settings').catch(() => {});
            toast('PIN trocado', 'ok');
          },
        }, 'Trocar PIN'),
        h('button.btn.small.ghost', {
          onclick: async () => {
            const pin = await pinDialog({ title: 'Desativar controle dos pais', text: 'Digite o PIN para desativar.', check: checkPin });
            if (!pin) return;
            setSetting('parentalPin', null);
            await saveNow('settings').catch(() => {});
            toast('Controle dos pais desativado');
            rerender();
          },
        }, 'Desativar'))),
      S.local !== false ? h('div.pref',
        h('div.lbl', 'Esqueceu o PIN?'),
        h('div.sub', 'Só dá para apagar o PIN neste computador (não pela TV). O controle dos pais será desativado.'),
        h('div.row', h('button.btn.small.ghost', {
          onclick: async () => {
            if (!(await confirmDialog('Apagar o PIN', 'O controle dos pais será desativado e o conteúdo adulto volta a aparecer. Continuar?', 'Apagar PIN', true))) return;
            setSetting('parentalPin', null);
            await saveNow('settings').catch(() => {});
            rerender();
          },
        }, 'Apagar PIN'))) : null);
  }

  // ---------- reprodução ----------
  const selectPref = (label, sub, key, options) => {
    const sel = h('select.input', { onchange: (e) => setSetting(key, e.target.value) },
      options.map(([v, l]) => h('option', { value: v, selected: S.settings[key] === v }, l)));
    return h('div.pref', h('div.lbl', label), sub ? h('div.sub', sub) : null, sel);
  };
  const autoNext = h('input', { type: 'checkbox', checked: !!S.settings.autoNext, onchange: (e) => setSetting('autoNext', e.target.checked) });
  page.append(h('div.set-section',
    h('h3', 'Reprodução'),
    h('p', 'Valem para todas as listas.'),
    h('div.pref-grid',
      selectPref('Áudio preferido', 'Escolhido sozinho quando o stream tem várias faixas.', 'audioLang',
        [['pt', 'Português'], ['en', 'Inglês'], ['orig', 'Original do arquivo']]),
      selectPref('Legendas', 'Automático: liga em português quando o áudio não é português.', 'subMode',
        [['auto', 'Automático'], ['always', 'Sempre em português'], ['off', 'Desligadas']]),
      selectPref('Tamanho da legenda', null, 'subSize', [['P', 'Pequena'], ['M', 'Média'], ['G', 'Grande'], ['GG', 'Muito grande']]),
      selectPref('Fundo da legenda', null, 'subBg', [['none', 'Nenhum'], ['shadow', 'Sombra'], ['box', 'Caixa preta']]),
      selectPref('Versão preferida', 'Quando o filme ou série tem Dublado e Legendado.', 'versionPref',
        [['Dublado', 'Dublado'], ['Legendado', 'Legendado'], ['Dual áudio', 'Dual áudio'], ['Nacional', 'Nacional']]),
      h('div.pref', h('div.lbl', 'Próximo episódio'), h('div.sub', 'Começa sozinho depois de 8 segundos.'),
        h('label.switch', autoNext, h('span.tr'), h('span', 'Automático'))))));

  // ---------- sobre ----------
  // Beta: modo de depuração (painel com FPS, travadas, lista e vídeo, em qualquer tela)
  if (isBeta()) {
    page.append(h('div.set-section', h('h3', 'Depuração (Beta)'),
      h('div.pref-grid', h('div.pref',
        h('div.lbl', 'Modo de depuração'),
        h('div.sub', 'Mostra no canto da tela FPS, travadas, memória, a lista e o vídeo, com cores: verde bom, amarelo no limite, vermelho ruim. Vale só neste aparelho.'),
        sw(debugOn(), (on) => setDebug(on), 'Depuração')))));
  }
  page.append(h('div.set-section',
    h('h3', 'Sobre'),
    (() => {
      const b = buildLabel();
      return h('div.build-info',
        h('div.row', { style: { gap: '10px', alignItems: 'center' } },
          h('b', `IPTVKZ ${b.short}`), h('span.build-mode' + (b.dev ? '.dev' : ''), b.mode)),
        b.detail ? h('div.muted.small', b.detail) : null);
    })(),
    h('p', 'Os dados ficam em ', h('code', S.dataDir || 'data/'), '.'),
    h('p.muted', 'O IPTVKZ é só um player: não fornece listas nem conteúdo, e cada usuário responde pelo que adiciona e assiste.'),
    h('div.row', { style: { marginBottom: '12px' } },
      h('button.btn.small', { onclick: () => showTermsDialog() }, ico('file'), 'Termos de uso')),
    TV.on ? h('button.btn.small.ghost', {
      onclick: async () => {
        if (await confirmDialog('Sair do IPTVKZ?', 'O aplicativo será fechado nesta TV.', 'Sair')) exitApp();
      },
    }, ico('power'), 'Sair do aplicativo') : h('button.btn.small.ghost', {
      onclick: async () => {
        if (await confirmDialog('Fechar o IPTVKZ', 'Isso encerra o servidor local. Para abrir de novo, use o atalho da área de trabalho.', 'Fechar')) {
          await api('/api/quit', { method: 'POST' }).catch(() => {});
          window.close();
        }
      },
    }, ico('power'), 'Fechar o IPTVKZ')));

  return { el: page };
}
