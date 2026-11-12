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

// TV: QR Code para preencher a lista (ou restaurar um backup) pelo celular. Sem suporte neste aparelho, não aparece nada.
function pairingBox(onList, onRestore, onReady) {
  const box = h('div.pair-box.hidden');
  let stopped = false;
  let token = null;
  let timer = null;
  const poll = async () => {
    if (stopped) return;
    const r = await api(`/api/pair/status?token=${token}`).catch(() => null);
    if (stopped) return;
    if (r && r.list) { token = null; onList(r.list); return; }
    if (r && r.restore) { const t = token; token = null; onRestore(r.restore, t); return; }
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
      h('div', h('b', TV.on ? 'Mais rápido pelo celular' : 'Ou mande pelo celular'), h('p.muted', `Escaneie com a câmera, no mesmo Wi-Fi ${TV.on ? 'da TV' : 'deste computador'}, e preencha a lista por lá. Uma lista baixada no celular entra por “Carregar lista”.`)));
    box.classList.remove('hidden');
    if (onReady) onReady();
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

// App da TV (Android TV ou LG): sem seletor de arquivos nem downloads.
const nativeTvApp = () => !!(window.IPTVKZAndroid || window.webOSSystem || window.PalmSystem);

// Baixa o arquivo da lista direto no aparelho (computador, celular, navegador).
export function downloadList(list) {
  h('a', { href: `/api/list-export?list=${encodeURIComponent(list.id)}`, download: '' }).click();
}

// Resumo do arquivo de lista baixada, mostrado antes de carregar.
function loadText(s) {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const when = s.createdAt ? ` em ${new Date(s.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  const text = `${s.names.join(', ') || plural(s.lists, 'lista', 'listas')}, baixada${when}, com `
    + `${plural(s.favorites, 'favorito', 'favoritos')} e ${plural(s.history, 'item', 'itens')} no histórico. `
    + 'Ela entra junto com as listas que já estão aqui.';
  return text;
}

// Confirma e aplica: apply faz a chamada que junta a lista nesta TV/computador.
async function confirmLoad(s, apply) {
  if (!await confirmDialog('Carregar lista?', loadText(s), 'Carregar lista')) return false;
  try {
    await apply();
    toast('Lista carregada', 'ok');
    setTimeout(() => location.reload(), 800);
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

// Lista baixada enviada pelo celular: só aplica depois do OK na TV.
async function confirmRestore(s, token, closeForm) {
  closeForm();
  const ok = await confirmLoad(s, () => api('/api/pair/restore', { method: 'POST', body: JSON.stringify({ token }) }));
  if (!ok) api('/api/pair/end', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => {});
}

// TV: QR Code para baixar uma lista no celular (com favoritos e histórico dela).
export function openListSave(list) {
  const status = h('p.muted', 'Preparando o QR Code...');
  const qrBox = h('div.pair-box.hidden');
  let token = null;
  let timer = null;
  let stopped = false;
  const m = modal(`Baixar “${list.name}” no celular`, h('div', qrBox, status), {
    onClose() {
      stopped = true;
      clearTimeout(timer);
      if (token) api('/api/pair/end', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => {});
    },
  });
  const poll = async () => {
    if (stopped) return;
    const r = await api(`/api/pair/status?token=${token}`).catch(() => null);
    if (stopped) return;
    if (r && r.downloaded) {
      status.replaceChildren(h('b', 'Lista baixada no celular.'), h('br'),
        'Para usar em outro aparelho, abra “Adicionar lista” nele, escaneie o QR Code e escolha “Carregar lista” no celular.');
    }
    timer = setTimeout(poll, 2000);
  };
  (async () => {
    const native = window.IPTVKZAndroid;
    const address = native && native.lanAddress ? native.lanAddress() : undefined;
    const r = await api('/api/pair/start', { method: 'POST', body: JSON.stringify({ address, list: list.id }) }).catch(() => null);
    if (stopped) return;
    if (!r || !r.available) {
      if (nativeTvApp()) {
        status.textContent = 'Não foi possível mostrar o QR Code. Confira se a TV está conectada à rede de casa e tente de novo.';
        return;
      }
      m.close();
      downloadList(list);
      return;
    }
    token = r.token;
    await loadQrLib();
    if (stopped) return;
    const qr = window.qrcode(0, 'M');
    qr.addData(`${r.url}?lista=${encodeURIComponent(list.id)}`);
    qr.make();
    qrBox.replaceChildren(
      h('img.pair-qr', { src: qr.createDataURL(6, 3), alt: 'QR Code para baixar a lista no celular' }),
      h('div', h('b', 'Pelo celular'), h('p.muted', 'Escaneie com a câmera, no mesmo Wi-Fi da TV, e toque em “Baixar lista”. O arquivo leva a lista, os favoritos e o histórico dela, com a senha da lista: guarde com cuidado.')));
    qrBox.classList.remove('hidden');
    status.textContent = 'Aguardando o download no celular...';
    poll();
  })().catch(() => { status.textContent = 'Não foi possível preparar o QR Code. Tente de novo.'; });
}

// Links tipo http://host:porta/get.php?username=X&password=Y&type=m3u_plus viram Xtream.
// Texto colado com um ou vários endereços (um por linha, ou separados por espaço, vírgula...). Conserta o que dá:
// http faltando ou digitado errado (htp://, http:/, http;//), barra no fim, link get.php inteiro, maiúsculas.
// Sem http ou https, fica http (o mais comum nos painéis); o teste de servidores tenta o outro se não responder.
export function parseServers(text) {
  const out = [];
  for (const raw of String(text || '').split(/[\s,;|]+/)) {
    let t = raw.replace(/^[<("'[]+/, '').replace(/[>)"'\].,;:]+$/, '');
    if (!t) continue;
    let https = false;
    const sch = t.match(/^h?t{1,2}p{1,2}(s?)(?:[:;.]+\/*|\/+)/i);
    if (sch) { https = !!sch[1]; t = t.slice(sch[0].length); }
    t = t.replace(/^\/+/, '');
    const m = t.match(/^([^/?#]+)([^?#]*)/);
    if (!m) continue;
    const hostPort = m[1].toLowerCase().replace(/\.+$/, '');
    const path = m[2].replace(/\/(get|player_api|xmltv)\.php.*$/i, '').replace(/\/+$/, '');
    const [host, port, more] = hostPort.split(':');
    if (more !== undefined || !/^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,})$/.test(host)) continue;
    if (port !== undefined && !/^\d{1,5}$/.test(port)) continue;
    const s = `${https ? 'https' : 'http'}://${hostPort}${path}`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

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
  const url = h('input.input', { value: ex.url || '', placeholder: 'http://.../lista.m3u' });
  const server = h('input.input', { value: ex.server || '', placeholder: 'http://servidor.com:8080' });
  // Mesma conta em outros endereços do provedor: reservas se o principal cair, e dá para testar qual é o mais rápido
  const extraServers = h('textarea.input', { rows: 3, placeholder: 'Um endereço por linha (opcional)', value: (ex.servers || []).join('\n') });
  const speedBox = h('div.speed-box');
  const serverLines = () => parseServers(extraServers.value);
  const speedBtn = h('button.btn.small', {
    type: 'button',
    onclick: async () => {
      if (!server.value.trim() || !user.value.trim()) return showErr('Preencha servidor e usuário para testar.');
      showErr('');
      speedBtn.disabled = true;
      speedBox.replaceChildren(h('div.row', h('div.spinner.small'), h('span.muted', 'Testando um servidor de cada vez...')));
      try {
        const r = await api('/api/list-speed', { method: 'POST', body: JSON.stringify({ id: ex.id, server: server.value.trim(), servers: serverLines(), username: user.value.trim(), password: pass.value }) });
        const short = (s) => s.replace(/^https?:\/\//, '');
        if (r.results.length) {
          server.value = r.results[0].server;
          extraServers.value = r.results.slice(1).map((x) => x.server).join('\n');
        }
        speedBox.replaceChildren(...r.results.map((x, i) => h('div.speed-row' + (i === r.fastest ? '.best' : ''),
          h('span.speed-host', short(x.server)),
          h('span' + (x.ms == null ? '.bad' : x.ms < 800 ? '.good' : x.ms < 2000 ? '.warn' : '.bad'), x.ms == null ? (x.state === 'offline' ? 'fora do ar' : 'recusou') : `${x.ms} ms`),
          i === r.fastest ? h('span.badge.gold', 'mais rápido') : null,
          i > 0 && x.ms != null ? h('button.btn.small.ghost', {
            type: 'button',
            onclick: () => {
              // troca: este vira o principal e o antigo principal vai para os reservas
              const old = server.value.trim();
              server.value = x.server;
              extraServers.value = [old, ...serverLines().filter((s) => short(s) !== short(x.server))].join('\n');
              speedBox.replaceChildren(h('span.muted', `Usando ${short(x.server)}. Salve para aplicar.`));
            },
          }, 'Usar este') : null)));
        if (r.fastest > 0) toast(`${short(r.results[r.fastest].server)} está mais rápido que o seu principal`, 'info');
      } catch (e2) {
        speedBox.replaceChildren(h('span.bad', e2.message || String(e2)));
      } finally {
        speedBtn.disabled = false;
      }
    },
  }, ico('refresh'), 'Testar servidores');
  const user = h('input.input', { value: ex.username || '', autocomplete: 'off' });
  const pass = h('input.input', { value: ex.password || '', type: 'password', autocomplete: 'new-password' });
  const showPass = h('button.icon-btn', { type: 'button', title: 'Mostrar senha', onclick: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; } }, ico('eye'));
  const epgUrl = h('input.input', { value: ex.epgUrl || '', placeholder: 'Opcional: http://.../guia.xml(.gz)' });
  const tz = h('select.input');
  for (let i = -12; i <= 12; i++) tz.append(h('option', { value: i, selected: Number(ex.tzOffset || 0) === i }, i === 0 ? 'Sem ajuste' : `${i > 0 ? '+' : ''}${i} h`));
  const fileInput = h('input', { type: 'file', accept: '.m3u,.m3u8,.txt', style: { display: 'none' } });
  // só aparece quando o QR Code do celular estiver na tela
  const phoneHint = h('div.hint.hidden', 'Pelo celular: escaneie o QR Code acima e escolha “Carregar lista”.');
  // Carregar lista: arquivo baixado pelo botão “Baixar lista” (aqui ou em outro aparelho)
  let loadFile = null;
  const loadInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  const loadLabel = h('span.muted', 'Nenhum arquivo escolhido');
  loadInput.addEventListener('change', () => {
    loadFile = loadInput.files[0] || null;
    if (loadFile) loadLabel.textContent = loadFile.name;
  });
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
    const many = parseServers(server.value);
    const x = many.length > 1 ? null : xtreamFromUrl(server.value);
    if (x) {
      server.value = x.server;
      user.value = x.username;
      pass.value = x.password;
    } else if (many.length) setServers(many[0], many.slice(1));
  });

  const field = (label, input, hint) => h('div.field', h('label', label), input, hint ? h('div.hint', hint) : null);
  // Escondido até pedir: a lista simples continua só com servidor, usuário e senha
  const moreServers = h('div' + ((ex.servers || []).length ? '' : '.hidden'),
    field('Outros servidores do mesmo provedor', extraServers, 'Mesmo usuário e senha. Pode colar vários de uma vez, do jeito que vieram: o app arruma os links. Se o principal cair, usa o próximo.'),
    h('div.row', { style: { gap: '8px', marginBottom: '12px' } }, speedBtn), speedBox);
  const moreServersBtn = h('button.btn.small.ghost' + ((ex.servers || []).length ? '.hidden' : ''), {
    type: 'button',
    style: { marginBottom: '12px' },
    onclick: () => { moreServersBtn.classList.add('hidden'); moreServers.classList.remove('hidden'); extraServers.focus(); },
  }, ico('plus'), 'O provedor deu mais de um servidor?');
  // principal + reservas de uma vez (texto colado, celular): mostra os reservas se houver
  const setServers = (main, extra) => {
    if (main) server.value = main;
    const rest = (extra || []).filter((s) => s !== server.value);
    if (rest.length) {
      extraServers.value = rest.join('\n');
      moreServersBtn.classList.add('hidden');
      moreServers.classList.remove('hidden');
    }
  };
  const panes = {
    xtream: h('div',
      field('Servidor', server, 'Endereço com porta, como o provedor informou. Pode colar o link get.php inteiro.'),
      moreServersBtn, moreServers,
      h('div.row', field('Usuário', user), h('div.field', h('label', 'Senha'), h('div.row', { style: { gap: '4px' } }, pass, showPass)))),
    url: h('div', field('Link da lista (M3U/M3U8)', url), xtHint),
    file: h('div', h('div.field', h('label', 'Arquivo da lista'),
      h('div.row', h('button.btn', { type: 'button', onclick: () => fileInput.click() }, ico('upload'), 'Escolher arquivo'), fileLabel), fileInput)),
    load: h('div', h('div.field', h('label', 'Arquivo da lista baixada'),
      // os apps da TV não abrem seletor de arquivos: lá o arquivo vem pelo celular
      nativeTvApp() ? null : h('div.row', h('button.btn', { type: 'button', onclick: () => loadInput.click() }, ico('upload'), 'Escolher arquivo'), loadLabel), loadInput,
      phoneHint,
      h('div.hint', 'O arquivo começa com “iptvkz-lista” e é gerado pelo botão “Baixar lista”. A lista entra com favoritos e histórico; as outras continuam.'))),
  };
  const tabBtns = {
    xtream: h('button', { type: 'button', onclick: () => setTab('xtream') }, ico('server'), 'Xtream Codes'),
    url: h('button', { type: 'button', onclick: () => setTab('url') }, ico('link'), 'Link M3U'),
    file: h('button', { type: 'button', onclick: () => setTab('file') }, ico('file'), 'Arquivo M3U'),
  };
  if (!existing) tabBtns.load = h('button', { type: 'button', onclick: () => setTab('load') }, ico('download'), 'Carregar lista');
  const extras = h('div');
  const paneBox = h('div');
  function setTab(t) {
    tab = t;
    for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('on', k === t);
    paneBox.replaceChildren(panes[t]);
    extras.classList.toggle('hidden', t === 'load');
    saveBtn.textContent = t === 'load' ? 'Carregar lista' : existing ? 'Salvar e recarregar' : 'Adicionar lista';
  }
  const saveBtn = h('button.btn.primary', { type: 'submit' }, existing ? 'Salvar e recarregar' : 'Adicionar lista');
  setTab(tab);
  // TV e PC: QR para mandar a lista pelo celular (no PC é opcional, dá para digitar). No celular não faz sentido.
  const touchOnly = !TV.on && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const pairing = !touchOnly && !existing ? pairingBox((list) => {
    // o que veio do celular entra no mesmo caminho do formulário (validação e lista repetida)
    const x = list.type === 'm3u' ? xtreamFromUrl(list.url) : xtreamFromUrl(list.server);
    name.value = list.name;
    const fromPhone = list.type === 'xtream' ? parseServers(`${list.server}\n${list.servers || ''}`) : [];
    if (x) { server.value = x.server; user.value = x.username; pass.value = x.password; setTab('xtream'); setServers(null, fromPhone); }
    else if (list.type === 'xtream') { setServers(fromPhone[0] || list.server, fromPhone.slice(1)); user.value = list.username; pass.value = list.password; setTab('xtream'); }
    else { url.value = list.url; setTab('url'); }
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  }, (summary, token) => confirmRestore(summary, token, () => m.close()), () => phoneHint.classList.remove('hidden')) : null;

  const form = h('form',
    pairing && pairing.el,
    err,
    h('div.tabs', Object.values(tabBtns)),
    paneBox,
    extras,
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

  extras.append(field('Nome', name),
    h('details', { style: { margin: '4px 0 12px' } },
      h('summary.muted', { style: { cursor: 'pointer', marginBottom: '12px' } }, 'Guia de programação (EPG)'),
      field('URL do guia (XMLTV)', epgUrl, 'Deixe vazio para usar o guia que vem com a lista, se houver.'),
      field('Corrigir horário do guia', tz, 'Use se a programação aparecer adiantada ou atrasada.')));

  const showErr = (msg) => {
    err.textContent = msg;
    err.classList.toggle('hidden', !msg);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    if (tab === 'load') {
      if (!loadFile) return showErr(nativeTvApp() ? 'Use o QR Code acima com o celular e escolha “Carregar lista”.' : 'Escolha o arquivo da lista baixada.');
      try {
        const body = await loadFile.text();
        const { summary } = await api('/api/list-import?dry=1', { method: 'POST', body });
        m.close();
        await confirmLoad(summary, () => api('/api/list-import', { method: 'POST', body }));
      } catch (e2) {
        showErr(e2.message || String(e2));
      }
      return;
    }
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
      Object.assign(list, { server: server.value.trim(), servers: serverLines().filter((s) => s !== server.value.trim()), username: user.value.trim(), password: pass.value });
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
    saveBtn.replaceChildren(h('div.spinner.small'), 'Salvando...');
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
    h('img.logo-big', { src: '/img/icon-256.webp', alt: '' }),
    h('h2', 'Bem-vindo ao IPTVKZ'),
    h('p', 'Adicione a sua lista para começar. Funciona com links M3U, arquivos .m3u e contas Xtream Codes.'),
    h('button.btn.primary.big', { style: { marginTop: '10px' }, onclick: onAdd }, ico('plus'), 'Adicionar minha lista'));
}
