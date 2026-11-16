// IPTVKZ: formulário da página de suporte. Envia para /api/relato, que abre o chamado para a equipe.
(function () {
  'use strict';

  var EMAIL = 'suporte@kazamastudios.com.br';
  var EN = /^en/i.test(document.documentElement.getAttribute('lang') || '');
  var T = function (pt, en) { return EN ? en : pt; };
  var form = document.querySelector('[data-support-form]');
  var tvNote = document.querySelector('[data-support-tv]');
  var done = document.querySelector('[data-support-done]');
  var status = document.querySelector('[data-support-status]');
  var botao = document.querySelector('[data-support-send]');
  var abertoEm = Date.now();

  form.hidden = false;
  if (window.iptvkzIsTv) { form.hidden = true; tvNote.hidden = false; return; }

  var aparelho = form.elements.aparelho;
  if (window.iptvkzDevice) aparelho.value = window.iptvkzDevice;

  // Vindo do botão "Relatar problema" do app: aparelho, versão, parte do app e tipo do erro já preenchidos.
  // Só valores conhecidos entram (nada da lista do usuário vem no endereço). Quem escaneou o QR Code da TV está no
  // celular: o aparelho do relato é o que o app mandou, não o detectado aqui.
  var ERROS = {
    'sem-internet': T('Sem internet', 'No internet'),
    'acesso-recusado': T('O provedor não aceitou o acesso', 'The provider refused access'),
    'endereco': T('Endereço da lista não encontrado', 'List address not found'),
    'servidor': T('O servidor da lista não respondeu', 'The list server did not respond'),
    'lista': T('Não foi possível carregar a lista', 'Could not load the list'),
  };
  var inicial = '';
  (function () {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (q.get('de') !== 'app') return;
    ['tipo', 'aparelho', 'area', 'momento'].forEach(function (nome) {
      var v = q.get(nome), sel = form.elements[nome];
      if (v && v !== 'outro' && Array.prototype.some.call(sel.options, function (o) { return o.value === v; })) sel.value = v;
    });
    var versao = (q.get('versao') || '').replace(/[^\w .·-]/g, '').slice(0, 30);
    if (versao) form.elements.versao.value = versao;
    var erro = ERROS[q.get('erro')];
    if (erro) {
      inicial = T('Apareceu no app: “', 'The app showed: “') + erro + '”.\n\n';
      form.elements.mensagem.value = inicial;
    }
  })();

  // "Outro" abre um campo e passa a exigir o preenchimento
  ['area', 'momento', 'aparelho'].forEach(function (nome) {
    var select = form.elements[nome], outro = form.elements[nome + 'Outro'];
    select.addEventListener('change', function () {
      var sim = select.value === 'outro';
      outro.hidden = !sim;
      if (sim) outro.focus(); else outro.value = '';
    });
  });

  function dados() {
    var d = { tempo: Date.now() - abertoEm, lang: EN ? 'en' : 'pt' };
    Array.prototype.forEach.call(form.elements, function (c) { if (c.name) d[c.name] = c.value; });
    return d;
  }
  function validar(d) {
    if (!d.area) return ['area', T('Escolha em que parte do app aconteceu.', 'Choose which part of the app it happened in.')];
    if (d.area === 'outro' && !d.areaOutro.trim()) return ['areaOutro', T('Conte em que parte do app aconteceu.', 'Tell us which part of the app it happened in.')];
    if (!d.momento) return ['momento', T('Escolha em que momento aconteceu.', 'Choose when it happened.')];
    if (d.momento === 'outro' && !d.momentoOutro.trim()) return ['momentoOutro', T('Conte em que momento aconteceu.', 'Tell us when it happened.')];
    if (!d.aparelho) return ['aparelho', T('Escolha o aparelho.', 'Choose the device.')];
    if (d.aparelho === 'outro' && !d.aparelhoOutro.trim()) return ['aparelhoOutro', T('Conte qual é o aparelho.', 'Tell us which device.')];
    if (d.mensagem.trim().length < 10 || (inicial && d.mensagem.trim() === inicial.trim())) return ['mensagem', T('Conte um pouco mais do que aconteceu.', 'Tell us a bit more about what happened.')];
    return null;
  }
  function texto(nome, d) {
    var s = form.elements[nome];
    return s.value === 'outro' ? d[nome + 'Outro'] : s.options[s.selectedIndex].text;
  }
  function linkReserva(d) {
    var corpo = T('Onde: ', 'Where: ') + texto('area', d) + T('\nQuando: ', '\nWhen: ') + texto('momento', d) + T('\nAparelho: ', '\nDevice: ') + texto('aparelho', d) + T('\nVersão: ', '\nVersion: ') + (d.versao || T('não informada', 'not provided')) + '\n\n' + d.mensagem;
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(T('[Suporte] ', '[Support] ') + d.mensagem.slice(0, 60)) + '&body=' + encodeURIComponent(corpo.slice(0, 1500));
  }
  function mostrarErro(msg) {
    status.className = 'form-status is-bad';
    status.textContent = msg;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = dados(), erro = validar(d);
    if (erro) { mostrarErro(erro[1]); form.elements[erro[0]].focus(); return; }
    botao.disabled = true;
    status.className = 'form-status';
    status.textContent = T('Enviando…', 'Sending…');
    fetch('/api/relato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      form.hidden = true;
      done.hidden = false;
      window.scrollTo(0, 0);
      done.focus();
    }).catch(function (err) {
      botao.disabled = false;
      if (err.message === '429') return mostrarErro(T('Muitos envios em pouco tempo. Tente de novo em alguns minutos.', 'Too many messages in a short time. Please try again in a few minutes.'));
      mostrarErro(T('Não foi possível enviar agora. Tente de novo em instantes ou ', 'We could not send it right now. Try again in a moment or '));
      var a = document.createElement('a');
      a.href = linkReserva(d);
      a.textContent = T('envie por e-mail.', 'send it by e-mail.');
      status.appendChild(a);
    });
  });
})();
