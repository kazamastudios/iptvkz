// Filmes e Séries: prateleiras, grade por categoria e páginas de detalhe.
import { h, ico, img, windowed, matcher, debounce, fmtDur, fmtTime, toast, modal, skPosters, skEpisodes, skLines, isBack } from '../core/util.js';
import { starIcon } from '../core/icons.js';
import {
  C, S, visibleCats, visibleItems, favItems, isFav, toggleFav, getProgress, setProgress, clearProgress, isWatched, isStarted,
  continueMovies, continueSeries, clearContinue, catItems, isLater, toggleLater, laterItems, adultLocked, isAdultItem, seriesDetail, movieDetail, preferredVersion, versionNames, setSetting,
} from '../core/store.js';
import { playMovie, playEpisode } from './vodplayer.js';
import { TV, KB, focusEl } from '../tv/tv.js';
import { glideTo, glideTarget, stopGlide, scrolling } from '../core/smoothscroll.js';
import { viewMode } from '../core/viewmode.js';
import { cleanEpisodeTitle } from '../core/titles.js';

const SHORT = { Dublado: 'DUB', Legendado: 'LEG', Nacional: 'NAC', 'Dual áudio': 'DUAL' };

const cfg = {
  movies: { title: 'Filmes', one: 'filme', many: 'filmes', detail: 'movie' },
  series: { title: 'Séries', one: 'série', many: 'séries', detail: 'serie' },
};

function versionTags(item) {
  const vs = item.versions || [];
  const tags = [...new Set(vs.map((v) => SHORT[Object.keys(SHORT).find((k) => v.label.startsWith(k))]).filter(Boolean))];
  return tags.length ? h('div.tags', tags.map((t) => h('span.badge', t))) : null;
}

function progressRatio(section, item) {
  if (section === 'movies') {
    const p = getProgress(item.id);
    return p && p.d ? p.t / p.d : 0;
  }
  return 0;
}

// Texto "onde parei" de um filme ou série.
export function whereStopped(section, item) {
  if (section === 'movies') {
    const p = getProgress(item.id);
    if (isStarted(p)) return `Parou em ${fmtTime(p.t)}`;
    return isWatched(item.id) ? 'Assistido' : '';
  }
  const last = getProgress('s:' + item.id);
  if (!last) return '';
  if (last.done) return 'Série concluída';
  const ep = getProgress(last.ep);
  const code = `T${last.season}:E${last.num}`;
  if (isWatched(last.ep)) return `${code} assistido`;
  return ep && ep.d ? `${code} · parou em ${fmtTime(ep.t)}` : code;
}

