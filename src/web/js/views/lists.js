// Formulário de lista (M3U link / arquivo / Xtream) e tela de boas-vindas.
import { h, ico, modal, uid, toast, confirmDialog } from '../core/util.js';
import { S, saveNow, api } from '../core/store.js';
import { TV } from '../tv/tv.js';

const loadQrLib = () => new Promise((resolve, reject) => {
  if (window.qrcode) return resolve();
  const s = document.createElement('script');
  s.src = '/vendor/qrcode.js';
  s.onload = resolve;
  s.onerror = reject;
  document.head.append(s);
});

// TV: QR Code para preencher a lista pelo celular. Sem suporte neste aparelho, não aparece nada.
function pairingBox(onList) {
  const box = h('div.pair-box.hidden');
  let stopped = false;
  let token = null;
  let timer = null;
  const poll = async () => {
    if (stopped) return;
    const r = await api(`/api/pair/status?token=${token}`).catch(() => null);
    if (stopped) return;
    if (r && r.list) { token = null; onList(r.list); return; }
    timer = setTimeout(poll, 2000);
  };
  (async () => {
    const native = window.IPTVKZAndroid;
    const address = native && native.lanAddress ? native.lanAddress() : undefined;
    const r = await api('/api/pair/start', { method: 'POST', body: JSON.stringify({ address }) }).catch(() => null);
    if (stopped || !r || !r.available) return;
    token = r.token;
    await loadQrLib();
    if (stopped) return;
    const qr = window.qrcode(0, 'M');
    qr.addData(r.url);
    qr.make();
    box.replaceChildren(
      h('img.pair-qr', { src: qr.createDataURL(6, 3), alt: 'QR Code para adicionar a lista pelo celular' }),
      h('div', h('b', 'Mais rápido pelo celular'), h('p.muted', 'Escaneie com a câmera, no mesmo Wi-Fi da TV, e preencha a lista por lá.')));
    box.classList.remove('hidden');
    poll();
  })().catch(() => {});
  return {
    el: box,
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (token) api('/api/pair/end', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => {});
    },
  };
}

// Links tipo http://host:porta/get.php?username=X&password=Y&type=m3u_plus viram Xtream.
function xtreamFromUrl(url) {
  try {
    const u = new URL(url.trim());
    const user = u.searchParams.get('username');
    const pass = u.searchParams.get('password');
    if (user && pass && /get\.php|player_api\.php/i.test(u.pathname)) {
      return { server: `${u.protocol}//${u.host}`, username: user, password: pass };
    }
  } catch {}
  return null;
}

