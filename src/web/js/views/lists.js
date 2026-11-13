// Formulário de lista (M3U link / arquivo / Xtream) e tela de boas-vindas.
import { h, ico, modal, uid, toast, confirmDialog } from '../core/util.js';
import { S, saveNow, api } from '../core/store.js';
import { TV, focusEl } from '../tv/tv.js';

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
      h('div', h('b', TV.on ? 'Mais rápido pelo celular' : 'Ou mande pelo celular'), h('p.muted', `Escaneie com a câmera, no mesmo Wi-Fi ${TV.on ? 'da TV' : 'deste computador'}, e preencha a lista por lá. Uma lista baixada no celular entra por “Lista IPTVKZ”.`)));
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
        'Para usar em outro aparelho, abra “Adicionar lista” nele, escaneie o QR Code e escolha “Lista IPTVKZ” no celular.');
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

// Editar pelo celular: QR Code que abre no celular a lista com as abas Dados e Servidores, Atualizar, Excluir e
// Salvar. A TV aplica cada pedido que chega; a janela fica aberta (e a chave valendo) para mais mudanças.
export function openListPhone(list, { onSaved, onRefresh, onDelete } = {}) {
  const status = h('p.muted', 'Preparando o QR Code...');
  const qrBox = h('div.pair-box.hidden');
  let token = null;
  let timer = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (token) api('/api/pair/end', { method: 'POST', body: JSON.stringify({ token }) }).catch(() => {});
    token = null;
  };
  const m = modal(`Editar “${list.name}” pelo celular`, h('div', qrBox, status), { onClose: stop });
  const hhmm = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  async function apply(e) {
    const i = S.lists.findIndex((l) => l.id === e.id);
    if (i < 0) return;
    const old = S.lists[i];
    if (e.action === 'delete') {
      stop();
      m.close();
      toast(`“${old.name}” foi excluída pelo celular`, 'ok');
      if (onDelete) onDelete(old.id);
      return;
    }
    if (e.action === 'refresh') {
      status.textContent = 'Atualizando a lista...';
      if (onRefresh) await onRefresh(old.id);
      status.textContent = `Lista atualizada às ${hhmm()}. Pode continuar editando pelo celular.`;
      return;
    }
    const f = e.fields || {};
    const next = { ...old, name: f.name || old.name, epgUrl: f.epgUrl || '' };
    if (old.type === 'xtream') {
      const all = parseServers([f.server, ...(f.servers || [])].join('\n'));
      Object.assign(next, { server: all[0] || old.server, servers: all.slice(1), username: f.username || old.username, password: f.password || old.password });
    } else if (old.source !== 'file' && /^https?:\/\//i.test(f.url || '')) next.url = f.url;
    // mudou a conexão (servidor, usuário, senha, link): recarrega a lista; só nome ou guia: só redesenha
    const conn = ['server', 'username', 'password', 'url'].some((k) => next[k] !== old[k]);
    S.lists[i] = next;
    await saveNow('lists');
    toast('Lista salva pelo celular', 'ok');
    status.textContent = `Salvo às ${hhmm()}. Pode continuar editando pelo celular.`;
    if (conn && onSaved) onSaved(next);
    else window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  const poll = async () => {
    if (stopped) return;
    const r = await api(`/api/pair/status?token=${token}`).catch(() => null);
    if (stopped) return;
    if (r && r.edit) {
      await apply(r.edit).catch(() => toast('Não foi possível aplicar a mudança do celular', 'error'));
      if (stopped || r.edit.action === 'delete') return;
    }
    timer = setTimeout(poll, 2000);
  };
  (async () => {
    const native = window.IPTVKZAndroid;
    const address = native && native.lanAddress ? native.lanAddress() : undefined;
    const r = await api('/api/pair/start', { method: 'POST', body: JSON.stringify({ address, list: list.id, mode: 'edit' }) }).catch(() => null);
    if (stopped) return;
    if (!r || !r.available) {
      status.textContent = `Não foi possível mostrar o QR Code. Confira se ${TV.on ? 'a TV' : 'este computador'} está conectado à rede de casa e tente de novo.`;
      return;
    }
    token = r.token;
    await loadQrLib();
    if (stopped) return;
    const qr = window.qrcode(0, 'M');
    qr.addData(r.url);
    qr.make();
    qrBox.replaceChildren(
      h('img.pair-qr', { src: qr.createDataURL(6, 3), alt: 'QR Code para editar a lista pelo celular' }),
      h('div', h('b', 'Pelo celular'), h('p.muted', `Escaneie com a câmera, no mesmo Wi-Fi ${TV.on ? 'da TV' : 'deste computador'}. No celular dá para mudar os dados e os servidores, atualizar ou excluir a lista; cada “Salvar” chega aqui na hora.`)));
    qrBox.classList.remove('hidden');
    status.textContent = 'Aguardando o celular...';
    poll();
  })().catch(() => { status.textContent = 'Não foi possível preparar o QR Code. Tente de novo.'; });
}

// O QR só faz sentido fora do celular (no celular, edita direto pela tela)
export const canPhoneEdit = () => TV.on || !window.matchMedia('(hover: none) and (pointer: coarse)').matches;

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

// Servidores de uma lista Xtream (mesmo usuário e senha): o em uso primeiro, depois os outros, do mais rápido ao
// mais lento depois do teste. "Usar este" troca o servidor em uso e recarrega a lista; dá para tirar e adicionar.
// O campo de digitar só abre com "Adicionar servidor" (na TV, focar um campo abre o teclado).
export function openServers(list, onChanged, onClose) {
  let main = parseServers(list.server)[0] || list.server;
  let others = parseServers((list.servers || []).join('\n')).filter((s) => s !== main);
  const results = new Map(); // servidor -> { ms, state }
  const short = (s) => String(s).replace(/^https?:\/\//, '');
  const err = h('div.error-box.hidden');
  const showErr = (msg) => { err.textContent = msg; err.classList.toggle('hidden', !msg); };
  const rowsBox = h('div.speed-box');
  const addInput = h('input.input', { placeholder: 'http://servidor.com:8080 (pode colar vários)', autocomplete: 'off' });
  const addBox = h('div.row.hidden', { style: { gap: '8px', marginBottom: '10px' } }, addInput,
    h('button.btn.small', { type: 'button', onclick: () => addFromInput() }, 'Adicionar'));
  const addBtn = h('button.btn.small.ghost', { type: 'button', onclick: () => { addBox.classList.remove('hidden'); addInput.focus(); } }, ico('plus'), 'Adicionar servidor');

  async function save(newMain) {
    const changed = newMain && newMain !== main;
    if (changed) { others = [main, ...others.filter((x) => x !== newMain)]; main = newMain; }
    const i = S.lists.findIndex((l) => l.id === list.id);
    if (i < 0) return;
    S.lists[i] = { ...S.lists[i], server: main, servers: others.slice() };
    list = S.lists[i];
    await saveNow('lists');
    render();
    if (changed) { toast(`Usando ${short(main)}`, 'ok'); onChanged && onChanged(list); }
  }
  function addFromInput() {
    const got = parseServers(addInput.value).filter((s) => s !== main && !others.includes(s));
    if (!got.length) return showErr(addInput.value.trim() ? 'Endereço não reconhecido. Ex.: http://servidor.com:8080' : '');
    showErr('');
    others.push(...got);
    addInput.value = '';
    addBox.classList.add('hidden');
    save().then(() => focusEl(addBtn));
  }
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });

  function render() {
    // depois do teste: do mais rápido ao mais lento, fora do ar no fim
    const rank = (s) => { const r = results.get(s); return !r ? 1e9 : r.ms == null ? 2e9 : r.ms; };
    const sorted = results.size ? [...others].sort((a, b) => rank(a) - rank(b)) : others;
    const best = results.size ? [main, ...others].filter((s) => results.get(s) && results.get(s).ms != null).sort((a, b) => rank(a) - rank(b))[0] : null;
    rowsBox.replaceChildren(...[main, ...sorted].map((s, i) => {
      const r = results.get(s);
      return h('div.speed-row' + (i === 0 ? '.best' : ''),
        h('span.speed-host', short(s)),
        i === 0 ? h('span.badge.onair', 'EM USO') : null,
        s === best ? h('span.badge.gold', 'mais rápido') : null,
        r ? h('span.' + (r.ms == null ? 'bad' : r.ms < 800 ? 'good' : r.ms < 2000 ? 'warn' : 'bad'), r.ms == null ? (r.state === 'offline' ? 'fora do ar' : 'recusou') : `${r.ms} ms`) : null,
        i > 0 && !(r && r.ms == null) ? h('button.btn.small', { type: 'button', onclick: () => save(s) }, 'Usar este') : null,
        i > 0 ? h('button.icon-btn', {
          type: 'button',
          title: 'Tirar este servidor',
          onclick: () => { others = others.filter((x) => x !== s); results.delete(s); save(); },
        }, ico('trash')) : null);
    }));
  }

  const testBtn = h('button.btn.small.primary', {
    type: 'button',
    onclick: async () => {
      showErr('');
      testBtn.disabled = true;
      testBtn.replaceChildren(h('div.spinner.small'), 'Testando...');
      try {
        const r = await api('/api/list-speed', { method: 'POST', body: JSON.stringify({ id: list.id, server: main, servers: others, username: list.username }) });
        results.clear();
        for (const x of r.results) results.set(x.server, x);
        // endereço que só respondeu no outro protocolo (http <-> https): guarda o que funcionou
        const fixed = r.results.map((x) => x.server);
        if (fixed.length && (fixed[0] !== main || fixed.slice(1).join() !== others.join())) {
          main = fixed[0];
          others = fixed.slice(1);
          await save();
        } else render();
        const best = r.fastest >= 0 ? r.results[r.fastest] : null;
        if (best && r.fastest > 0) toast(`${short(best.server)} está mais rápido que o em uso`, 'info');
      } catch (e2) {
        showErr(e2.message || String(e2));
      } finally {
        testBtn.disabled = false;
        testBtn.replaceChildren(ico('refresh'), 'Testar servidores');
      }
    },
  }, ico('refresh'), 'Testar servidores');

  render();
  modal(`Servidores · ${list.name}`, h('div',
    h('p.muted', { style: { margin: '0 0 12px' } }, 'Endereços da mesma conta (mesmo usuário e senha). O primeiro é o que está em uso; se ele cair, o app usa o próximo.'),
    err, rowsBox, addBox,
    h('div.row', { style: { gap: '8px', marginTop: '4px' } }, testBtn, addBtn)), { wide: true, onClose });
  setTimeout(() => focusEl(testBtn), 50);
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
  // Reservas da mesma conta: a tela fica em Configurações > Servidores. Aqui só guarda o que veio junto
  // (vários endereços colados no Servidor, ou o campo do celular), e mantém os que a lista já tinha.
  const reserves = parseServers((ex.servers || []).join('\n'));
  const mainServer = () => parseServers(server.value)[0] || server.value.trim();
  const serverLines = () => reserves.filter((s) => s !== mainServer());
  const user = h('input.input', { value: ex.username || '', autocomplete: 'off' });
  const pass = h('input.input', { value: ex.password || '', type: 'password', autocomplete: 'new-password' });
  const showPass = h('button.icon-btn', { type: 'button', title: 'Mostrar senha', onclick: () => { pass.type = pass.type === 'password' ? 'text' : 'password'; } }, ico('eye'));
  const epgUrl = h('input.input', { value: ex.epgUrl || '', placeholder: 'Opcional: http://.../guia.xml(.gz)' });
  const tz = h('select.input');
  for (let i = -12; i <= 12; i++) tz.append(h('option', { value: i, selected: Number(ex.tzOffset || 0) === i }, i === 0 ? 'Sem ajuste' : `${i > 0 ? '+' : ''}${i} h`));
  const fileInput = h('input', { type: 'file', accept: '.m3u,.m3u8,.txt', style: { display: 'none' } });
  // só aparece quando o QR Code do celular estiver na tela
  const phoneHint = h('div.hint.hidden', 'Pelo celular: escaneie o QR Code acima e escolha “Lista IPTVKZ”.');
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

  const setServers = (main, extra) => {
    if (main) server.value = main;
    for (const x of extra || []) if (x !== mainServer() && !reserves.includes(x)) reserves.push(x);
  };
  // Editar uma lista Xtream: o servidor vira um seletor com os da conta (o em uso marcado), e a última opção,
  // "Adicionar servidor", abre a tela de Servidores
  const serverSel = existing && ex.type === 'xtream' ? h('select.input') : null;
  const fillSel = () => {
    const main = mainServer();
    serverSel.replaceChildren(...[main, ...serverLines()].map((s) => h('option', { value: s, selected: s === main }, s.replace(/^https?:\/\//, ''))),
      h('option', { value: '__add' }, '+ Adicionar servidor…'));
  };
  if (serverSel) {
    fillSel();
    serverSel.addEventListener('change', () => {
      const old = mainServer();
      if (serverSel.value === '__add') {
        fillSel(); // volta a mostrar o em uso
        const live = S.lists.find((l) => l.id === ex.id) || ex;
        openServers({ ...live, server: old, servers: serverLines() }, null, () => {
          const now = S.lists.find((l) => l.id === ex.id);
          if (now) {
            server.value = now.server;
            reserves.splice(0, reserves.length, ...parseServers((now.servers || []).join('\n')));
          }
          fillSel();
          setTimeout(() => focusEl(serverSel), 50);
        });
        return;
      }
      if (!reserves.includes(old)) reserves.push(old);
      server.value = serverSel.value;
    });
  }
  const panes = {
    xtream: h('div',
      serverSel ? field('Servidor', serverSel, 'O que está em uso. Escolha outro para trocar, ou “Adicionar servidor” para incluir mais.')
        : field('Servidor', server, 'Endereço com porta, como o provedor informou. Pode colar o link get.php inteiro.'),
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
  if (!existing) tabBtns.load = h('button', { type: 'button', onclick: () => setTab('load') }, ico('upload'), 'Lista IPTVKZ');
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
      if (!loadFile) return showErr(nativeTvApp() ? 'Use o QR Code acima com o celular e escolha “Lista IPTVKZ”.' : 'Escolha o arquivo da lista baixada.');
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
      Object.assign(list, { server: server.value.trim(), servers: serverLines(), username: user.value.trim(), password: pass.value });
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
