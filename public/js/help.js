// IPTVKZ: ajuda da landing. Respostas automáticas a partir das dúvidas abaixo, sem serviço externo,
// e um formulário simples que vira um chamado para a equipe. ES5, para rodar também em TVs antigas.
(function () {
  'use strict';

  var ISSUES = 'https://github.com/lucasyemz/iptvkz/issues/new';
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

  var TIPOS = [['erro', 'Algo deu errado'], ['sugestao', 'Sugestão'], ['duvida', 'Dúvida']];
  var AREAS = [['', 'Escolha uma opção'], ['instalacao', 'Instalação do app'], ['lista', 'Adicionar ou atualizar lista'], ['qr', 'QR Code e celular'], ['aovivo', 'TV ao vivo'], ['guia', 'Guia de programação'], ['filmes', 'Filmes'], ['series', 'Séries'], ['player', 'Player de vídeo'], ['historico', 'Continuar assistindo e Histórico'], ['favoritos', 'Favoritos e Minha lista'], ['busca', 'Busca'], ['config', 'Configurações'], ['pais', 'Controle dos pais'], ['backup', 'Baixar e carregar lista'], ['site', 'Este site'], ['outro', 'Outro']];
  var MOMENTOS = [['', 'Escolha uma opção'], ['abrir', 'Ao abrir o app'], ['carregar', 'Ao carregar a lista'], ['navegar', 'Ao navegar pelas telas'], ['iniciar', 'Ao iniciar um vídeo'], ['assistindo', 'Durante o vídeo'], ['trocar', 'Ao trocar de canal ou episódio'], ['salvar', 'Ao salvar uma configuração'], ['instalar', 'Ao instalar ou atualizar'], ['sempre', 'Acontece sempre'], ['outro', 'Outro']];
  var APARELHOS = [['', 'Escolha uma opção'], ['lg', 'TV LG'], ['atv', 'Android TV'], ['android', 'Celular Android'], ['win', 'Windows'], ['mac', 'macOS'], ['linux', 'Linux'], ['browser', 'Pelo navegador'], ['outro', 'Outro']];

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
  var toForm = el('button', { type: 'button', class: 'help__report', text: 'Não achei a resposta. Falar com a equipe', on: { click: function () { abrirForm(); } } });
  var tvNote = el('p', { class: 'help__tvnote', text: 'Para escrever para a equipe, abra iptvkz.kazamastudios.com.br no celular e toque em Ajuda.' });
  var chat = el('div', { class: 'help__view' }, [log, chips, ask, toForm, tvNote]);
  var formView = el('div', { class: 'help__view help__view--form', hidden: '' });

  var title = el('h2', { class: 'help__title', text: 'Ajuda do IPTVKZ' });
  var backBtn = el('button', { type: 'button', class: 'help__icon', 'aria-label': 'Voltar para as dúvidas', hidden: '', on: { click: function () { mostrarChat(); } } }, [icon('i-chevron-left')]);
  var closeBtn = el('button', { type: 'button', class: 'help__icon', 'aria-label': 'Fechar a ajuda', on: { click: function () { fechar(); } } }, [icon('i-x')]);
  var panel = el('section', { class: 'help__panel', role: 'dialog', 'aria-label': 'Ajuda do IPTVKZ', tabindex: '-1' }, [
    el('header', { class: 'help__head' }, [backBtn, title, closeBtn]), chat, formView,
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
      fala('Ainda não sei responder isso. Veja se uma destas dúvidas ajuda, ou fale com a equipe.', 'bot');
      opcoes(POPULARES);
      return;
    }
    responder(achados[0].i);
    var extra = achados.slice(1, 4).map(function (r) { return r.i; });
    opcoes(extra.length ? extra : POPULARES.filter(function (i) { return i !== achados[0].i; }).slice(0, 4));
  }

  // ---------- formulário ----------
  var form = null, abertoEm = 0;
  function seletor(nome, label, itens, inicial) {
    var select = el('select', { id: 'h-' + nome, name: nome, required: '' });
    itens.forEach(function (o) { select.appendChild(el('option', { value: o[0], text: o[1] })); });
    if (inicial) select.value = inicial;
    var outro = null, kids = [el('label', { for: 'h-' + nome, text: label }), select];
    if (itens.some(function (o) { return o[0] === 'outro'; })) {
      outro = el('input', { type: 'text', name: nome + 'Outro', maxlength: '80', placeholder: 'Conte qual', 'aria-label': label + ': qual?', hidden: '' });
      kids.push(outro);
      select.addEventListener('change', function () {
        var sim = select.value === 'outro';
        outro.hidden = !sim;
        if (sim) { outro.required = true; outro.focus(); } else { outro.required = false; outro.value = ''; }
      });
    }
    return el('div', { class: 'help__field' }, kids);
  }
  function montarForm(tipoInicial) {
    formView.textContent = '';
    abertoEm = Date.now();
    var status = el('p', { class: 'help__status', role: 'status' });
    var msg = el('textarea', { id: 'h-mensagem', name: 'mensagem', rows: '4', required: '', minlength: '10', maxlength: '3000', placeholder: 'Conte o que você fez e o que apareceu na tela' });
    var enviar = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Enviar para a equipe' });
    form = el('form', { class: 'help__form', novalidate: '', on: { submit: function (e) { e.preventDefault(); envio(status, enviar); } } }, [
      seletor('tipo', 'O que você quer contar?', TIPOS, tipoInicial || 'erro'),
      seletor('area', 'Em que parte do app?', AREAS),
      seletor('momento', 'Em que momento?', MOMENTOS),
      seletor('aparelho', 'Em qual aparelho?', APARELHOS, window.iptvkzDevice || ''),
      el('div', { class: 'help__field' }, [el('label', { for: 'h-versao', text: 'Versão do app (opcional, aparece no menu)' }), el('input', { id: 'h-versao', name: 'versao', type: 'text', maxlength: '30', autocomplete: 'off' })]),
      el('div', { class: 'help__field' }, [el('label', { for: 'h-mensagem', text: 'O que aconteceu?' }), msg]),
      el('div', { class: 'help__trap', 'aria-hidden': 'true' }, [el('label', { text: 'Empresa' }), el('input', { type: 'text', name: 'empresa', tabindex: '-1', autocomplete: 'off' })]),
      el('p', { class: 'help__privacy', text: 'Seu relato fica público para ajudar outras pessoas. Não escreva links, usuários ou senhas das suas listas.' }),
      status, enviar,
    ]);
    formView.appendChild(form);
  }
  function dados() {
    var d = { tempo: Date.now() - abertoEm };
    Array.prototype.forEach.call(form.elements, function (c) { if (c.name) d[c.name] = c.value; });
    return d;
  }
  function validar(d) {
    if (!d.area) return 'Escolha em que parte do app aconteceu.';
    if (!d.momento) return 'Escolha em que momento aconteceu.';
    if (!d.aparelho) return 'Escolha o aparelho.';
    if ((d.area === 'outro' && !d.areaOutro.trim()) || (d.momento === 'outro' && !d.momentoOutro.trim()) || (d.aparelho === 'outro' && !d.aparelhoOutro.trim())) return 'Preencha o campo “Outro”.';
    if (d.mensagem.trim().length < 10) return 'Conte um pouco mais do que aconteceu.';
    return '';
  }
  function linkReserva(d) {
    var pick = function (lista, v, outro) { var o = lista.filter(function (x) { return x[0] === v; })[0]; return v === 'outro' ? outro : (o ? o[1] : v); };
    var corpo = 'Onde: ' + pick(AREAS, d.area, d.areaOutro) + '\nQuando: ' + pick(MOMENTOS, d.momento, d.momentoOutro) + '\nAparelho: ' + pick(APARELHOS, d.aparelho, d.aparelhoOutro) + '\nVersão: ' + (d.versao || 'não informada') + '\n\n' + d.mensagem;
    return ISSUES + '?title=' + encodeURIComponent('[Suporte] ' + d.mensagem.slice(0, 60)) + '&body=' + encodeURIComponent(corpo.slice(0, 1500));
  }
  function envio(status, botao) {
    var d = dados(), erro = validar(d);
    status.className = 'help__status';
    status.textContent = erro;
    if (erro) { status.classList.add('is-bad'); return; }
    botao.disabled = true;
    status.textContent = 'Enviando…';
    fetch('/api/relato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then(function (r) {
      if (r.ok) return sucesso();
      throw new Error(String(r.status));
    }).catch(function (e) {
      botao.disabled = false;
      status.textContent = e.message === '429' ? 'Muitos envios em pouco tempo. Tente de novo em alguns minutos.' : 'Não foi possível enviar agora. Tente de novo em instantes ou ';
      status.classList.add('is-bad');
      if (e.message !== '429') status.appendChild(el('a', { href: linkReserva(d), target: '_blank', rel: 'noopener', text: 'envie pelo GitHub.' }));
    });
  }
  function sucesso() {
    formView.textContent = '';
    formView.appendChild(el('div', { class: 'help__done' }, [
      el('h3', { text: 'Recebemos, obrigado!' }),
      el('p', { text: 'Seu relato chegou à equipe e ajuda a melhorar o IPTVKZ para todo mundo.' }),
      el('button', { type: 'button', class: 'btn btn--ghost', text: 'Voltar para as dúvidas', on: { click: function () { mostrarChat(); } } }),
    ]));
  }

  // ---------- abrir e fechar ----------
  function mostrarChat() {
    formView.hidden = true; chat.hidden = false; backBtn.hidden = true;
    title.textContent = 'Ajuda do IPTVKZ';
  }
  function abrirForm(tipo) {
    if (isTv) return;
    montarForm(tipo);
    chat.hidden = true; formView.hidden = false; backBtn.hidden = false;
    title.textContent = 'Falar com a equipe';
    panel.scrollTop = 0;
  }
  var iniciado = false;
  function abrir(modo) {
    if (!iniciado) {
      iniciado = true;
      fala('Oi! Sou o assistente automático do IPTVKZ. Escreva sua dúvida ou escolha uma opção.', 'bot');
      opcoes(POPULARES);
    }
    if (modo === 'form') abrirForm(); else mostrarChat();
    panel.classList.add('is-open');
    fab.setAttribute('aria-expanded', 'true');
    var alvo = isTv ? chips.firstChild : (matchMedia('(hover: hover) and (pointer: fine)').matches && modo !== 'form' ? input : panel);
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
  Array.prototype.forEach.call(document.querySelectorAll('[data-help-open]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); abrir(a.getAttribute('data-help-open')); });
  });
})();