// Identidade da lista: mesma conta no mesmo servidor é a mesma lista, seja qual for o nome
// e mesmo que uma tenha sido cadastrada como Xtream e a outra pelo link get.php.
function listKey(l) {
  if (l.type !== 'xtream' && l.source === 'file') return null;
  const cfg = l.type === 'xtream' ? (xtreamFromUrl(l.server || '') || l) : xtreamFromUrl(l.url || '');
  const raw = cfg ? cfg.server : l.url;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw);
  } catch {
    return String(raw).trim().toLowerCase();
  }
  if (cfg) return `xtream|${u.host.toLowerCase()}|${cfg.username}`;
  return `url|${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

function findDuplicate(list) {
  const key = listKey(list);
  return key ? S.lists.find((l) => l.id !== list.id && listKey(l) === key) : null;
}

export function openListForm(existing, onSaved, onDelete) {
  const ex = existing || {};
  let tab = ex.type === 'xtream' ? 'xtream' : ex.source === 'file' ? 'file' : existing ? 'url' : 'xtream';
  let pickedFile = null;
  const listId = ex.id || uid(); // o mesmo id em novas tentativas, para não criar listas repetidas

  const err = h('div.error-box.hidden');
  const name = h('input.input', { value: ex.name || '', placeholder: 'Ex.: Minha lista' });
  const url = h('input.input', { value: ex.url || '', placeholder: 'http://…/lista.m3u' });
  const server = h('input.input', { value: ex.server || '', placeholder: 'http://servidor.com:8080' });
  const user = h('input.input', { value: ex.username || '', autocomplete: 'off' });
  const pass = h('input.input', { value: ex.password || '', type: 'password', autocomplete: 'new-password' });
  const showPass = h('button.icon-btn', { type: 'button', title: 'Mostrar senha', onclick: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; } }, ico('eye'));
  const epgUrl = h('input.input', { value: ex.epgUrl || '', placeholder: 'Opcional: http://…/guia.xml(.gz)' });
  const tz = h('select.input');
  for (let i = -12; i <= 12; i++) tz.append(h('option', { value: i, selected: Number(ex.tzOffset || 0) === i }, i === 0 ? 'Sem ajuste' : `${i > 0 ? '+' : ''}${i} h`));
  const fileInput = h('input', { type: 'file', accept: '.m3u,.m3u8,.txt', style: { display: 'none' } });
  const fileLabel = h('span.muted', ex.source === 'file' ? 'Arquivo já enviado. Escolha outro só se quiser trocar.' : 'Nenhum arquivo escolhido');
  fileInput.addEventListener('change', () => {
    pickedFile = fileInput.files[0] || null;
    if (pickedFile) {
      fileLabel.textContent = `${pickedFile.name} (${(pickedFile.size / 1048576).toFixed(1)} MB)`;
      if (!name.value) name.value = pickedFile.name.replace(/\.(m3u8?|txt)$/i, '');
    }
  });

  const xtHint = h('div.hidden', { style: { marginTop: '-6px', marginBottom: '14px' } });
  url.addEventListener('input', () => {
    const x = xtreamFromUrl(url.value);
    xtHint.classList.toggle('hidden', !x);
    if (x) {
      xtHint.replaceChildren(h('span.muted', 'Esse link é de um servidor Xtream. Usar como Xtream traz filmes, séries e guia completos. '),
        h('button.btn.small', {
          type: 'button',
          onclick: () => {
            server.value = x.server;
            user.value = x.username;
            pass.value = x.password;
            setTab('xtream');
          },
        }, 'Usar como Xtream'));
    }
  });
  server.addEventListener('change', () => {
    const x = xtreamFromUrl(server.value);
    if (x) {
      server.value = x.server;
      user.value = x.username;
      pass.value = x.password;
    }
  });

  const field = (label, input, hint) => h('div.field', h('label', label), input, hint ? h('div.hint', hint) : null);
  const panes = {
    xtream: h('div',
      field('Servidor', server, 'Endereço com porta, como o provedor informou. Pode colar o link get.php inteiro.'),
      h('div.row', field('Usuário', user), h('div.field', h('label', 'Senha'), h('div.row', { style: { gap: '4px' } }, pass, showPass)))),
    url: h('div', field('Link da lista (M3U/M3U8)', url), xtHint),
    file: h('div', h('div.field', h('label', 'Arquivo da lista'),
      h('div.row', h('button.btn', { type: 'button', onclick: () => fileInput.click() }, ico('upload'), 'Escolher arquivo'), fileLabel), fileInput)),
  };
  const tabBtns = {
    xtream: h('button', { type: 'button', onclick: () => setTab('xtream') }, ico('server'), 'Xtream Codes'),
    url: h('button', { type: 'button', onclick: () => setTab('url') }, ico('link'), 'Link M3U'),
    file: h('button', { type: 'button', onclick: () => setTab('file') }, ico('file'), 'Arquivo M3U'),
  };
  const paneBox = h('div');
  function setTab(t) {
    tab = t;
    for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('on', k === t);
    paneBox.replaceChildren(panes[t]);
  }
  setTab(tab);

  const saveBtn = h('button.btn.primary', { type: 'submit' }, existing ? 'Salvar e recarregar' : 'Adicionar lista');
  const pairing = TV.on && !existing ? pairingBox((list) => {
    // o que veio do celular entra no mesmo caminho do formulário (validação e lista repetida)
    const x = list.type === 'm3u' ? xtreamFromUrl(list.url) : xtreamFromUrl(list.server);
    name.value = list.name;
    if (x) { server.value = x.server; user.value = x.username; pass.value = x.password; setTab('xtream'); }
    else if (list.type === 'xtream') { server.value = list.server; user.value = list.username; pass.value = list.password; setTab('xtream'); }
    else { url.value = list.url; setTab('url'); }
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  }) : null;

  const form = h('form',
    pairing && pairing.el,
    err,
    h('div.tabs', Object.values(tabBtns)),
    field('Nome', name),
    paneBox,
    h('details', { style: { margin: '4px 0 12px' } },
      h('summary.muted', { style: { cursor: 'pointer', marginBottom: '12px' } }, 'Guia de programação (EPG)'),
      field('URL do guia (XMLTV)', epgUrl, 'Deixe vazio para usar o guia que vem com a lista, se houver.'),
      field('Corrigir horário do guia', tz, 'Use se a programação aparecer adiantada ou atrasada.')),
    h('p.faint', { style: { fontSize: '12px', margin: '0 0 8px' } }, 'Os dados ficam só neste computador, na pasta data/ do IPTVKZ.'),
    h('div.form-actions',
      existing && onDelete ? h('button.btn.danger', {
        type: 'button',
        style: { marginRight: 'auto' },
        onclick: async () => {
          if (!await confirmDialog('Excluir lista', `Excluir “${ex.name}”? Favoritos e progresso dessa lista também serão apagados.`, 'Excluir', true)) return;
          m.close();
          onDelete(ex.id);
        },
      }, ico('trash'), 'Excluir lista') : null,
      h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancelar'), saveBtn));

  const showErr = (msg) => {
    err.textContent = msg;
    err.classList.toggle('hidden', !msg);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    const list = {
      id: listId,
      name: name.value.trim(),
      type: tab === 'xtream' ? 'xtream' : 'm3u',
      source: tab === 'file' ? 'file' : 'url',
      epgUrl: epgUrl.value.trim(),
      tzOffset: Number(tz.value) || 0,
      createdAt: ex.createdAt || Date.now(),
    };
    if (tab === 'xtream') {
      Object.assign(list, { server: server.value.trim(), username: user.value.trim(), password: pass.value });
      if (!list.server || !list.username || !list.password) return showErr('Preencha servidor, usuário e senha.');
      if (!list.name) list.name = list.server.replace(/^https?:\/\//, '').split(/[:/]/)[0];
    } else if (tab === 'url') {
      list.url = url.value.trim();
      if (!/^https?:\/\//i.test(list.url)) return showErr('Informe um link começando com http:// ou https://');
      if (!list.name) list.name = 'Minha lista';
    } else {
      if (!pickedFile && ex.source !== 'file') return showErr('Escolha o arquivo .m3u da lista.');
      if (!list.name) list.name = 'Minha lista';
    }

    const dup = findDuplicate(list);
    if (dup) return showErr(`Lista já adicionada: esta conta já está salva como “${dup.name}”.`);

    saveBtn.disabled = true;
    saveBtn.replaceChildren(h('div.spinner.small'), 'Salvando…');
    try {
      if (tab === 'file' && pickedFile) {
        await api(`/api/m3u?list=${encodeURIComponent(list.id)}`, { method: 'POST', body: pickedFile });
      }
      const i = S.lists.findIndex((l) => l.id === list.id);
      if (i >= 0) S.lists[i] = list;
      else S.lists.push(list);
      await saveNow('lists');
      // Salvou: fecha na hora e confirma. O carregamento (e eventual erro) aparece na tela principal.
      m.close();
      toast(existing ? 'Lista atualizada' : 'Lista adicionada', 'ok');
      onSaved(list);
      return;
    } catch (e2) {
      showErr(e2.message || String(e2));
      saveBtn.disabled = false;
      saveBtn.replaceChildren(existing ? 'Salvar e recarregar' : 'Tentar de novo');
    }
  });

  const m = modal(existing ? 'Editar lista' : 'Adicionar lista', form, { wide: true, onClose: () => pairing && pairing.stop() });
  setTimeout(() => (tab === 'xtream' ? server : tab === 'url' ? url : name).focus(), 50);
  return m;
}

export function welcomeView(onAdd) {
  return h('div.center-state.welcome',
    h('img.logo-big', { src: '/img/icon.png', alt: '' }),
    h('h2', 'Bem-vindo ao IPTVKZ'),
    h('p', 'Adicione a sua lista para começar. Funciona com links M3U, arquivos .m3u e contas Xtream Codes.'),
    h('button.btn.primary.big', { style: { marginTop: '10px' }, onclick: onAdd }, ico('plus'), 'Adicionar minha lista'));
}
