// IPTVKZ: animações da landing (GSAP + ScrollTrigger) e rolagem suave no PC e no celular.
// Tudo aqui é enfeite. Na TV e com "reduzir movimento" este arquivo nem é carregado.
// A rolagem continua sendo a nativa da janela: nada de mover a página inteira por transform.
(function () {
  'use strict';
  var root = document.documentElement;
  var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  if (!gsap || !ScrollTrigger) { root.classList.remove('motion'); return; }
  gsap.registerPlugin(ScrollTrigger);
  root.classList.add('motion-ready');

  // ---------- entrada do topo ----------
  gsap.fromTo('.topbar', { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', clearProps: 'transform' });
  gsap.fromTo('.hero__text > *', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.09, ease: 'power3.out', delay: 0.05 });
  gsap.fromTo('.hero__stage', { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 1.05, ease: 'power3.out', delay: 0.2 });

  // ---------- topo some aos poucos ao rolar ----------
  gsap.to('.hero__text', { yPercent: -10, opacity: 0.1, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 15%', scrub: 0.4 } });
  gsap.to('.hero__stage .frame', { y: -36, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 } });

  // ---------- fade in ao entrar, fade out ao sair ----------
  var targets = gsap.utils.toArray('.promise, .head, .card, .free, .section--tight .h-small, .platform, .gallery, .rec, .others, .warn, .open, #duvidas .h-small, .faq details');
  targets = targets.filter(function (el) { return !el.closest('.open') || el.classList.contains('open'); });
  gsap.set(targets, { opacity: 0, y: 26 });
  ScrollTrigger.batch(targets, {
    start: 'top 92%',
    end: 'bottom 7%',
    interval: 0.08,
    onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: 0.7, stagger: 0.07, ease: 'power3.out', overwrite: true }); },
    onEnterBack: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: 0.55, stagger: 0.04, ease: 'power3.out', overwrite: true }); },
    onLeave: function (b) { gsap.to(b, { opacity: 0, y: -20, duration: 0.45, ease: 'power2.in', overwrite: true }); },
    onLeaveBack: function (b) { gsap.to(b, { opacity: 0, y: 26, duration: 0.4, ease: 'power2.in', overwrite: true }); },
  });

  // "Outros aparelhos" muda a altura da página
  var others = document.querySelector('#outros');
  if (others) others.addEventListener('toggle', function () { ScrollTrigger.refresh(); });

  // ---------- rolagem suave ----------
  var target = window.pageYOffset, pos = target, running = false, last = 0, speed = 9;
  var maxY = function () { return Math.max(0, document.documentElement.scrollHeight - window.innerHeight); };
  function step(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    pos += (target - pos) * (1 - Math.exp(-speed * dt));
    if (Math.abs(target - pos) < 0.5) { pos = target; running = false; }
    window.scrollTo(0, pos);
    if (running) requestAnimationFrame(step);
  }
  function start(s) {
    speed = s;
    if (running) return;
    pos = window.pageYOffset;
    running = true;
    last = performance.now();
    requestAnimationFrame(step);
  }
  function stop() { running = false; target = pos = window.pageYOffset; }

  // teclado, barra de rolagem e toque continuam nativos: só acompanhamos a posição
  window.addEventListener('scroll', function () { if (!running) target = pos = window.pageYOffset; }, { passive: true });
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('keydown', function (e) { if (e.keyCode >= 32 && e.keyCode <= 40) stop(); });

  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      target = Math.max(0, Math.min(maxY(), target + e.deltaY * unit));
      start(9);
    }, { passive: false });
  }

  // links internos deslizam até a seção
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains('skip') || e.defaultPrevented) return;
    var id = a.getAttribute('href').slice(1);
    var el = id && document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    requestAnimationFrame(function () {
      var y = id === 'topo' ? 0 : el.getBoundingClientRect().top + window.pageYOffset - 84;
      target = Math.max(0, Math.min(maxY(), y));
      start(5);
      if (history.pushState) history.pushState(null, '', '#' + id);
    });
  });
})();
