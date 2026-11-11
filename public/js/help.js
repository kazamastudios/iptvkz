// IPTVKZ: ajuda da landing. Respostas automáticas a partir das dúvidas abaixo, sem serviço externo.
// O que não resolver vai para a página de suporte. ES5, para rodar também em TVs antigas.
(function () {
  'use strict';

  var root = document.documentElement;
  var isTv = root.classList.contains('tv');

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

  var STOP = ' a o as os de da do das dos e em no na nos nas um uma uns umas que para pra por com como meu minha eu me se ja nao esta estou tem ter ta to e isso esse essa ai la '.split(' ').reduce(function (m, w) { if (w) m[w] = 1; return m; }, {});
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
    u.setAttribute('href', 'images/icons.svg#' + id);
    s.appendChild(u);
    return s;
  }

  // ---------- estrutura ----------
  var log = el('div', { class: 'help__log', 'aria-live': 'polite' });
  var chips = el('div', { class: 'help__chips' });
  var input = el('input', { class: 'help__input', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Escreva sua dúvida', 'aria-label': 'Sua dúvida' });
  var ask = el('form', { class: 'help__ask', on: { submit: function (e) { e.preventDefault(); perguntar(input.value); } } }, [input, el('button', { class: 'btn btn--primary', type: 'submit', text: 'Enviar' })]);
  var toForm = el('a', { class: 'help__report', href: 'suporte.html', text: 'Não achei a resposta. Falar com a equipe' });
  var tvNote = el('p', { class: 'help__tvnote', text: 'Para escrever para a equipe, abra iptvkz.kazamastudios.com.br/suporte.html no celular.' });
  var chat = el('div', { class: 'help__view' }, [log, chips, ask, toForm, tvNote]);

  var title = el('h2', { class: 'help__title', text: 'Ajuda do IPTVKZ' });
  var closeBtn = el('button', { type: 'button', class: 'help__icon', 'aria-label': 'Fechar a ajuda', on: { click: function () { fechar(); } } }, [icon('i-x')]);
  var panel = el('section', { class: 'help__panel', role: 'dialog', 'aria-label': 'Ajuda do IPTVKZ', tabindex: '-1' }, [
    el('header', { class: 'help__head' }, [title, closeBtn]), chat,
  ]);
  var fab = el('button', { type: 'button', class: 'help__fab', 'aria-expanded': 'false', on: { click: function () { panel.classList.contains('is-open') ? fechar() : abrir(); } } }, [icon('i-message'), el('span', { text: 'Ajuda' })]);
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
      var b = fala('Ainda não sei responder isso. Veja se uma destas dúvidas ajuda, ou ', 'bot');
      if (!isTv) b.appendChild(el('a', { href: 'suporte.html', text: 'fale com a equipe.' }));
      else b.textContent = 'Ainda não sei responder isso. Veja se uma destas dúvidas ajuda.';
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
      fala('Oi! Sou o assistente automático do IPTVKZ. Escreva sua dúvida ou escolha uma opção.', 'bot');
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
