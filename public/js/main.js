// IPTVKZ — landing page. Sem dependências.
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  // ---------- topo: borda ao rolar ----------
  var bar = document.querySelector('.topbar');
  var onScroll = function () { bar && bar.classList.toggle('is-scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // As animações (GSAP / Three.js) ficam em js/motion.js.

  // ---------- galeria ----------
  // Para incluir uma captura nova: adicione uma linha aqui (tab = aba, mode = tv | desktop).
  var IMG = 'images/screens/';
  var SLIDES = [
    { tab: 'live', mode: 'tv', src: 'tv-canais.webp', w: 1280, h: 720, alt: 'Modo TV: lista de canais com o foco do controle remoto', cap: 'Canais com o foco do controle remoto.' },
    { tab: 'live', mode: 'tv', src: 'tv-zapping.webp', w: 1280, h: 720, alt: 'Modo TV: vídeo em tela cheia com a lista de canais aberta ao lado', cap: 'Tela cheia com a lista lateral para zapear.' },
    { tab: 'live', mode: 'desktop', src: 'desktop-tv-ao-vivo.webp', w: 1280, h: 800, alt: 'TV ao vivo com o player, o guia de agora e a seguir e a lista de canais', cap: 'Player, agora e a seguir, e lista para zapear.' },
    { tab: 'movies', mode: 'tv', src: 'tv-streaming-2.webp', w: 1280, h: 720, alt: 'Modo TV: Visualização Streaming com destaque grande de um filme e fileira de cards', cap: 'Visualização Streaming: destaque grande do título em foco.' },
    { tab: 'movies', mode: 'tv', src: 'tv-filmes.webp', w: 1280, h: 720, alt: 'Modo TV: grade de filmes', cap: 'Grade de filmes no modo TV.' },
    { tab: 'movies', mode: 'desktop', src: 'desktop-filmes.webp', w: 1280, h: 800, alt: 'Tela de filmes com Continuar assistindo e prateleiras por categoria', cap: 'Continuar assistindo e prateleiras por categoria.' },
    { tab: 'series', mode: 'desktop', src: 'desktop-serie.webp', w: 1280, h: 800, alt: 'Página de uma série com temporadas e episódios assistidos', cap: 'Temporadas, episódios e próximo episódio.' },
    { tab: 'guide', mode: 'desktop', src: 'desktop-guia.webp', w: 1280, h: 800, alt: 'Guia de programação em grade de horários', cap: 'Guia de programação (EPG) em grade de horários.' },
    { tab: 'search', mode: 'tv', src: 'tv-busca.webp', w: 1280, h: 720, alt: 'Modo TV: resultados da busca', cap: 'Busca no modo TV.' },
    { tab: 'search', mode: 'desktop', src: 'desktop-busca.webp', w: 1280, h: 800, alt: 'Busca mostrando canais, filmes e séries', cap: 'Busca em canais, filmes e séries ao mesmo tempo.' },
    { tab: 'player', mode: 'desktop', src: 'desktop-player.webp', w: 1280, h: 800, alt: 'Player de vídeo com barra de progresso e controles', cap: 'Player com troca de áudio, legendas e picture-in-picture.' }
  ];

  var g = document.querySelector('[data-gallery]');
  if (g) {
    var img = g.querySelector('[data-gallery-img]');
    var cap = g.querySelector('[data-gallery-cap]');
    var tabs = Array.prototype.slice.call(g.querySelectorAll('[role="tab"]'));
    var modes = Array.prototype.slice.call(g.querySelectorAll('[data-mode]'));
    var cur = 0;

    var show = function (i, focusTab) {
      cur = (i + SLIDES.length) % SLIDES.length;
      var s = SLIDES[cur];
      img.classList.add('is-loading');
      var next = new Image();
      next.onload = next.onerror = function () {
        img.src = next.src; img.width = s.w; img.height = s.h; img.alt = s.alt;
        img.classList.remove('is-loading');
        document.dispatchEvent(new CustomEvent('iptvkz:slide', { detail: img }));
      };
      next.src = IMG + s.src;
      cap.textContent = s.cap;
      tabs.forEach(function (t) {
        var on = t.dataset.tab === s.tab;
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        if (on && focusTab) t.focus();
        // rola só a faixa de abas (no celular), nunca a página
        if (on) {
          var strip = t.parentNode;
          var l = t.offsetLeft - strip.offsetLeft, r = l + t.offsetWidth;
          if (l < strip.scrollLeft) strip.scrollLeft = l - 8;
          else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth + 8;
        }
      });
      modes.forEach(function (b) {
        var has = SLIDES.some(function (x) { return x.tab === s.tab && x.mode === b.dataset.mode; });
        b.disabled = !has;
        b.setAttribute('aria-pressed', b.dataset.mode === s.mode);
      });
      // pré-carrega a próxima
      new Image().src = IMG + SLIDES[(cur + 1) % SLIDES.length].src;
    };
    var find = function (tab, mode) {
      var i = SLIDES.findIndex(function (x) { return x.tab === tab && (!mode || x.mode === mode); });
      return i < 0 ? SLIDES.findIndex(function (x) { return x.tab === tab; }) : i;
    };

    tabs.forEach(function (t, k) {
      t.addEventListener('click', function () { show(find(t.dataset.tab, SLIDES[cur].mode)); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var nt = tabs[(k + d + tabs.length) % tabs.length];
        show(find(nt.dataset.tab, SLIDES[cur].mode), true);
      });
    });
    modes.forEach(function (b) {
      b.addEventListener('click', function () { show(find(SLIDES[cur].tab, b.dataset.mode)); });
    });
    g.querySelector('[data-prev]').addEventListener('click', function () { show(cur - 1); });
    g.querySelector('[data-next]').addEventListener('click', function () { show(cur + 1); });

    // deslizar no celular
    var x0 = null;
    var frame = g.querySelector('.gallery__frame');
    frame.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    frame.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1));
    });
    show(0);
  }

  // ---------- downloads: versão mais recente do GitHub ----------
  // O HTML já traz links reais da última versão conhecida. Se a API responder, os links,
  // a versão e os tamanhos são atualizados sozinhos quando sai uma Release nova.
  var API = 'https://api.github.com/repos/lucasyemz/iptvkz/releases/latest';
  var KEY = 'iptvkz-release';
  var mb = function (bytes) {
    var v = bytes / 1e6;
    return (v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)) + ' MB';
  };
  var apply = function (rel) {
    if (!rel || !rel.tag_name || !Array.isArray(rel.assets)) return;
    var ver = 'v' + String(rel.tag_name).replace(/^v/, '');
    document.querySelectorAll('[data-release-version]').forEach(function (el) { el.textContent = ver; });
    document.querySelectorAll('a[data-asset], a[data-asset-re]').forEach(function (a) {
      var name = a.getAttribute('data-asset');
      var re = a.getAttribute('data-asset-re') ? new RegExp(a.getAttribute('data-asset-re')) : null;
      var asset = rel.assets.find(function (x) { return name ? x.name === name : re.test(x.name); });
      if (!asset) return; // mantém o link conhecido
      a.href = asset.browser_download_url;
      var sz = a.querySelector('[data-size]');
      if (sz && asset.size) sz.textContent = mb(asset.size);
    });
  };
  try {
    var cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.t < 3600e3) { apply(cached.r); return; }
  } catch (e) { /* sem cache */ }
  if (!window.fetch) return;
  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (r) {
      if (!r || r.draft || r.prerelease) return;
      var slim = { tag_name: r.tag_name, assets: (r.assets || []).map(function (x) { return { name: x.name, size: x.size, browser_download_url: x.browser_download_url }; }) };
      try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), r: slim })); } catch (e) { /* cheio */ }
      apply(slim);
    })
    .catch(function () { /* fica com os links do HTML */ });
})();