// Capas do TMDB vêm em 600×900, mas o cartão normal mostra ~156px de largura. A versão de 342px tem um terço
// dos pixels: bem menos para baixar e, principalmente, para decodificar (era o que travava a TV ao rolar).
// O cartão largo do Streaming mostra a capa maior e continua com a original.
function smallPoster(src) {
  return String(src || '').replace(/(image\.tmdb\.org\/t\/p\/)(?:w\d+_and_h\d+_[a-z0-9]+|w(?:500|600|780)|original)\//, '$1w342/');
}

export function posterCard(section, item, ctx, { where = false, onOpen = null, wide = false } = {}) {
  const th = img(wide ? item.poster : smallPoster(item.poster), item.name, 'cover');
  const tags = versionTags(item);
  if (tags) th.append(tags);
  if (item.rating) th.append(h('span.badge.gold.rating', '★ ' + Number(item.rating).toFixed(1)));
  const r = progressRatio(section, item);
  if (r > 0.02 && r < 0.95) th.append(h('div.pbar', h('i', { style: { width: r * 100 + '%' } })));
  if (section === 'movies' && isWatched(item.id) && !(r > 0.02 && r < 0.95)) th.append(h('span.badge.seen.seen-mark', '✓ Assistido'));
  if (section === 'series') {
    const last = getProgress('s:' + item.id);
    if (last && last.done) th.append(h('span.badge.seen.seen-mark', '✓ Concluída'));
    else if (last) {
      th.append(h('div.tags', { style: { top: 'auto', bottom: '16px' } }, h('span.badge', `T${last.season}:E${last.num}`)));
      const ep = getProgress(last.ep);
      if (ep && ep.d) th.append(h('div.pbar', h('i', { style: { width: Math.min(100, (ep.t / ep.d) * 100) + '%' } })));
    }
  }
  return h('div.poster', { onclick: (e) => (onOpen ? onOpen(e) : ctx.navigate(`#/${cfg[section].detail}?id=${encodeURIComponent(item.id)}`)), title: item.name },
    th, h('div.pt', item.name), h('div.pm', (where && whereStopped(section, item)) || (item.year ? String(item.year) : ' ')));
}

// Controles de uma fileira, iguais em todas as plataformas, cada uma com o seu jeito de usar:
// - setas no canto direito do título: andam uma página (quase uma tela de capas) — clique no PC, toque no
//   celular, OK no controle da TV (são botões comuns, alcançáveis pelo foco);
// - no PC, também as setas redondas que aparecem nas laterais ao passar o mouse e o arrastar com o mouse.
// Tudo desliza pelo mesmo motor (glideTo), com a mesma curva do foco da TV.
export function rowControls(row) {
  let anim = 0; // embalo do arraste
  const maxLeft = () => row.scrollWidth - row.clientWidth;
  const page = (dir) => {
    cancelAnimationFrame(anim);
    glideTo(row, glideTarget(row).x + dir * Math.max(200, row.clientWidth * 0.85), null);
    sync(); // pelo destino: a seta de voltar aparece já no clique, não só quando o deslize termina
  };
  const btns = [];
  const btn = (cls, dir, extra) => {
    const b = h('button.' + cls + (dir < 0 ? '.prev' : '.next'),
      { type: 'button', title: dir < 0 ? 'Anteriores' : 'Próximos', onclick: () => page(dir), ...extra },
      ico(dir < 0 ? 'back' : 'chevronRight'));
    btns.push([b, dir]);
    return b;
  };
  // na ponta, a seta apaga (sem "disabled": na TV o foco não pode sumir debaixo do controle)
  const sync = () => {
    if (!row.clientWidth) return; // fileira ainda não montada (fora da tela): sem medidas confiáveis
    const x = glideTarget(row).x;
    for (const [b, dir] of btns) b.classList.toggle('off', dir < 0 ? x <= 4 : x >= maxLeft() - 4);
  };
  row.addEventListener('scroll', debounce(sync, 60), { passive: true });
  const pager = h('div.shelf-pager', btn('pager-btn', -1), btn('pager-btn', 1));
  // controle: com o gesto ↑ ↓ ↑ numa capa, o foco vai ao título desta fileira ("Ver tudo" e setas)
  row.dataset.up = '.shelf-head a[href], .shelf-pager .pager-btn';
  setTimeout(() => {
    sync();
    // fileiras fora da tela só são montadas quando chegam perto: aí as setas recalculam
    const shelf = row.closest('.shelf');
    if (shelf) shelf.addEventListener('contentvisibilityautostatechange', (e) => { if (!e.skipped) sync(); });
  }, 0);

  if (TV.on) return { body: row, pager, sync };

  // Arrastar com o mouse. Só vira arraste depois de 6px, para o clique no cartão continuar funcionando;
  // ao soltar, a fileira segue no embalo e vai freando.
  const settle = () => { row.style.scrollSnapType = ''; sync(); };
  let drag = null;
  let justDragged = false;
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    cancelAnimationFrame(anim);
    stopGlide(row);
    drag = { id: e.pointerId, x: e.clientX, left: row.scrollLeft, moved: false, pts: [] };
  });
  row.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      row.classList.add('dragging');
      row.style.scrollSnapType = 'none';
      try { row.setPointerCapture(drag.id); } catch {} // segue o mouse mesmo fora da fileira
    }
    row.scrollLeft = drag.left - dx;
    drag.pts.push([e.timeStamp, e.clientX]);
    if (drag.pts.length > 6) drag.pts.shift();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    row.classList.remove('dragging');
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 0);
    // velocidade dos últimos ~100ms do movimento, em px/ms
    const recent = d.pts.filter(([t]) => e.timeStamp - t < 100);
    let v = recent.length > 1 ? (recent[0][1] - recent[recent.length - 1][1]) / Math.max(8, recent[recent.length - 1][0] - recent[0][0]) : 0;
    v = Math.max(-3, Math.min(3, v)); // um puxão brusco não atravessa a fileira inteira
    let last = performance.now();
    const glide = (now) => {
      const dt = now - last;
      last = now;
      row.scrollLeft += v * dt;
      scrolling();
      v *= Math.pow(0.94, dt / 16);
      const atEdge = row.scrollLeft <= 0 || row.scrollLeft >= maxLeft();
      if (Math.abs(v) > 0.03 && !atEdge) anim = requestAnimationFrame(glide);
      else settle();
    };
    anim = requestAnimationFrame(glide);
  };
  row.addEventListener('pointerup', release);
  row.addEventListener('pointercancel', release);
  // o clique que encerra um arraste não abre o filme
  row.addEventListener('click', (e) => { if (justDragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  row.addEventListener('dragstart', (e) => e.preventDefault()); // a capa não vira "arrastar imagem"
  // (as setas laterais que apareciam no hover saíram: faziam a fileira tremer ao rolar; ficam o arraste e as do título)
  const body = h('div.shelf-body', row);
  return { body, pager, sync };
}

// ---------- navegação: categorias à esquerda, conteúdo à direita ----------

export function vodHome(section) {
  return (params, ctx) => {
    ctx.setTitle(cfg[section].title);
    const sec = C()[section];
    if (!sec.items.length) {
      return {
        el: h('div.page', h('div.center-state', { style: { height: '60vh' } }, ico(section === 'movies' ? 'film' : 'series'),
          h('h2', `Nenhum${section === 'series' ? 'a' : ''} ${cfg[section].one} nesta lista`),
          h('p', 'Esta lista só tem canais ao vivo, ou o provedor não liberou esse conteúdo.'))),
      };
    }

    let cat = params.get('cat') || 'home';
    let cleanup = null;
    const filter = h('input', { placeholder: 'Filtrar categorias' });
    const list = h('div.cat-list');
    const content = h('div.vod-content');
    const root = h('div.live.vod-browse', h('div.cats', h('label.filter', ico('search'), filter), list), content);
    filter.addEventListener('input', debounce(renderCats, 120));

    function renderCats() {
      const m = matcher(filter.value);
      const go = (id) => ctx.navigate(id === 'home' ? `#/${section}` : `#/${section}?cat=${encodeURIComponent(id)}`);
      const btn = (id, name, n, icn) => h('button.cat-item' + (id === cat ? '.on' : ''), { onclick: () => go(id) },
        icn ? ico(icn) : null, h('span.name', name), n != null ? h('span.n', n.toLocaleString('pt-BR')) : null);
      const rows = [];
      if (!filter.value) {
        rows.push(
          btn('home', 'Início', null, section === 'movies' ? 'film' : 'series'),
          btn('all', `Todos os ${cfg[section].many}`, visibleItems(section).length, 'tv'),
          btn('fav', 'Favoritos', favItems(section).length, 'star'),
          h('div.cat-sep'),
        );
      }
      for (const c of visibleCats(section)) if (m(c.name)) rows.push(btn(c.id, c.name, c.count));
      list.replaceChildren(...rows);
    }

    function renderContent() {
      if (cleanup) cleanup();
      content.scrollTop = 0;
      // Streaming: o Início vira destaque + fileiras, sem a coluna de categorias (cada categoria já é uma fileira)
      const stream = cat === 'home' && viewMode() === 'stream';
      root.classList.toggle('stream', stream);
      // a fileira em foco sobe até logo abaixo do destaque (folga do scroll-padding em .stream-scroll)
      content.classList.toggle('stream-scroll', stream);
      if (stream) content.dataset.reveal = 'start';
      else delete content.dataset.reveal;
      const view = stream ? streamHome(section, ctx, content) : cat === 'home' ? homeContent(section, ctx, content) : gridContent(section, cat, ctx, content);
      content.replaceChildren(view.el);
      cleanup = view.destroy;
    }

    renderCats();
    renderContent();

    return {
      el: root,
      noScroll: true,
      update(p) {
        const next = p.get('cat') || 'home';
        if (next !== cat) {
          cat = next;
          renderCats();
          renderContent();
          if (TV.on && (!document.activeElement || document.activeElement === document.body)) focusEl(list.querySelector('.cat-item.on'));
        }
        return true;
      },
      destroy: () => cleanup && cleanup(),
    };
  };
}

// ---------- visualização Streaming ----------
// Destaque grande no topo + fileiras de cards deitados. O destaque acompanha o card em foco (controle/teclado) ou
// sob o mouse/dedo, com uma espera curta para não trocar a cada passo de quem segura a seta.

// Card deitado: o mesmo cartão das capas (badges, progresso, foco, moldura), só que 16:9.
// Filme: o destaque já faz o papel da página do filme, então abrir o card não leva até ela:
// mouse toca o filme (o destaque mostrou tudo no hover); controle/teclado sobe aos botões do destaque;
// toque mostra o filme no destaque e sobe a tela até ele. Série continua abrindo a página (episódios).
export function wideCardFor(hero) {
  return (section, item, ctx, opts = {}) => {
    // Abrir o card (filme ou série) mostra as opções dele no destaque, sem sair da tela:
    // controle/teclado leva o foco aos botões; toque sobe a tela até o destaque; mouse prende o destaque
    // no título clicado, para ele não mudar enquanto o ponteiro sobe até os botões.
    const onOpen = (e) => {
      hero.show(item, section, true);
      hero.open(el); // descrição inteira; com controle/teclado o foco fica preso nos botões até voltar ao card
      hero.pin();
      // controle (OK ou clique do Magic Remote) e teclado: o foco sobe para os botões do destaque
      if (e.detail === 0 || TV.on || KB.on) return setTimeout(() => focusEl(hero.el.querySelector('.hero-acts .btn.primary')), 0);
      if (e.pointerType === 'touch') {
        const box = hero.el.closest('.vod-content, .view');
        if (box) glideTo(box, null, 0);
      }
    };
    const el = posterCard(section, item, ctx, { ...opts, onOpen, wide: true });
    el.classList.add('wide');
    el._item = item;
    el._section = section;
    return el;
  };
}

const heroDetails = new Map(); // seção|id → Promise<detalhe>: um pedido por título, guardado

export function streamHero(ctx) {
  // duas camadas de imagem: a nova só aparece (troca suave) depois de carregar, sem piscar o fundo
  const arts = [h('img.hero-art', { alt: '', referrerpolicy: 'no-referrer', decoding: 'async' }),
    h('img.hero-art', { alt: '', referrerpolicy: 'no-referrer', decoding: 'async' })];
  let front = 0;
  const title = h('h2.hero-title');
  const meta = h('div.hero-meta');
  const versions = h('div.versions.hero-versions');
  const plot = h('p.hero-plot');
  const acts = h('div.hero-acts');
  // data-ring-cover: a moldura do foco não é desenhada por cima do destaque (tv/focusring.js)
  // Sem trailer de fundo: o player do YouTube pesava demais na TV e travava a navegação. O botão Trailer
  // abre o vídeo numa janela quase do tamanho da tela, igual no PC, na TV e no celular.
  const el = h('section.hero-stream', { 'data-ring-cover': '' }, arts[0], arts[1], h('div.hero-shade'),
    h('div.hero-info', title, meta, versions, plot, acts));
  let cur = null;
  let curSection = 'movies';
  let version = null;
  let trailer = '';
  let tShow = 0;
  let tDetail = 0;

  // Preso no título clicado: o hover nos cards não troca o destaque até o ponteiro passar pelo destaque e sair
  // dele (ou 2,5 s sem chegar lá). O controle e o teclado continuam trocando normalmente.
  let pinned = false;
  let inHero = false;
  let tPin = 0;
  el.addEventListener('pointerenter', () => { inHero = true; });
  el.addEventListener('pointerleave', () => { inHero = false; pinned = false; });

  // Aberto pelo controle/teclado, o destaque é a "página" do título: as setas ficam presas nos botões dele
  // (data-nav-trap) e ↓ ou Voltar devolvem o foco exatamente ao card de onde se veio.
  let origin = null;
  const unopen = () => {
    el.classList.remove('open');
    delete el.dataset.navTrap;
    origin = null;
  };
  const closeOpen = () => {
    const o = origin;
    unopen();
    if (o && o.isConnected && (TV.on || KB.on)) focusEl(o);
  };
  el._navExit = (dir) => {
    if (dir === 'down') closeOpen();
  };
  // Voltar (controle) ou Esc: sai do título aberto e volta ao card
  const onKey = (e) => {
    if (!isBack(e)) return;
    if (origin && el.contains(document.activeElement)) closeOpen();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);

  // Uma imagem só por título: espera o detalhe e põe a larga (se houver) ou a capa; nunca a capa e depois a larga.
  let artFor = null; // título cuja imagem já foi escolhida
  let tArt = 0;
  const setArt = (item, src, wide) => {
    if (artFor === item || cur !== item) return;
    artFor = item;
    clearTimeout(tArt);
    el.classList.toggle('wide-art', wide);
    if (!src) return;
    if (arts[front].getAttribute('src') === src) { arts[front].classList.add('on'); return; }
    const next = arts[1 - front];
    next.onload = () => {
      if (cur !== item) return;
      next.classList.add('on');
      arts[front].classList.remove('on');
      front = 1 - front;
    };
    next.onerror = null;
    next.src = src;
  };

  // Botões: filme com todos os da página do filme (que o destaque substitui); série com os episódios na página dela.
  const renderActs = () => {
    const item = cur;
    const section = curSection;
    if (!item) return;
    // se o foco estava num botão do destaque, volta para o mesmo lugar depois de redesenhar
    const old = [...acts.querySelectorAll('button')];
    const at = old.indexOf(document.activeElement);
    if (section === 'movies') {
      versionChips(versions, item.versions.map((v) => v.label), version.label, (l) => {
        version = item.versions.find((v) => v.label === l);
        setSetting('versionPref', l);
        renderActs();
      }, versionNames(item.versions));
      acts.replaceChildren(...movieActions(item, version, trailer, renderActs, acts));
    } else {
      versions.replaceChildren();
      acts.replaceChildren(
        h('button.btn.primary.big', { onclick: () => ctx.navigate(`#/${cfg.series.detail}?id=${encodeURIComponent(item.id)}`) }, ico('play'), 'Ver episódios'),
        trailerButton(item.name, trailer), laterButton(section, item), favButton(section, item));
    }
    if (at >= 0) {
      const now = acts.querySelectorAll('button');
      focusEl(now[Math.min(at, now.length - 1)]);
    }
  };

  const loadDetail = (item, section) => {
    const key = section + '|' + item.id;
    let p = heroDetails.get(key);
    if (!p) {
      p = (section === 'movies' ? movieDetail(item) : seriesDetail(item)).catch(() => null);
      heroDetails.set(key, p);
    }
    p.then((d) => {
      if (cur !== item) return;
      setArt(item, (d && d.backdrop) || item.poster, !!(d && d.backdrop));
      // troca as linhas de carregamento; sem sinopse nenhuma, o espaço some e o título desce
      const text = (d && d.plot) || item.plot || '';
      plot.textContent = text;
      plot.classList.toggle('none', !text);
      if (!d) return;
      if (d.genre) meta.append(h('span', d.genre.split(/[,/]/)[0].trim()));
      if (!youtubeId(d.trailer)) return;
      trailer = d.trailer;
      renderActs(); // aparece o botão Trailer
    });
  };

  const fill = (item, section) => {
    title.textContent = item.name;
    const bits = [item.year, item.rating ? '★ ' + Number(item.rating).toFixed(1) : null, whereStopped(section, item) || null];
    meta.replaceChildren(...bits.filter(Boolean).map((t) => h('span', String(t))));
    // sinopse: a da lista se houver; senão linhas de carregamento até o detalhe chegar (a altura é fixa: sem pulo)
    plot.classList.remove('none');
    if (item.plot) plot.textContent = item.plot;
    else plot.replaceChildren(...skLines(3));
    version = section === 'movies' ? preferredVersion(item.versions) : null;
    trailer = '';
    renderActs();
    // a imagem anterior some (fundo escuro) e entra uma só quando o detalhe decidir qual; se ele demorar, a capa
    artFor = null;
    for (const a of arts) a.classList.remove('on');
    clearTimeout(tArt);
    tArt = setTimeout(() => setArt(item, item.poster, false), 2500);
    clearTimeout(tDetail);
    loadDetail(item, section); // o destaque só chega aqui depois de o foco descansar no título (show espera 220ms)
  };

  return {
    el,
    show(item, section = 'movies', now = false) {
      if (!item || item === cur) return;
      cur = item;
      curSection = section;
      unopen();
      clearTimeout(tShow);
      if (now) fill(item, section);
      else tShow = setTimeout(() => cur === item && fill(item, section), 220);
    },
    pin() {
      pinned = true;
      clearTimeout(tPin);
      tPin = setTimeout(() => { if (!inHero) pinned = false; }, 2500);
    },
    isPinned: () => pinned,
    // Aberto (o título foi clicado): a descrição aparece inteira e o destaque cresce para caber.
    open(card) {
      el.classList.add('open');
      el.dataset.navTrap = '';
      origin = card || null;
    },
    // Volta ao tamanho normal quando o foco volta para os cards (senão o destaque maior cobriria a fileira).
    collapse() { unopen(); },
    destroy() {
      clearTimeout(tShow); clearTimeout(tDetail); clearTimeout(tArt); clearTimeout(tPin);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}

// O destaque segue o card em foco (controle, teclado) ou sob o ponteiro (mouse, dedo). Usado também pelo Histórico.
export function wireStream(el, hero) {
  const pick = (e) => {
    const c = e.target.closest && e.target.closest('.poster.wide');
    if (c && c._item) hero.show(c._item, c._section);
  };
  // foco (controle/teclado) num card: o destaque aberto volta ao tamanho normal para não cobrir a fileira
  const focusPick = (e) => {
    if (e.target.closest && e.target.closest('.poster.wide')) hero.collapse();
    pick(e);
  };
  el.addEventListener('focusin', focusPick);
  el.addEventListener('navfocus', focusPick);
  el.addEventListener('pointerover', (e) => { if (!hero.isPinned()) pick(e); });
}

function streamHome(section, ctx, scroller) {
  const hero = streamHero(ctx);
  const rows = homeContent(section, ctx, scroller, { card: wideCardFor(hero) });
  // primeiro destaque: o que a pessoa estava vendo; senão o mais recente; senão o primeiro da lista
  const first = (section === 'movies' ? continueMovies() : continueSeries())[0]
    || [...visibleItems(section)].sort((a, b) => (b.added || 0) - (a.added || 0))[0];
  if (first) hero.show(first, section, true);
  const el = h('div.stream-home', hero.el, rows.el);
  wireStream(el, hero);
  return { el, destroy: () => { hero.destroy(); rows.destroy(); } };
}

function homeContent(section, ctx, scroller, { card = posterCard } = {}) {
  const sec = C()[section];
  const page = h('div.page');

  const shelf = (title, items, link, onClear) => {
    if (!items.length) return null;
    const row = h('div.shelf-row');
    for (const it of items.slice(0, 30)) row.append(card(section, it, ctx, { where: !!onClear }));
    const nav = rowControls(row);
    const el = h('div.shelf',
      h('div.shelf-head', h('h3', title),
        link ? h('a', { href: link, onclick: (e) => { e.preventDefault(); ctx.navigate(link); } }, 'Ver tudo →') : null,
        onClear ? h('button.link-btn', { title: 'Tirar todos desta fileira', onclick: () => onClear(el) }, 'Limpar') : null,
        nav.pager),
      nav.body);
    return el;
  };

  // "Limpar" some com a fileira na hora; o aviso permite desfazer.
  const clearContinueShelf = (el) => {
    const undo = clearContinue(section);
    el.remove();
    toast('“Continuar assistindo” limpo', 'info', 6000, { label: 'Desfazer', fn: () => { undo(); ctx.rerender(); } });
  };

  page.append(...[
    shelf('Continuar assistindo', section === 'movies' ? continueMovies() : continueSeries(), null, clearContinueShelf),
    shelf('Minha lista', laterItems(section), '#/mylist'),
    shelf('Favoritos', favItems(section), `#/${section}?cat=fav`),
  ].filter(Boolean));
  if (section === 'movies' && sec.items.some((m) => m.added)) {
    const recent = [...visibleItems(section)].sort((a, b) => b.added - a.added).slice(0, 30);
    const sh = shelf('Adicionados recentemente', recent, `#/${section}?cat=all&sort=new`);
    if (sh) page.append(sh);
  }

  // Prateleiras por categoria: mostram o skeleton e só preenchem quando aparecem na tela.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const row = e.target.querySelector('.shelf-row');
      row.classList.remove('sk-row');
      row.replaceChildren(...catItems(section, e.target.dataset.cat).slice(0, 24).map((it) => card(section, it, ctx)));
      syncs.get(e.target)(); // com as capas no lugar, as setas sabem se há para onde andar
    }
  }, { root: scroller, rootMargin: '600px' });

  const syncs = new WeakMap();
  // As fileiras de categoria entram aos poucos: as primeiras já, e mais algumas sempre que a rolagem chega perto
  // do fim. Montar todas de uma vez (são 100+ em listas grandes, com os cartões de carregamento) deixava a página
  // com milhares de elementos que o navegador acompanha a cada quadro de rolagem; era o que travava o ↑/↓ na TV.
  const cats = visibleCats(section);
  let next = 0;
  const sentinel = h('div.sentinel');
  const addShelves = (n) => {
    for (const c of cats.slice(next, next + n)) {
      const nav = rowControls(h('div.shelf-row.sk-row', skPosters(Math.min(8, c.count))));
      const el = h('div.shelf',
        h('div.shelf-head', h('h3', c.name), h('span.faint', c.count.toLocaleString('pt-BR')),
          h('a', { href: `#/${section}?cat=${encodeURIComponent(c.id)}`, onclick: (e) => { e.preventDefault(); ctx.navigate(`#/${section}?cat=${encodeURIComponent(c.id)}`); } }, 'Ver tudo →'),
          nav.pager),
        nav.body);
      syncs.set(el, nav.sync);
      el.dataset.cat = c.id;
      sentinel.before(el);
      io.observe(el);
    }
    next += n;
    if (next >= cats.length) { moreIo.disconnect(); sentinel.remove(); }
  };
  const moreIo = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    // observa de novo: se o marcador continuar perto da tela, o aviso volta e entram mais fileiras
    moreIo.unobserve(sentinel);
    addShelves(6);
    if (next < cats.length) moreIo.observe(sentinel);
  }, { root: scroller, rootMargin: '1200px' });
  page.append(sentinel);
  addShelves(8);
  if (next < cats.length) moreIo.observe(sentinel);
  return { el: page, destroy: () => { io.disconnect(); moreIo.disconnect(); } };
}

