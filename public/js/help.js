// IPTVKZ: ajuda da landing. Respostas automáticas a partir das dúvidas abaixo, sem serviço externo.
// O que não resolver vai para a página de suporte. ES5, para rodar também em TVs antigas.
(function () {
  'use strict';

  var root = document.documentElement;
  var isTv = root.classList.contains('tv');
  var EN = /^en/i.test(root.getAttribute('lang') || '');
  var T = function (pt, en) { return EN ? en : pt; };
  var me = document.querySelector('script[src$="js/help.js"]');
  var BASE = me ? me.getAttribute('src').replace(/js\/help\.js$/, '') : '';
  var SUPPORT = T('suporte.html', 'support.html');

  var FAQ = [
    { t: 'É grátis mesmo?', k: ['gratis', 'de graca', 'preco', 'pagar', 'pago', 'custa', 'mensalidade', 'assinatura', 'premium', 'anuncio'], a: 'Sim. O IPTVKZ não cobra mensalidade, não mostra anúncio, não pede cadastro e não tem versão paga.' },
    { t: 'O app vem com canais?', k: ['vem com canais', 'canais incluidos', 'tem canais', 'onde consigo lista', 'comprar lista', 'vende lista', 'conteudo', 'nao tem nada', 'vazio'], a: 'Não. O IPTVKZ é só o player e vem vazio. Você adiciona as listas M3U ou Xtream que já tem, e só deve usar conteúdo que tem direito de assistir. Não vendemos nem indicamos listas.' },
    { t: 'Como adiciono uma lista?', k: ['adicionar lista', 'colocar lista', 'cadastrar lista', 'nova lista', 'lista m3u', 'xtream', 'm3u', 'como comeco'], a: 'Abra “Adicionar lista” e escolha Xtream Codes, Link M3U ou Arquivo M3U. Na TV, o caminho mais fácil é escanear o QR Code e preencher pelo celular.' },
    { t: 'O QR Code não funciona', k: ['qr', 'qr code', 'qrcode', 'escanear', 'camera', 'nao abre no celular', 'celular nao conecta', 'codigo nao vale', 'parear', 'vincular'], a: 'Confira se o celular está no mesmo Wi-Fi da TV. O código vale 15 minutos e só uma vez: se aparecer “Este código não vale mais”, abra “Adicionar lista” na TV de novo. O QR Code existe nos apps de LG e Android TV.' },
    { t: 'O vídeo ou canal não abre', k: ['nao abre', 'nao carrega', 'nao toca', 'nao funciona', 'tela preta', 'travando', 'trava', 'carregando', 'erro no video', 'canal fora', 'sem imagem', 'buffer'], a: 'Primeiro teste outro canal ou filme. Se só um falhar, o problema costuma estar nesse item da lista. Se nada abrir, confira a validade da lista com quem a forneceu. No computador, “Abrir no VLC” ajuda com formatos que o navegador não toca.' },
    { t: 'Áudio e legendas', k: ['legenda', 'legendas', 'audio', 'dublado', 'legendado', 'idioma', 'srt', 'vtt', 'sem som'], a: 'Durante o vídeo, abra as opções do player para trocar o áudio e as legendas. No computador, você também pode carregar um arquivo .srt ou .vtt e ajustar atraso, tamanho e fundo. Dublado e legendado do mesmo título ficam em um cartão só.' },
    { t: 'O guia está vazio', k: ['guia', 'epg', 'programacao', 'xmltv', 'horario errado', 'fuso', 'agora a seguir'], a: 'O guia depende do XMLTV da sua lista. Em Xtream ele costuma vir junto. Em M3U, informe o endereço do guia ao editar a lista. Se os horários estiverem errados, ajuste o fuso nessa mesma tela.' },
    { t: 'Como instalo na TV LG?', k: ['lg', 'webos', 'ipk', 'instalar na lg', 'tv lg', 'developer mode', 'modo desenvolvedor'], a: 'Até a loja aprovar, a instalação é feita pelo computador, com o Developer Mode da LG e uma conta LG Developer. A sessão precisa ser renovada de tempos em tempos. Funciona no webOS 4 ou mais novo. O passo a passo está na área de download.', link: '#download', linkText: 'Ver download' },
    { t: 'Como instalo no Android TV?', k: ['android tv', 'google tv', 'tv box', 'mecool', 'downloader', 'apk', 'fontes desconhecidas'], a: 'Baixe o APK na área de download, por exemplo com o app Downloader, permita fontes desconhecidas e instale. O mesmo arquivo serve para o celular Android, que usa o app com a tela deitada.', link: '#download', linkText: 'Ver download' },
    { t: 'O Windows bloqueou a instalação', k: ['windows', 'protegeu', 'smartscreen', 'antivirus', 'virus', 'bloqueou', 'nao instala', 'mac', 'macos', 'nao abre no mac'], a: 'O instalador ainda não tem assinatura digital. No Windows, clique em Mais informações e Executar assim mesmo. No macOS, clique com o botão direito no app e escolha Abrir duas vezes.' },
    { t: 'Funciona no iPhone ou em outra TV?', k: ['iphone', 'ipad', 'ios', 'samsung', 'tizen', 'roku', 'outra tv', 'philips', 'navegador', 'computador ligado', 'pc ligado'], a: 'Sim, pelo navegador. No app de computador, abra Configurações, TV e outros aparelhos e Permitir acesso pela rede de casa. Depois acesse o endereço mostrado. Nesse caso o computador precisa ficar ligado. Nos apps de LG, Android TV e Android, não precisa.' },
    { t: 'Como atualizo o app?', k: ['atualizar', 'atualizacao', 'versao nova', 'update', 'nova versao'], a: 'Na LG e no Android TV, o app confere a versão mais recente ao abrir e se atualiza sozinho. Quando a parte nativa muda, o Android oferece o APK novo e, na LG, é preciso instalar o .ipk novo. No computador, baixe a versão nova no site.' },
    { t: 'Controle dos pais', k: ['pin', 'pais', 'adulto', 'bloquear', 'criancas', 'senha do conteudo'], a: 'Em Configurações, crie um PIN de 4 dígitos. Ele esconde canais, filmes e séries adultos em todos os aparelhos, detectados pelo nome ou marcados por você.' },
    { t: 'Levar a lista para outro aparelho', k: ['backup', 'outro aparelho', 'trocar de tv', 'transferir', 'restaurar', 'baixar lista', 'carregar lista', 'reinstalar', 'perdi'], a: 'Em Configurações, “Baixar lista” gera um arquivo com a lista, os favoritos e o histórico. No outro aparelho, abra “Adicionar lista” e use “Carregar lista”. O arquivo contém a senha da lista: guarde com cuidado.' },
    { t: 'O que são os dois visuais?', k: ['visual', 'classica', 'classico', 'streaming', 'aparencia', 'trocar visual', 'layout'], a: 'O Visual Clássico mostra a grade de capas e categorias. O Visual Streaming mostra um destaque grande com fileiras de cards. Você troca nos botões ao lado da busca, em cada aparelho.' },
  ];
  var POPULARES = [4, 3, 2, 5, 7, 0];

  if (EN) {
    FAQ = [
      { t: 'Is it really free?', k: ['free', 'price', 'pay', 'paid', 'cost', 'costs', 'subscription', 'premium', 'ads', 'catch'], a: 'Yes. IPTVKZ has no subscription, no ads, no sign-up and no paid version.' },
      { t: 'Does the app come with channels?', k: ['come with channels', 'channels included', 'has channels', 'where to get lists', 'buy list', 'sell lists', 'content', 'empty', 'nothing'], a: 'No. IPTVKZ is only the player and comes empty. You add the M3U or Xtream lists you already have, and should only use content you have the right to watch. We do not sell or recommend lists.' },
      { t: 'How do I add a list?', k: ['add list', 'add a list', 'new list', 'set up list', 'm3u', 'xtream', 'playlist', 'get started', 'start'], a: 'Open “Adicionar lista” (Add list) and choose Xtream Codes, M3U link or M3U file. On the TV, the easiest way is to scan the QR Code and fill it in on your phone.' },
      { t: 'The QR Code does not work', k: ['qr', 'qr code', 'qrcode', 'scan', 'camera', 'phone not connecting', 'code expired', 'pair', 'link phone'], a: 'Make sure the phone is on the same Wi-Fi as the TV. The code is valid for 15 minutes and works only once: if you see that the code is no longer valid, open “Adicionar lista” on the TV again. The QR Code is available in the LG and Android TV apps.' },
      { t: 'A video or channel does not play', k: ['not playing', 'not loading', 'does not play', 'not working', 'black screen', 'freezing', 'freezes', 'loading', 'video error', 'channel down', 'no picture', 'buffering', 'buffer'], a: 'First try another channel or movie. If only one fails, the problem is usually that item in the list. If nothing plays, check that the list is still valid with whoever provided it. On the computer, “Abrir no VLC” (Open in VLC) helps with formats the browser cannot play.' },
      { t: 'Audio and subtitles', k: ['subtitle', 'subtitles', 'captions', 'audio', 'dubbed', 'language track', 'srt', 'vtt', 'no sound'], a: 'During playback, open the player options to change the audio and subtitles. On the computer you can also load an .srt or .vtt file and adjust delay, size and background. Dubbed and subtitled versions of the same title share a single card.' },
      { t: 'The guide is empty', k: ['guide', 'epg', 'schedule', 'xmltv', 'wrong time', 'time zone', 'timezone', 'now next'], a: 'The guide depends on your list’s XMLTV. Xtream lists usually include it. For M3U, enter the guide address when editing the list. If the times are wrong, adjust the time zone on that same screen.' },
      { t: 'How do I install on an LG TV?', k: ['lg', 'webos', 'ipk', 'install on lg', 'lg tv', 'developer mode'], a: 'Until the store approves it, installation is done from a computer, using LG’s Developer Mode and an LG Developer account. The session must be renewed from time to time. It works on webOS 4 or newer. The steps are in the download area.', link: '#download', linkText: 'See download' },
      { t: 'How do I install on Android TV?', k: ['android tv', 'google tv', 'tv box', 'mecool', 'downloader', 'apk', 'unknown sources'], a: 'Download the APK from the download area, for example with the Downloader app, allow unknown sources and install it. The same file works on Android phones, which use the app in landscape.', link: '#download', linkText: 'See download' },
      { t: 'Windows blocked the installation', k: ['windows', 'protected', 'smartscreen', 'antivirus', 'virus', 'blocked', 'will not install', 'mac', 'macos', 'will not open on mac'], a: 'The installer does not have a digital signature yet. On Windows, click More info and then Run anyway. On macOS, right-click the app and choose Open twice.' },
      { t: 'Does it work on iPhone or another TV?', k: ['iphone', 'ipad', 'ios', 'samsung', 'tizen', 'roku', 'other tv', 'philips', 'browser', 'computer on', 'pc on'], a: 'Yes, in the browser. In the desktop app, open Configurações › TV e outros aparelhos › Permitir acesso pela rede de casa, then open the address shown. In this case the computer must stay on. The LG, Android TV and Android apps do not need it.' },
      { t: 'How do I update the app?', k: ['update', 'updates', 'new version', 'upgrade', 'latest version'], a: 'On LG and Android TV, the app checks for the latest version when it opens and updates itself. When the native part changes, Android offers the new APK and, on LG, you need to install the new .ipk. On the computer, download the new version from this site.' },
      { t: 'Parental control', k: ['pin', 'parental', 'parents', 'adult', 'block', 'kids', 'children'], a: 'In Configurações (Settings), create a 4-digit PIN. It hides adult channels, movies and series on every device, detected by name or marked by you.' },
      { t: 'Move my list to another device', k: ['backup', 'another device', 'new tv', 'transfer', 'restore', 'export', 'import', 'reinstall', 'lost'], a: 'In Configurações (Settings), “Baixar lista” creates a file with the list, favorites and history. On the other device, open “Adicionar lista” and use “Carregar lista”. The file contains the list password: keep it safe.' },
      { t: 'What are the two views?', k: ['view', 'views', 'classic', 'streaming', 'look', 'layout', 'appearance'], a: 'The Classic view shows a grid of posters and categories. The Streaming view shows a large spotlight with rows of cards. Switch with the buttons next to search, on each device.' },
      { t: 'What language is the app in?', k: ['language', 'english', 'portuguese', 'translate', 'translation', 'spanish'], a: 'The app interface is in Brazilian Portuguese for now. Lists in any language work, and audio and subtitle tracks come from what your list provides.' },
    ];
    POPULARES = [4, 3, 2, 15, 7, 0];
  }

  var STOP = (EN ? ' a an the to of in on at for with my i im is it its do does did how what why can my me this that there be are was not dont doesnt isnt ' : ' a o as os de da do das dos e em no na nos nas um uma uns umas que para pra por com como meu minha eu me se ja nao esta estou tem ter ta to e isso esse essa ai la ').split(' ').reduce(function (m, w) { if (w) m[w] = 1; return m; }, {});
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function buscar(texto) {
    var q = norm(texto), ws = q.split(' ').filter(function (w) { return w && !STOP[w]; });
    return FAQ.map(function (f, i) {
      var s = 0;
      f.k.forEach(function (k) {
        if ((' ' + q + ' ').indexOf(' ' + k + ' ') >= 0) s += k.split(' ').length * 3;
        else ws.forEach(function (w) { if (w.length > 2 && k.split(' ').indexOf(w) >= 0) s += 1; });
      });
      return { i: i, s: s };
    }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s; });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (e) { n.addEventListener(e, attrs.on[e]); });
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function icon(id) {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), u = document.createElementNS(ns, 'use');
    s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
    u.setAttribute('href', BASE + 'images/icons.svg#' + id);
    s.appendChild(u);
    return s;
  }

  // ---------- estrutura ----------
  var log = el('div', { class: 'help__log', 'aria-live': 'polite' });
  var chips = el('div', { class: 'help__chips' });
  var input = el('input', { class: 'help__input', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: T('Escreva sua dúvida', 'Type your question'), 'aria-label': T('Sua dúvida', 'Your question') });
  var ask = el('form', { class: 'help__ask', on: { submit: function (e) { e.preventDefault(); perguntar(input.value); } } }, [input, el('button', { class: 'btn btn--primary', type: 'submit', text: T('Enviar', 'Send') })]);
  var toForm = el('a', { class: 'help__report', href: SUPPORT, text: T('Não achei a resposta. Falar com a equipe', 'Couldn’t find the answer? Talk to the team') });
  var tvNote = el('p', { class: 'help__tvnote', text: T('Para falar com a equipe, escreva para suporte@kazamastudios.com.br ou abra iptvkz.kazamastudios.com.br/suporte.html no celular.', 'To talk to the team, write to suporte@kazamastudios.com.br or open iptvkz.kazamastudios.com.br/en/support.html on your phone.') });
  var chat = el('div', { class: 'help__view' }, [log, chips, ask, toForm, tvNote]);

  var title = el('h2', { class: 'help__title', text: T('Ajuda do IPTVKZ', 'IPTVKZ Help') });
  var closeBtn = el('button', { type: 'button', class: 'help__icon', 'aria-label': T('Fechar a ajuda', 'Close help'), on: { click: function () { fechar(); } } }, [icon('i-x')]);
  var panel = el('section', { class: 'help__panel', role: 'dialog', 'aria-label': T('Ajuda do IPTVKZ', 'IPTVKZ Help'), tabindex: '-1' }, [
    el('header', { class: 'help__head' }, [title, closeBtn]), chat,
  ]);
  var fab = el('button', { type: 'button', class: 'help__fab', 'aria-expanded': 'false', on: { click: function () { panel.classList.contains('is-open') ? fechar() : abrir(); } } }, [icon('i-message'), el('span', { text: T('Ajuda', 'Help') })]);
  document.body.appendChild(el('div', { class: 'help' }, [panel, fab]));

  // ---------- conversa ----------
  function fala(texto, quem) {
    var b = el('p', { class: 'help__msg help__msg--' + quem, text: texto });
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  function opcoes(lista) {
    chips.textContent = '';
    lista.forEach(function (i) {
      chips.appendChild(el('button', { type: 'button', class: 'help__chip', text: FAQ[i].t, on: { click: function () { perguntar(FAQ[i].t, i); } } }));
    });
    log.scrollTop = log.scrollHeight;
  }
  function responder(i) {
    var f = FAQ[i];
    var b = fala(f.a, 'bot');
    if (f.link) {
      b.appendChild(document.createTextNode(' '));
      b.appendChild(el('a', { href: f.link, text: f.linkText, on: { click: function () { fechar(); } } }));
    }
  }
  function perguntar(texto, direto) {
    texto = String(texto).trim();
    if (!texto) return;
    input.value = '';
    fala(texto, 'user');
    if (direto !== undefined) {
      responder(direto);
      opcoes(POPULARES.filter(function (i) { return i !== direto; }).slice(0, 4));
      return;
    }
    var achados = buscar(texto);
    if (!achados.length) {
      var b = fala(T('Ainda não sei responder isso. Veja se uma destas dúvidas ajuda, ou ', 'I can’t answer that yet. See if one of these questions helps, or '), 'bot');
      if (!isTv) b.appendChild(el('a', { href: SUPPORT, text: T('fale com a equipe.', 'talk to the team.') }));
      else b.textContent = T('Ainda não sei responder isso. Veja se uma destas dúvidas ajuda.', 'I can’t answer that yet. See if one of these questions helps.');
      opcoes(POPULARES);
      return;
    }
    responder(achados[0].i);
    var extra = achados.slice(1, 4).map(function (r) { return r.i; });
    opcoes(extra.length ? extra : POPULARES.filter(function (i) { return i !== achados[0].i; }).slice(0, 4));
  }

  // ---------- abrir e fechar ----------
  var iniciado = false;
  function abrir() {
    if (!iniciado) {
      iniciado = true;
      fala(T('Oi! Sou o assistente automático do IPTVKZ. Escreva sua dúvida ou escolha uma opção.', 'Hi! I’m the IPTVKZ automatic assistant. Type your question or pick an option.'), 'bot');
      opcoes(POPULARES);
    }
    panel.classList.add('is-open');
    fab.setAttribute('aria-expanded', 'true');
    var alvo = isTv ? chips.firstChild : (matchMedia('(hover: hover) and (pointer: fine)').matches ? input : panel);
    if (alvo) alvo.focus();
  }
  function fechar() {
    panel.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (panel.classList.contains('is-open') && (e.keyCode === 27 || e.keyCode === 461)) { e.preventDefault(); fechar(); }
  });
})();
