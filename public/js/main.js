// IPTVKZ: landing page. JavaScript puro em ES5, para rodar também em TVs antigas (Chromium 53).
// Sem este arquivo a página continua completa, e o download leva à lista de aparelhos.
(function () {
  'use strict';

  var root = document.documentElement;
  var ua = navigator.userAgent;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isTv = /web0s|webos|smart-?tv|netcast|tizen|hbbtv|appletv|crkey|aft[a-z]|android tv|bravia|googletv|mibox/i.test(ua) || /[?&]tv=1\b/.test(location.search);
  if (isTv) root.classList.add('tv');

  // ---------- aparelho de quem visita ----------
  function detect() {
    if (/web0s|webos|netcast/i.test(ua)) return 'lg';
    if (/android/i.test(ua)) return /android tv|bravia|aft[a-z]|mibox|shield|googletv|\btv\b/i.test(ua) ? 'atv' : 'android';
    if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'browser';
    if (/windows/i.test(ua)) return 'win';
    if (/macintosh|mac os x/i.test(ua)) return 'mac';
    if (/linux|x11/i.test(ua) && !/cros/i.test(ua)) return 'linux';
    return 'browser';
  }
  var device = detect();
  var HERO = {
    win: { label: 'Baixar para Windows', direct: true },
    linux: { label: 'Baixar para Linux', direct: true },
    android: { label: 'Baixar para Android', direct: true },
    atv: { label: 'Baixar para Android TV', direct: true },
    mac: { label: 'Baixar para macOS' },
    lg: { label: 'Instalar na TV LG' },
  };

  var others = $('#outros');
  var rec = $('[data-rec]');
  var devRow = $('[data-dev="' + device + '"]');
  if (device !== 'browser' && devRow) {
    $('[data-rec-body]').appendChild(devRow.cloneNode(true));
    rec.hidden = false;
    others.open = false;
  }

  function refreshCta() {
    var cfg = HERO[device];
    if (!cfg) return;
    $('[data-hero-label]').textContent = cfg.label;
    var link = cfg.direct && $('[data-dev="' + device + '"] .btn');
    if (link) $('[data-hero-cta]').href = link.href;
  }
  refreshCta();

  $$('[data-open-all]').forEach(function (a) {
    a.addEventListener('click', function () { others.open = true; });
  });

  // ---------- Clássica ou Streaming ----------
  function swap(img, base, alt) {
    var src = 'images/screens/' + base;
    img.classList.add('is-swap');
    var next = new Image();
    next.onload = next.onerror = function () {
      img.srcset = src + '-800.webp 800w, ' + src + '-1280.webp 1280w';
      img.src = src + '-1280.webp';
      if (alt) img.alt = alt;
      img.classList.remove('is-swap');
    };
    next.src = src + (window.innerWidth < 700 ? '-800.webp' : '-1280.webp');
  }

  var ALT = {
    classica: 'IPTVKZ na visualização Clássica: grade de filmes fictícios com capas e categorias',
    streaming: 'IPTVKZ na visualização Streaming: um filme fictício em destaque, botões e a fileira Continuar assistindo',
  };
  var views = $$('[data-view]');
  var heroImg = $('[data-hero-img]');
  views.forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.getAttribute('aria-pressed') === 'true') return;
      views.forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      swap(heroImg, 'hero-' + b.getAttribute('data-view'), ALT[b.getAttribute('data-view')]);
    });
  });

  // ---------- telas ----------
  var gallery = $('[data-gallery]');
  var tiles = $$('.tile', gallery);
  var galleryImg = $('[data-gallery-img]');
  var pauseBtn = $('[data-pause]');
  var current = 0, paused = reduce, hover = false, visible = false;

  function show(i, fromUser) {
    i = (i + tiles.length) % tiles.length;
    if (i === current) return;
    tiles[current].classList.remove('is-on');
    tiles[i].classList.add('is-on');
    current = i;
    swap(galleryImg, tiles[i].getAttribute('data-shot'), tiles[i].getAttribute('data-alt'));
    var list = tiles[i].parentNode;
    if (list.scrollWidth > list.clientWidth) list.scrollLeft = tiles[i].offsetLeft - 16;
    if (fromUser) setPaused(true);
  }
  function setPaused(p) {
    paused = p;
    pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
    pauseBtn.textContent = p ? 'Continuar' : 'Pausar';
  }
  if (reduce) { pauseBtn.hidden = true; }
  tiles.forEach(function (t, i) {
    t.addEventListener('click', function () { show(i, true); });
    t.addEventListener('focus', function () { if (root.classList.contains('kb')) show(i, false); });
  });
  pauseBtn.addEventListener('click', function () { setPaused(!paused); });
  gallery.addEventListener('mouseenter', function () { hover = true; });
  gallery.addEventListener('mouseleave', function () { hover = false; });
  setInterval(function () {
    var focused = gallery.contains(document.activeElement);
    if (!paused && !hover && !focused && visible && !document.hidden) show(current + 1, false);
  }, 5000);
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(gallery);
  }
  // no celular, arrastar passa as telas
  var startX = null;
  galleryImg.parentNode.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
  galleryImg.parentNode.addEventListener('touchend', function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1), true);
  });

  // ---------- GitHub: versão, links, tamanhos e números ----------
  var API = 'https://api.github.com/repos/lucasyemz/iptvkz';
  var KEY = 'iptvkz-github';
  var SHOW_STARS_FROM = 50, SHOW_DOWNLOADS_FROM = 1000;
  function mb(bytes) {
    var v = bytes / 1e6;
    return (v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)) + ' MB';
  }
  function short(n) {
    return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '').replace('.', ',') + ' mil' : String(n);
  }
  function setStat(name, value, label) {
    var el = $('[data-stat="' + name + '"]');
    if (!el) return;
    $('strong', el).textContent = value;
    $('span', el).textContent = label;
  }
  function apply(d) {
    if (d.tag) {
      var ver = 'v' + String(d.tag).replace(/^v/, '');
      $$('[data-release-version]').forEach(function (el) { el.textContent = ver; });
      $$('a[data-asset], a[data-asset-re]').forEach(function (a) {
        var name = a.getAttribute('data-asset');
        var re = a.getAttribute('data-asset-re') ? new RegExp(a.getAttribute('data-asset-re')) : null;
        var asset = d.assets.filter(function (x) { return name ? x.name === name : re.test(x.name); })[0];
        if (!asset) return;
        a.href = asset.url;
        var size = $('[data-size]', a);
        if (size && asset.size) size.textContent = mb(asset.size);
      });
      refreshCta();
    }
    if (d.downloads >= SHOW_DOWNLOADS_FROM) setStat('downloads', short(d.downloads), 'downloads');
    if (d.stars >= SHOW_STARS_FROM) setStat('stars', short(d.stars), 'estrelas no GitHub');
  }
  function load() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (cached && Date.now() - cached.t < 3600e3) return apply(cached.d);
    } catch (e) { /* sem cache */ }
    if (!window.fetch) return;
    var json = function (r) { return r.ok ? r.json() : null; };
    var head = { headers: { Accept: 'application/vnd.github+json' } };
    Promise.all([fetch(API, head).then(json), fetch(API + '/releases?per_page=30', head).then(json)]).then(function (res) {
      var repo = res[0] || {}, all = res[1] || [];
      var published = all.filter(function (r) { return !r.draft && !r.prerelease; });
      var latest = published[0];
      var d = { stars: repo.stargazers_count || 0, downloads: 0, tag: latest && latest.tag_name, assets: [] };
      published.forEach(function (r) {
        r.assets.forEach(function (a) { if (/\.(exe|dmg|AppImage|deb|apk|ipk)$/.test(a.name)) d.downloads += a.download_count; });
      });
      if (latest) d.assets = latest.assets.map(function (a) { return { name: a.name, size: a.size, url: a.browser_download_url }; });
      try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* cheio */ }
      apply(d);
    }).catch(function () { /* fica com o que está no HTML */ });
  }
  load();

  // ---------- foco: moldura deslizante e navegação pelas setas na TV ----------
  var ring = document.createElement('div');
  ring.className = 'ring';
  ring.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ring);
  var frame = 0;

  function place() {
    frame = 0;
    var el = document.activeElement;
    if (!el || el === document.body || !root.classList.contains('kb')) { ring.classList.remove('is-on'); return; }
    var r = el.getBoundingClientRect();
    ring.style.width = (r.width + 8) + 'px';
    ring.style.height = (r.height + 8) + 'px';
    ring.style.transform = 'translate(' + Math.round(r.left - 4) + 'px,' + Math.round(r.top - 4) + 'px)';
    ring.classList.add('is-on');
  }
  function kick() { if (!frame && root.classList.contains('kb')) frame = requestAnimationFrame(place); }
  document.addEventListener('focusin', kick);
  document.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('resize', kick);
  document.addEventListener('mousedown', function () { root.classList.remove('kb'); ring.classList.remove('is-on'); });
  document.addEventListener('touchstart', function () { root.classList.remove('kb'); ring.classList.remove('is-on'); }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 9 || (isTv && e.keyCode >= 37 && e.keyCode <= 40)) { root.classList.add('kb'); kick(); }
  });

  if (!isTv) return;

  // Na TV, os cartões também recebem foco, para a rolagem passar por eles.
  $$('.card, .platform, .open').forEach(function (el) { el.setAttribute('tabindex', '0'); });

  var SELECTOR = 'a[href], button, summary, [tabindex="0"]';
  function usable(el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.classList.contains('skip')) return false;
    var parent = el.parentNode.closest && el.parentNode.closest('details:not([open])');
    return !parent || el.tagName === 'SUMMARY';
  }
  function reveal(el) {
    var r = el.getBoundingClientRect();
    var top = 88, bottom = window.innerHeight - 24;
    if (r.top < top || r.bottom > bottom) {
      window.scrollTo(0, Math.max(0, window.pageYOffset + r.top - (window.innerHeight - r.height) / 2));
    }
  }
  function move(key) {
    var cur = document.activeElement;
    if (!cur || cur === document.body) return focusFirst();
    var c = cur.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    var best = null, score = Infinity;
    $$(SELECTOR).forEach(function (el) {
      if (el === cur || !usable(el)) return;
      var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      var main, cross;
      if (key === 37) { main = c.left - r.right; cross = Math.abs(y - cy); if (x >= cx) return; }
      if (key === 39) { main = r.left - c.right; cross = Math.abs(y - cy); if (x <= cx) return; }
      if (key === 38) { main = c.top - r.bottom; cross = Math.abs(x - cx); if (y >= cy) return; }
      if (key === 40) { main = r.top - c.bottom; cross = Math.abs(x - cx); if (y <= cy) return; }
      var s = Math.max(main, 0) + cross * 3;
      if (s < score) { score = s; best = el; }
    });
    if (best) { best.focus(); reveal(best); kick(); }
  }
  function focusFirst() {
    var first = $('[data-hero-cta]');
    root.classList.add('kb');
    first.focus();
    kick();
  }
  document.addEventListener('keydown', function (e) {
    if (e.keyCode < 37 || e.keyCode > 40) return;
    e.preventDefault();
    move(e.keyCode);
  });
  focusFirst();
})();