function gridContent(section, cat, ctx, scroller) {
  const sec = C()[section];
  const name = cat === 'all' ? `Todos os ${cfg[section].many}` : cat === 'fav' ? 'Favoritos' : sec.catName.get(cat) || cfg[section].title;
  let sort = new URLSearchParams(location.hash.split('?')[1] || '').get('sort') || 'orig';
  let query = '';
  let inc = null;
  const grid = h('div.poster-grid');
  const count = h('span.faint');
  const filter = h('input', { placeholder: `Filtrar ${cfg[section].many}` });
  filter.addEventListener('input', debounce(() => { query = filter.value; fill(); }, 150));
  const chips = h('div.row', { style: { gap: '6px' } });
  const sorts = [['orig', 'Padrão'], ['az', 'A–Z'], ['year', 'Ano'], ['rating', 'Nota']];
  if (section === 'movies') sorts.splice(1, 0, ['new', 'Recentes']);
  const renderChips = () => chips.replaceChildren(...sorts.map(([v, l]) =>
    h('button.chip' + (v === sort ? '.on' : ''), { onclick: () => { sort = v; renderChips(); fill(); } }, l)));
  renderChips();

  const page = h('div.page',
    h('div.grid-head',
      h('button.btn.small.ghost', { onclick: () => ctx.navigate(`#/${section}`) }, ico('back'), 'Início'),
      h('h2', { style: { margin: 0, font: '600 20px var(--font-display)' } }, name), count, h('div.grow'),
      h('label.filter', { style: { width: '220px' } }, ico('search'), filter), chips),
    grid);

  function items() {
    let arr = cat === 'all' ? visibleItems(section) : cat === 'fav' ? favItems(section) : catItems(section, cat);
    if (query) {
      const m = matcher(query);
      arr = arr.filter((x) => m(x.name));
    }
    const cmp = {
      az: (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
      new: (a, b) => (b.added || 0) - (a.added || 0),
      year: (a, b) => (b.year || 0) - (a.year || 0),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    }[sort];
    return cmp ? [...arr].sort(cmp) : arr;
  }

  function fill() {
    inc && inc.destroy();
    grid.replaceChildren();
    const arr = items();
    count.textContent = arr.length.toLocaleString('pt-BR');
    if (!arr.length) grid.append(h('div.empty', { style: { gridColumn: '1/-1' } }, cat === 'fav' ? 'Nenhum favorito ainda.' : 'Nada encontrado.'));
    inc = windowed(grid, arr, (it) => posterCard(section, it, ctx), { root: scroller, batch: 60 });
  }
  fill();
  return { el: page, destroy: () => inc && inc.destroy() };
}

// ---------- detalhe ----------

function favButton(section, item) {
  const b = h('button.btn', {
    html: `${starIcon(isFav(section, item.id))}<span>${isFav(section, item.id) ? 'Nos favoritos' : 'Favoritar'}</span>`,
    onclick: () => {
      const on = toggleFav(section, item.id);
      b.innerHTML = `${starIcon(on)}<span>${on ? 'Nos favoritos' : 'Favoritar'}</span>`;
    },
  });
  return b;
}

function laterButton(section, item) {
  const paint = () => {
    const on = isLater(section, item.id);
    b.classList.toggle('seen-on', on);
    b.innerHTML = '';
    b.append(ico(on ? 'check' : 'plus'), h('span', 'Minha lista'));
    b.title = on ? 'Tirar da minha lista' : 'Salvar para assistir depois';
  };
  const b = h('button.btn', { onclick: () => { toggleLater(section, item.id); paint(); } });
  paint();
  return b;
}

// Todos os botões de um filme, usados pela página do filme e pelo destaque do Streaming (que a substitui).
// refresh: redesenha os botões (o progresso muda ao fechar o player, ao marcar como assistido...).
function movieActions(movie, version, trailer, refresh, box) {
  const p = getProgress(movie.id);
  const resumable = isStarted(p);
  return [
    h('button.btn.primary.big', { onclick: () => playMovie(movie, version, { onClose: refresh }) }, ico('play'),
      resumable ? `Continuar de ${p.t < 3600 ? fmtTime(p.t) : fmtClockSec(p.t)}` : 'Assistir'),
    resumable ? h('button.btn.big', { onclick: () => playMovie(movie, version, { fromStart: true, onClose: refresh }) }, ico('refresh'), 'Do início') : null,
    trailerButton(movie.name, trailer),
    laterButton('movies', movie),
    favButton('movies', movie),
    h('button.btn' + (isWatched(movie.id) ? '.seen-on' : ''), {
      title: isWatched(movie.id) ? 'Clique para desmarcar' : 'Marcar como assistido',
      onclick: () => {
        if (isWatched(movie.id)) clearProgress(movie.id);
        else {
          const dur = (p && p.d) || 1;
          setProgress(movie.id, { kind: 'movie', t: dur, d: dur });
        }
        refresh();
        if (TV.on || KB.on) focusEl(box.querySelector('.btn.primary'));
      },
    }, ico('check'), isWatched(movie.id) ? 'Assistido' : 'Marcar como assistido'),
  ];
}

function heroBase(item, section, ctx) {
  // Fundo: uma imagem só. Espera o detalhe (que pode trazer a imagem larga) e só então põe a larga ou a capa;
  // antes ia a capa e depois a larga por cima, duas imagens carregando.
  const backdrop = h('div.backdrop');
  let artSet = false;
  const setArt = (src, sharp) => {
    if (artSet || !src) return;
    artSet = true;
    backdrop.replaceChildren(h('img', { src, alt: '', referrerpolicy: 'no-referrer' }));
    backdrop.classList.toggle('sharp', sharp);
  };
  const settleArt = () => setArt(item.poster, false); // detalhe sem imagem larga (ou falhou): fica a capa
  const artTimer = setTimeout(settleArt, 2500); // detalhe demorando: não deixa o fundo vazio
  const poster = img(item.poster, item.name, 'cover');
  const meta = h('div.meta');
  const plot = h('p.plot', item.plot || '');
  const credits = h('div.credits');
  const versions = h('div.versions');
  const acts = h('div.acts');
  const favBtn = favButton(section, item);
  const laterBtn = laterButton(section, item);
  const fillMeta = (info = {}) => {
    const year = info.year || item.year;
    const rating = info.rating || item.rating;
    const genre = info.genre || item.genre;
    meta.replaceChildren(
      year ? h('span', String(year)) : null,
      rating ? h('span.badge.gold', '★ ' + Number(rating).toFixed(1)) : null,
      info.duration ? h('span', fmtDur(info.duration)) : null,
      genre ? h('span', genre) : null,
    );
    if (info.plot) plot.textContent = info.plot;
    const cr = [];
    if (info.director) cr.push(`Direção: ${info.director}`);
    if (info.cast) cr.push(`Elenco: ${info.cast}`);
    credits.textContent = cr.join('  ·  ');
    if (info.backdrop) setArt(info.backdrop, true);
  };
  fillMeta();
  // Voltar visível (PC e celular não têm a tecla do controle; na TV ela também funciona)
  const back = h('button.btn.small.ghost.detail-back', { type: 'button', onclick: () => ctx.back(`#/${section}`) }, ico('back'), 'Voltar');
  const inner = h('div.inner', back,
    h('div.hero', poster, h('div', { style: { flex: 1, minWidth: 0 } }, h('h2', item.name), meta, versions, plot, credits, acts)));
  return {
    el: h('div.detail', backdrop, inner), inner, meta, versions, acts, favBtn, fillMeta, plot, laterBtn,
    settleArt: () => { clearTimeout(artTimer); settleArt(); },
    destroy: () => clearTimeout(artTimer),
  };
}

// Aceita o id do YouTube ou um link completo, como vem das listas.
function youtubeId(v) {
  const s = String(v || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Só aparece quando o provedor informa o trailer, que toca dentro do app, numa janela quase do tamanho da tela.
// O player do YouTube só é carregado quando a pessoa pede (ele é pesado, sobretudo na TV).
function trailerButton(name, value) {
  const id = youtubeId(value);
  if (!id) return null;
  return h('button.btn', { title: 'Ver o trailer', onclick: () => openTrailer(name, id) }, ico('play'), 'Trailer');
}

// Trailers vêm mixados bem alto: começam mudos e, quando o player responde, o som entra num nível moderado.
const TRAILER_VOLUME = 30; // % do volume do YouTube
function openTrailer(name, id) {
  const origin = encodeURIComponent(location.origin);
  const frame = h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&rel=0&playsinline=1&modestbranding=1` +
      `&iv_load_policy=3&enablejsapi=1&origin=${origin}`,
    title: `Trailer de ${name}`,
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowfullscreen: true,
  });
  const yt = (func, args = []) => {
    try { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch {}
  };
  let sound = false;
  const onMsg = (e) => {
    if (sound || e.source !== frame.contentWindow) return;
    sound = true; // o player respondeu: liga o som baixo
    yt('setVolume', [TRAILER_VOLUME]);
    yt('unMute');
  };
  window.addEventListener('message', onMsg);
  // pede ao player para conversar por postMessage
  frame.addEventListener('load', () => {
    try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'trailer', channel: 'widget' }), '*'); } catch {}
  });
  // fechar remove o iframe: o vídeo para e o player sai da memória
  modal(`Trailer · ${name}`, h('div.trailer-box', frame), {
    cls: 'trailer',
    onClose: () => { window.removeEventListener('message', onMsg); frame.remove(); },
  });
}

// names: rótulo → nome para mostrar (com o idioma que o app já viu tocar); sem ele, o próprio rótulo.
function versionChips(container, labels, current, onPick, names = {}) {
  container.replaceChildren();
  if (labels.length < 2) return;
  container.append(h('span.lbl', 'Versão'));
  for (const l of labels) {
    container.append(h('button.chip' + (l === current ? '.on' : ''), { onclick: () => onPick(l) }, names[l] || l));
  }
}


function lockedState() {
  return h('div.center-state', ico('lock'), h('h2', 'Conteúdo bloqueado'),
    h('p', 'O controle dos pais está ativo. Para liberar, vá em Configurações → Controle dos pais.'));
}

export function movieView(params, ctx) {
  const movie = C().movies.byId.get(params.get('id'));
  ctx.setTitle('Filmes');
  if (!movie) return { el: h('div.center-state', h('h2', 'Filme não encontrado'), h('p', 'Ele pode ter saído da lista.')) };
  if (adultLocked() && isAdultItem('movies', movie.id)) return { el: lockedState() };
  const d = heroBase(movie, 'movies', ctx);
  let version = preferredVersion(movie.versions);
  let trailer = '';

  function renderActs() {
    versionChips(d.versions, movie.versions.map((v) => v.label), version.label, (l) => {
      version = movie.versions.find((v) => v.label === l);
      setSetting('versionPref', l);
      renderActs();
    }, versionNames(movie.versions));
    d.acts.replaceChildren(...movieActions(movie, version, trailer, renderActs, d.acts));
  }
  renderActs();
  // Sinopse vem à parte no Xtream: skeleton enquanto chega, e some se não houver nenhuma.
  if (movie.versions.some((v) => v.xid)) d.plot.replaceChildren(...skLines(3));
  const endPlot = () => { if (d.plot.querySelector('.sk-box')) d.plot.replaceChildren(); };
  movieDetail(movie).then((info) => {
    if (info) d.fillMeta(info);
    d.settleArt();
    endPlot();
    if (info && info.trailer) {
      trailer = info.trailer;
      renderActs();
      if (TV.on && (!document.activeElement || document.activeElement === document.body)) focusEl(d.acts.querySelector('.btn.primary'));
    }
  }).catch(() => { d.settleArt(); endPlot(); });
  return { el: d.el, destroy: d.destroy };
}

function fmtClockSec(t) {
  const m = Math.floor(t / 60);
  const hh = Math.floor(m / 60);
  return hh ? `${hh}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

export function serieView(params, ctx) {
  const serie = C().series.byId.get(params.get('id'));
  ctx.setTitle('Séries');
  if (!serie) return { el: h('div.center-state', h('h2', 'Série não encontrada'), h('p', 'Ela pode ter saído da lista.')) };
  if (adultLocked() && isAdultItem('series', serie.id)) return { el: lockedState() };
  const d = heroBase(serie, 'series', ctx);
  const seasonsBar = h('div.seasons');
  const epsEl = h('div.episodes');
  d.inner.append(seasonsBar, epsEl);

  const last = getProgress('s:' + serie.id);
  // Xtream: versões no nível da série. M3U: versões no nível do episódio.
  const serieVersions = serie.versions ? serie.versions.map((v) => v.label) : null;
  let versionLabel = (last && last.version) || (serie.versions ? preferredVersion(serie.versions).label : S.settings.versionPref);
  let seasons = [];
  let trailer = '';
  let season = last ? last.season : null;

  function epVersionLabels() {
    const set = new Set();
    for (const s of seasons) for (const e of s.eps) for (const v of e.versions) set.add(v.label);
    return [...set];
  }

  function renderVersions() {
    const labels = serieVersions || epVersionLabels();
    if (!labels.includes(versionLabel)) versionLabel = labels[0];
    versionChips(d.versions, labels, versionLabel, async (l) => {
      versionLabel = l;
      setSetting('versionPref', l);
      if (serieVersions) await load();
      else renderAll();
    });
  }

  function flatEps() {
    const flat = [];
    for (const s of seasons) for (const ep of s.eps) flat.push({ season: s.num, ep });
    return flat;
  }

  const play = (seasonNum, epId, opts = {}) => playEpisode(serie, seasons, seasonNum, epId, { versionLabel, onClose: afterPlay, ...opts });

  // Ao sair do player: atualiza a lista e volta para o episódio em que parou.
  function afterPlay() {
    const last = getProgress('s:' + serie.id);
    if (last) season = last.season;
    renderAll();
    if (TV.on && last) focusEl(epsEl.querySelector(`[data-ep="${CSS.escape(last.ep)}"]`), { center: true });
  }

  function renderActs() {
    const lastNow = getProgress('s:' + serie.id);
    const flat = flatEps();
    const code = (x) => `T${x.season}:E${x.ep.num}`;
    let target = flat[0] ? { ...flat[0], label: `Assistir ${code(flat[0])}` } : null;
    if (lastNow) {
      const i = flat.findIndex((x) => x.season === lastNow.season && x.ep.id === lastNow.ep);
      if (i >= 0 && !isWatched(flat[i].ep.id)) target = { ...flat[i], label: `Continuar ${code(flat[i])}` };
      else if (i >= 0 && flat[i + 1]) target = { ...flat[i + 1], label: `Próximo: ${code(flat[i + 1])}`, fromStart: true };
      else if (i >= 0) target = { ...flat[0], label: 'Assistir de novo', fromStart: true };
    }
    d.acts.replaceChildren(
      target ? h('button.btn.primary.big', { onclick: () => play(target.season, target.ep.id, { fromStart: !!target.fromStart }) }, ico('play'), target.label) : null,
      trailerButton(serie.name, trailer),
      d.laterBtn,
      d.favBtn,
    );
  }

  function toggleWatched(s, ep) {
    if (isWatched(ep.id)) {
      clearProgress(ep.id);
      const last = getProgress('s:' + serie.id);
      if (last && last.done) setProgress('s:' + serie.id, { ...last, done: false });
    } else {
      const dur = ep.dur || (getProgress(ep.id) || {}).d || 1;
      setProgress(ep.id, { kind: 'ep', t: dur, d: dur });
      const flat = flatEps();
      setProgress('s:' + serie.id, {
        kind: 'serie-last', ep: ep.id, season: s.num, num: ep.num, title: ep.title, version: versionLabel,
        done: flat[flat.length - 1].ep.id === ep.id,
      });
    }
    renderActs();
    renderSeasons();
    renderEps();
    if (TV.on) focusEl(epsEl.querySelector(`[data-ep="${CSS.escape(ep.id)}"] .seen-btn`));
  }

  function renderSeasons() {
    seasonsBar.replaceChildren(...seasons.map((s) => {
      const seen = s.eps.filter((e) => isWatched(e.id)).length;
      return h('button.chip' + (s.num === season ? '.on' : ''), { onclick: () => { season = s.num; renderSeasons(); renderEps(); } },
        `Temporada ${s.num}`, h('span.faint', seen ? ` · ${seen}/${s.eps.length}` : ` · ${s.eps.length}`), seen === s.eps.length && seen ? ' ✓' : '');
    }));
  }

  function renderEps() {
    const s = seasons.find((x) => x.num === season);
    epsEl.replaceChildren();
    if (!s) return;
    for (const ep of s.eps) {
      const p = getProgress(ep.id);
      const watched = isWatched(ep.id);
      const r = p && p.d ? p.t / p.d : 0;
      const stopped = isStarted(p);
      const th = img(ep.img || serie.poster, ep.title, 'cover');
      th.append(h('div.play', ico('play')));
      if (watched && !stopped) th.append(h('span.badge.seen.seen-mark', '✓ Assistido'));
      const hasVersion = !!serieVersions || ep.versions.some((v) => v.label === versionLabel);
      const meta = [ep.dur ? fmtDur(ep.dur) : null, stopped ? `Parou em ${fmtTime(p.t)}` : watched ? 'Assistido' : null].filter(Boolean).join(' · ');
      const row = h('div.ep' + (watched && !stopped ? '.watched' : ''), { onclick: () => play(s.num, ep.id) },
        h('div.n', String(ep.num)),
        th,
        h('div.info',
          h('div.t', ep.title, !hasVersion && ep.versions.length ? h('span.faint', `  · só ${ep.versions.map((v) => v.label).join('/')}`) : null),
          h('div.faint', { style: { fontSize: '12px' } }, meta),
          ep.plot ? h('div.d', ep.plot) : null,
          stopped ? h('div.bar', h('i', { style: { width: r * 100 + '%' } })) : null),
        h('button.icon-btn.seen-btn' + (watched ? '.on' : ''), {
          title: watched ? 'Desmarcar como assistido' : 'Marcar como assistido',
          onclick: (e) => { e.stopPropagation(); toggleWatched(s, ep); },
        }, ico('check')));
      row.dataset.ep = ep.id;
      epsEl.append(row);
    }
  }

  function renderAll() {
    renderVersions();
    renderActs();
    renderSeasons();
    renderEps();
  }

  async function load() {
    epsEl.replaceChildren(...skEpisodes(5));
    try {
      const info = await seriesDetail(serie, versionLabel);
      seasons = info.seasons || [];
      for (const season of seasons) for (const ep of season.eps) ep.title = cleanEpisodeTitle(ep.title, serie.name, ep.num);
      trailer = info.trailer || '';
      d.fillMeta(info);
      d.settleArt();
      if (!seasons.some((s) => s.num === season)) season = seasons[0]?.num ?? null;
      if (!seasons.length) {
        renderVersions();
        renderActs();
        seasonsBar.replaceChildren();
        epsEl.replaceChildren(h('div.empty', 'Nenhum episódio disponível.'));
        return;
      }
      renderAll();
    } catch (e) {
      d.settleArt();
      epsEl.replaceChildren(h('div.error-box', 'Não foi possível carregar os episódios: ' + e.message));
    }
  }
  renderVersions();
  renderActs();
  load();
  return { el: d.el, destroy: d.destroy };
}
