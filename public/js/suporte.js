// IPTVKZ: formulário da página de suporte. Envia para /api/relato, que abre o chamado para a equipe.
(function () {
  'use strict';

  var EMAIL = 'suporte@kazamastudios.com.br';
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
    var d = { tempo: Date.now() - abertoEm };
    Array.prototype.forEach.call(form.elements, function (c) { if (c.name) d[c.name] = c.value; });
    return d;
  }
  function validar(d) {
    if (!d.area) return ['area', 'Escolha em que parte do app aconteceu.'];
    if (d.area === 'outro' && !d.areaOutro.trim()) return ['areaOutro', 'Conte em que parte do app aconteceu.'];
    if (!d.momento) return ['momento', 'Escolha em que momento aconteceu.'];
    if (d.momento === 'outro' && !d.momentoOutro.trim()) return ['momentoOutro', 'Conte em que momento aconteceu.'];
    if (!d.aparelho) return ['aparelho', 'Escolha o aparelho.'];
    if (d.aparelho === 'outro' && !d.aparelhoOutro.trim()) return ['aparelhoOutro', 'Conte qual é o aparelho.'];
    if (d.mensagem.trim().length < 10) return ['mensagem', 'Conte um pouco mais do que aconteceu.'];
    return null;
  }
  function texto(nome, d) {
    var s = form.elements[nome];
    return s.value === 'outro' ? d[nome + 'Outro'] : s.options[s.selectedIndex].text;
  }
  function linkReserva(d) {
    var corpo = 'Onde: ' + texto('area', d) + '\nQuando: ' + texto('momento', d) + '\nAparelho: ' + texto('aparelho', d) + '\nVersão: ' + (d.versao || 'não informada') + '\n\n' + d.mensagem;
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('[Suporte] ' + d.mensagem.slice(0, 60)) + '&body=' + encodeURIComponent(corpo.slice(0, 1500));
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
    status.textContent = 'Enviando…';
    fetch('/api/relato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      form.hidden = true;
      done.hidden = false;
      window.scrollTo(0, 0);
      done.focus();
    }).catch(function (err) {
      botao.disabled = false;
      if (err.message === '429') return mostrarErro('Muitos envios em pouco tempo. Tente de novo em alguns minutos.');
      mostrarErro('Não foi possível enviar agora. Tente de novo em instantes ou ');
      var a = document.createElement('a');
      a.href = linkReserva(d);
      a.textContent = 'envie por e-mail.';
      status.appendChild(a);
    });
  });
})();
