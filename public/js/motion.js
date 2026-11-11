// IPTVKZ — animações da landing page (GSAP + ScrollTrigger, e Three.js no hero).
// Tudo aqui é enfeite: sem este arquivo, ou com "reduzir movimento" ligado, a página
// continua completa e estática.
(function () {
  'use strict';
  var root = document.documentElement;
  var HERO_GL = new URL('hero-gl.js', document.currentScript.src).href;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;
  if (reduce || !gsap || !ScrollTrigger) { root.classList.remove('motion'); return; }
  gsap.registerPlugin(ScrollTrigger);

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var desktop = matchMedia('(min-width: 768px)').matches;

  // Quebra um título em palavras (preservando <span class="accent"> etc.) para subirem uma a uma.
  function splitWords(el) {
    if (!el || el.dataset.split) return [];
    el.dataset.split = '1';
    var out = [];
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.textContent.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          parts.forEach(function (t) {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.appendChild(document.createTextNode(t)); return; }
            var w = document.createElement('span'); w.className = 'w';
            var i = document.createElement('span'); i.className = 'wi'; i.textContent = t;
            w.appendChild(i); frag.appendChild(w); out.push(i);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    })(el);
    return out;
  }

  // ---------- barra de progresso de leitura ----------
  var bar = document.createElement('div');
  bar.className = 'progress'; bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

  // ---------- hero: entrada ----------
  var hero = $('.hero');
  var h1Words = splitWords($('#hero-titulo'));
  var shot = $('.hero__shot');
  var intro = gsap.timeline({ defaults: { ease: 'power4.out' } });
  intro
    .fromTo('.topbar', { autoAlpha: 0, y: -24 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0)
    .fromTo('.hero .eyebrow', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.1)
    .set('#hero-titulo', { autoAlpha: 1 }, 0.15)
    .fromTo(h1Words, { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.1, stagger: 0.07 }, 0.15)
    .fromTo('.hero .lead', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.55)
    .fromTo('.hero .cta .btn', { autoAlpha: 0, y: 20, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.8, stagger: 0.08 }, 0.7)
    .fromTo('.hero .platforms li', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.05 }, 0.85)
    .fromTo(shot, { autoAlpha: 0, y: 140, rotationX: 32, scale: 0.86 },
      { autoAlpha: 1, y: 0, rotationX: 16, scale: 0.94, duration: 1.6, ease: 'expo.out' }, 0.55);

  // TV "deita" na tela conforme a rolagem
  gsap.fromTo(shot, { rotationX: 16, scale: 0.94 }, {
    rotationX: 0, scale: 1, ease: 'none', immediateRender: false,
    scrollTrigger: { trigger: '.hero__stage', start: 'top 85%', end: 'top 15%', scrub: 0.6 },
  });
  // texto do hero sobe e some de leve
  gsap.to('.hero__text', {
    yPercent: -18, autoAlpha: 0.2, ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });

  // brilho vermelho que segue o mouse
  var glow = $('.hero__glow');
  if (glow && fine) {
    var gx = gsap.quickTo(glow, 'x', { duration: 0.8, ease: 'power3' });
    var gy = gsap.quickTo(glow, 'y', { duration: 0.8, ease: 'power3' });
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      gx(e.clientX - r.left); gy(e.clientY - r.top);
      gsap.to(glow, { autoAlpha: 1, duration: 0.6, overwrite: 'auto' });
    });
    hero.addEventListener('pointerleave', function () { gsap.to(glow, { autoAlpha: 0, duration: 0.8 }); });
  }

  // a TV inclina um pouco com o mouse
  if (fine && shot) {
    var ry = gsap.quickTo(shot, 'rotationY', { duration: 1, ease: 'power3' });
    hero.addEventListener('pointermove', function (e) { ry(((e.clientX / window.innerWidth) - 0.5) * 6); });
    hero.addEventListener('pointerleave', function () { ry(0); });
  }

  // ---------- Three.js: campo de partículas (carregado depois, só em telas maiores) ----------
  var canvas = $('.hero__gl');
  if (canvas && desktop) {
    var loadGL = function () {
      import(HERO_GL).then(function (m) {
        m.init(canvas, {
          onScroll: function (set) {
            ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', onUpdate: function (s) { set(s.progress); } });
          },
        });
      }).catch(function () { /* sem 3D: fica o brilho em CSS */ });
    };
    if (document.readyState === 'complete') setTimeout(loadGL, 200);
    else window.addEventListener('load', function () {
      if ('requestIdleCallback' in window) requestIdleCallback(loadGL, { timeout: 1500 }); else setTimeout(loadGL, 300);
    });
  }

  // ---------- títulos das seções ----------
  $$('.section__head').forEach(function (head) {
    var words = splitWords($('h2', head));
    var tl = gsap.timeline({ scrollTrigger: { trigger: head, start: 'top 82%' }, defaults: { ease: 'power4.out' } });
    tl.from($('.kicker', head), { autoAlpha: 0, y: 14, duration: 0.6 })
      .from(words, { yPercent: 115, rotate: 3, duration: 1, stagger: 0.05 }, 0.05);
    var sub = $('.sub', head);
    if (sub) tl.from(sub, { autoAlpha: 0, y: 18, duration: 0.8 }, 0.35);
  });

  // ---------- QR Code: celular → TV ----------
  var qrShot = $('.qr__shot');
  if (qrShot) {
    gsap.from(qrShot, {
      autoAlpha: 0, y: 90, scale: 0.92, rotationX: 12, transformPerspective: 1400, transformOrigin: '50% 0',
      duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: qrShot, start: 'top 85%' },
    });
    var fx = $('.qr__fx');
    if (fx) {
      // o recorte da imagem muda no celular: acompanha com o viewBox
      var mq = matchMedia('(max-width: 600px)');
      var setBox = function () { fx.setAttribute('viewBox', mq.matches ? '170 90 1640 923' : '0 0 2048 1152'); };
      setBox(); mq.addEventListener ? mq.addEventListener('change', setBox) : mq.addListener(setBox);

      var path = $('.qr__path', fx);
      var trail = $('.qr__trail', fx);
      var dot = $('.qr__dot', fx);
      var ring = $('.qr__ring-tv', fx);
      var phoneRing = $('.qr__ring-phone', fx);
      var scan = $('.qr__scan', fx);
      var len = path.getTotalLength();
      gsap.set([path, trail], { strokeDasharray: len, strokeDashoffset: len });
      var pos = { t: 0 };
      var place = function () {
        var pt = path.getPointAtLength(pos.t * len);
        dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      };
      place();

      var flow = gsap.timeline({ paused: true });
      flow.to(path, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut' })
        .to(fx, { autoAlpha: 1, duration: 0.01 }, 0);
      var loop = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.9 });
      loop
        .fromTo(phoneRing, { attr: { r: 18 }, autoAlpha: 0.9 }, { attr: { r: 70 }, autoAlpha: 0, duration: 0.8, ease: 'power2.out' }, 0)
        .fromTo(dot, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15 }, 0.15)
        .fromTo(pos, { t: 0 }, { t: 1, duration: 1.5, ease: 'power2.inOut', onUpdate: place }, 0.15)
        .fromTo(trail, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.5, ease: 'power2.inOut' }, 0.15)
        .to(trail, { strokeDashoffset: -len, duration: 0.9, ease: 'power2.in' }, 1.65)
        .to(dot, { autoAlpha: 0, duration: 0.2 }, 1.6)
        .fromTo(ring, { attr: { r: 40 }, autoAlpha: 1 }, { attr: { r: 150 }, autoAlpha: 0, duration: 1, ease: 'power2.out' }, 1.6);
      // feixe de leitura passando pelo QR Code
      gsap.fromTo(scan, { attr: { y: 222 } }, { attr: { y: 312 }, duration: 1.3, ease: 'sine.inOut', yoyo: true, repeat: -1 });

      ScrollTrigger.create({
        trigger: qrShot, start: 'top 70%', end: 'bottom top',
        onEnter: function () { flow.play(); loop.play(); },
        onLeave: function () { loop.pause(); },
        onEnterBack: function () { loop.play(); },
        onLeaveBack: function () { loop.pause(); },
      });
    }
  }

  // passos 1-2-3
  gsap.from('.step', {
    autoAlpha: 0, y: 60, rotationX: -12, transformPerspective: 900, duration: 1, ease: 'power3.out', stagger: 0.15,
    scrollTrigger: { trigger: '.steps', start: 'top 85%' },
  });
  gsap.from('.step__n', {
    scale: 0, rotate: -90, duration: 0.8, ease: 'back.out(2.2)', stagger: 0.15, delay: 0.35,
    scrollTrigger: { trigger: '.steps', start: 'top 85%' },
  });
  gsap.from('.qr__notes li', { autoAlpha: 0, y: 16, duration: 0.7, stagger: 0.1, scrollTrigger: { trigger: '.qr__notes', start: 'top 92%' } });

  // ---------- Visualização Streaming ----------
  var spot = $('.spotlight');
  if (spot) {
    var tl = gsap.timeline({ scrollTrigger: { trigger: spot, start: 'top 78%' }, defaults: { ease: 'power4.out' } });
    tl.from(spot, { autoAlpha: 0, y: 60, duration: 1 })
      .from($$('.spotlight__text > *', spot), { autoAlpha: 0, x: -30, duration: 0.8, stagger: 0.08 }, 0.15)
      .fromTo($('.spotlight__shot img', spot), { clipPath: 'inset(0 0 0 100% round 12px)', scale: 1.12 },
        { clipPath: 'inset(0 0 0 0% round 12px)', scale: 1, duration: 1.4, ease: 'expo.inOut' }, 0.2);
    gsap.to($('.spotlight__shot', spot), {
      yPercent: -8, ease: 'none',
      scrollTrigger: { trigger: spot, start: 'top bottom', end: 'bottom top', scrub: true },
    });
  }

  // ---------- recursos ----------
  gsap.from('.feat', {
    autoAlpha: 0, y: 40, scale: 0.96, duration: 0.8, ease: 'power3.out',
    stagger: { amount: 0.7, grid: 'auto', from: 'start' },
    scrollTrigger: { trigger: '.features', start: 'top 85%' },
  });
  gsap.from('.feat .ic', {
    scale: 0, rotate: -45, duration: 0.7, ease: 'back.out(2)',
    stagger: { amount: 0.7, grid: 'auto', from: 'start' }, delay: 0.25,
    scrollTrigger: { trigger: '.features', start: 'top 85%' },
  });

  // ---------- galeria ----------
  var gal = $('.gallery');
  if (gal) {
    var gtl = gsap.timeline({ scrollTrigger: { trigger: gal, start: 'top 82%' } });
    gtl.from($$('.tabs button, .seg button', gal), { autoAlpha: 0, y: 14, duration: 0.5, stagger: 0.04, ease: 'power3.out' })
      .from($('.gallery__frame', gal), { autoAlpha: 0, y: 70, scale: 0.94, rotationX: 10, transformPerspective: 1400, duration: 1.2, ease: 'expo.out' }, 0.1)
      .from($$('.gallery__nav', gal), { autoAlpha: 0, scale: 0.5, duration: 0.5, ease: 'back.out(2)', stagger: 0.08 }, 0.6);
    document.addEventListener('iptvkz:slide', function (e) {
      gsap.fromTo(e.detail, { autoAlpha: 0, scale: 1.04, filter: 'blur(6px)' },
        { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power3.out', clearProps: 'filter' });
    });
  }

  // ---------- download ----------
  gsap.from('.dl', {
    autoAlpha: 0, y: 70, rotationX: -14, transformPerspective: 1000, transformOrigin: '50% 0',
    duration: 1, ease: 'power3.out', stagger: { amount: 0.5, grid: 'auto' },
    scrollTrigger: { trigger: '.dl-grid', start: 'top 85%' },
  });
  gsap.from('.dl-warn, .dl-foot', { autoAlpha: 0, y: 20, duration: 0.8, stagger: 0.1, scrollTrigger: { trigger: '.dl-warn', start: 'top 92%' } });

  // ---------- FAQ e rodapé ----------
  gsap.from('.faq details', { autoAlpha: 0, x: -24, duration: 0.6, ease: 'power3.out', stagger: 0.06, scrollTrigger: { trigger: '.faq', start: 'top 85%' } });
  gsap.from('.footer .disclaimer, .footer__in > *', { autoAlpha: 0, y: 20, duration: 0.8, stagger: 0.1, scrollTrigger: { trigger: '.footer', start: 'top 92%' } });

  // ---------- interações com o mouse ----------
  if (fine) {
    // cartões inclinam em 3D na direção do cursor
    $$('.feat, .dl, .step').forEach(function (card) {
      gsap.set(card, { transformPerspective: 900 });
      var rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3' });
      var ryc = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3' });
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
        rx(-py * 8); ryc(px * 8);
        card.style.setProperty('--mx', (px + 0.5) * 100 + '%');
        card.style.setProperty('--my', (py + 0.5) * 100 + '%');
      });
      card.addEventListener('pointerleave', function () { rx(0); ryc(0); });
    });
    // botões principais "magnéticos"
    $$('.hero .btn, .topbar .btn').forEach(function (btn) {
      var bx = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
      var by = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
      btn.addEventListener('pointermove', function (e) {
        var r = btn.getBoundingClientRect();
        bx((e.clientX - r.left - r.width / 2) * 0.25); by((e.clientY - r.top - r.height / 2) * 0.35);
      });
      btn.addEventListener('pointerleave', function () { bx(0); by(0); });
    });
  }

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
  root.classList.add('motion-ready');
})();
