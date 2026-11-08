// Configurações: listas, categorias (ocultar/ordenar), reprodução e sobre.
import { h, ico, fmtAgo, confirmDialog } from '../util.js';
import { S, C, activeList, orderedCats, setCatHidden, setCatOrder, resetCats, setSetting, saveNow, api } from '../store.js';
import { TV, setTvMode } from '../tv.js';

const TYPE = { xtream: 'Xtream Codes', url: 'Link M3U', file: 'Arquivo M3U' };

function listType(l) {
  return l.type === 'xtream' ? 'xtream' : l.source === 'file' ? 'file' : 'url';
}

function host(l) {
  const raw = l.type === 'xtream' ? l.server : l.url;
  try { return new URL(/^https?:/.test(raw) ? raw : 'http://' + raw).host; } catch { return ''; }
}

export function settingsView(params, ctx) {
  ctx.setTitle('Configurações');
  const page = h('div.page.settings');

  // ---------- listas ----------
  const cards = h('div.list-cards');
  const act = activeList();
  for (const l of S.lists) {
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
        h('button.btn.small.ghost', {
          onclick: async () => {
            if (await confirmDialog('Excluir lista', `Excluir “${l.name}”? Favoritos e progresso dessa lista também serão apagados.`, 'Excluir', true)) {
              ctx.deleteList(l.id);
            }
          },
        }, ico('trash'), 'Excluir'))));
  }
  cards.append(h('button.list-card.add-card', { onclick: () => ctx.addList() }, ico('plus'), 'Adicionar lista'));
  page.append(h('div.set-section', h('h3', 'Listas'), h('p', 'Troque de lista pelo seletor no topo da barra lateral.'), cards));

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
    tvBody.append(h('div.pref',
      h('div.lbl', 'Modo TV neste aparelho'),
      h('div.sub', 'Letras maiores e navegação pelas setas e OK do controle remoto. Liga sozinho em TVs.'),
      sw(TV.on, (on) => { setTvMode(on); ctx.refreshNav(); }, 'Modo TV')));
  }
  renderTv({ local: S.local !== false, addresses: [], port: location.port || 8787, autostart: false });
  api('/api/info').then(renderTv).catch(() => {});

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
  page.append(h('div.set-section',
    h('h3', 'Sobre'),
    h('p', 'IPTVKZ 1.0. Os dados ficam em ', h('code', S.dataDir || 'data/'), '.'),
    h('p.muted', S.vlc ? 'VLC encontrado: o botão “Abrir no VLC” está ativo.' : 'VLC não encontrado. Instale o VLC para abrir formatos que o navegador não toca.'),
    h('button.btn.small.ghost', {
      onclick: async () => {
        if (await confirmDialog('Fechar o IPTVKZ', 'Isso encerra o servidor local. Para abrir de novo, use o atalho da área de trabalho.', 'Fechar')) {
          await api('/api/quit', { method: 'POST' }).catch(() => {});
          window.close();
        }
      },
    }, ico('power'), 'Fechar o IPTVKZ')));

  return { el: page };
}
