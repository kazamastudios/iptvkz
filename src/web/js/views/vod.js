// Filmes e Séries: prateleiras, grade por categoria e páginas de detalhe.
import { h, ico, img, windowed, matcher, debounce, fmtDur, fmtTime, toast, modal, skPosters, skEpisodes, skLines } from '../core/util.js';
import { starIcon } from '../core/icons.js';
import {
  C, S, visibleCats, visibleItems, favItems, isFav, toggleFav, getProgress, setProgress, clearProgress, isWatched,
  continueMovies, continueSeries, clearContinue, catItems, isLater, toggleLater, laterItems, adultLocked, isAdultItem, seriesDetail, movieDetail, preferredVersion, setSetting, api,
} from '../core/store.js';
import { playMovie, playEpisode } from './vodplayer.js';
import { TV, focusEl } from '../tv/tv.js';
import { cleanEpisodeTitle } from '../core/titles.js';

const SHORT = { Dublado: 'DUB', Legendado: 'LEG', Nacional: 'NAC', 'Dual áudio': 'DUAL' };

const cfg = {
  movies: { title: 'Filmes', one: 'filme', many: 'filmes', detail: 'movie' },
  series: { title: 'Séries', one: 'série', many: 'séries', detail: 'serie' },
};

function versionTags(item) {
  const vs = item.versions || [];
  const tags = [...new Set(vs.map((v) => SHORT[v.label.replace(/ \d+$/, '')]).filter(Boolean))];
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
    if (p && p.d && p.t / p.d > 0.02 && p.t / p.d < 0.95) return `Parou em ${fmtTime(p.t)}`;
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

export function posterCard(section, item, ctx, { where = false } = {}) {
  const th = img(item.poster, item.name, 'cover');
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
  return h('div.poster', { onclick: () => ctx.navigate(`#/${cfg[section].detail}?id=${encodeURIComponent(item.id)}`), title: item.name },
    th, h('div.pt', item.name), h('div.pm', (where && whereStopped(section, item)) || (item.year ? String(item.year) : ' ')));
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
      const view = cat === 'home' ? homeContent(section, ctx, content) : gridContent(section, cat, ctx, content);
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

function homeContent(section, ctx, scroller) {
  const sec = C()[section];
  const page = h('div.page');

  const shelf = (title, items, link, onClear) => {
    if (!items.length) return null;
    const row = h('div.shelf-row');
    for (const it of items.slice(0, 30)) row.append(posterCard(section, it, ctx, { where: !!onClear }));
    const el = h('div.shelf',
      h('div.shelf-head', h('h3', title),
        link ? h('a', { onclick: () => ctx.navigate(link) }, 'Ver tudo →') : null,
        onClear ? h('button.link-btn', { title: 'Tirar todos desta fileira', onclick: () => onClear(el) }, 'Limpar') : null),
      row);
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
      row.replaceChildren(...catItems(section, e.target.dataset.cat).slice(0, 24).map((it) => posterCard(section, it, ctx)));
    }
  }, { root: scroller, rootMargin: '600px' });

  for (const c of visibleCats(section)) {
    const el = h('div.shelf',
      h('div.shelf-head', h('h3', c.name), h('span.faint', c.count.toLocaleString('pt-BR')),
        h('a', { onclick: () => ctx.navigate(`#/${section}?cat=${encodeURIComponent(c.id)}`) }, 'Ver tudo →')),
      h('div.shelf-row', skPosters(Math.min(8, c.count))));
    el.dataset.cat = c.id;
    page.append(el);
    io.observe(el);
  }
  return { el: page, destroy: () => io.disconnect() };
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

function heroBase(item, section) {
  const backdrop = h('div.backdrop', item.poster ? h('img', { src: item.poster, alt: '', referrerpolicy: 'no-referrer' }) : null);
  const poster = img(item.poster, item.name, 'cover');
  const meta = h('div.meta');
  const plot = h('p.plot', item.plot || '');
  const credits = h('div.credits');
  const versions = h('div.versions');
  const acts = h('div.acts');
  const favBtn = h('button.btn', {
    html: `${starIcon(isFav(section, item.id))}<span>${isFav(section, item.id) ? 'Nos favoritos' : 'Favoritar'}</span>`,
    onclick: () => {
      const on = toggleFav(section, item.id);
      favBtn.innerHTML = `${starIcon(on)}<span>${on ? 'Nos favoritos' : 'Favoritar'}</span>`;
    },
  });
  const paintLater = () => {
    const on = isLater(section, item.id);
    laterBtn.classList.toggle('seen-on', on);
    laterBtn.innerHTML = '';
    laterBtn.append(ico(on ? 'check' : 'plus'), h('span', 'Minha lista'));
    laterBtn.title = on ? 'Tirar da minha lista' : 'Salvar para assistir depois';
  };
  const laterBtn = h('button.btn', { onclick: () => { toggleLater(section, item.id); paintLater(); } });
  paintLater();
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
    if (info.backdrop) {
      backdrop.replaceChildren(h('img', { src: info.backdrop, alt: '', referrerpolicy: 'no-referrer' }));
      backdrop.classList.add('sharp');
    }
  };
  fillMeta();
  const inner = h('div.inner',
    h('div.hero', poster, h('div', { style: { flex: 1, minWidth: 0 } }, h('h2', item.name), meta, versions, plot, credits, acts)));
  return { el: h('div.detail', backdrop, inner), inner, meta, versions, acts, favBtn, fillMeta, plot, laterBtn };
}

// Aceita o id do YouTube ou um link completo, como vem das listas.
function youtubeId(v) {
  const s = String(v || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Só aparece quando o provedor informa o trailer, que toca dentro do app.
function trailerButton(name, value) {
  const id = youtubeId(value);
  if (!id) return null;
  return h('button.btn', {
    title: 'Ver o trailer',
    onclick: () => {
      modal(`Trailer · ${name}`, h('div.trailer-box', h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
        title: `Trailer de ${name}`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
      })), { wide: true });
    },
  }, ico('play'), 'Trailer');
}

function versionChips(container, labels, current, onPick) {
  container.replaceChildren();
  if (labels.length < 2) return;
  container.append(h('span.lbl', 'Versão'));
  for (const l of labels) {
    container.append(h('button.chip' + (l === current ? '.on' : ''), { onclick: () => onPick(l) }, l));
  }
}

async function openVlc(url, title) {
  try {
    await api('/api/vlc', { method: 'POST', body: JSON.stringify({ url, title }) });
    toast('Abrindo no VLC…', 'ok');
  } catch (e) {
    toast(e.message, 'error');
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
  const d = heroBase(movie, 'movies');
  let version = preferredVersion(movie.versions);
  let trailer = '';

  function renderActs() {
    versionChips(d.versions, movie.versions.map((v) => v.label), version.label, (l) => {
      version = movie.versions.find((v) => v.label === l);
      setSetting('versionPref', l);
      renderActs();
    });
    const p = getProgress(movie.id);
    const resumable = p && p.d && p.t / p.d > 0.02 && p.t / p.d < 0.95;
    d.acts.replaceChildren(
      h('button.btn.primary.big', { onclick: () => playMovie(movie, version, { onClose: renderActs }) }, ico('play'),
        resumable ? `Continuar de ${p.t < 3600 ? fmtTime(p.t) : fmtClockSec(p.t)}` : 'Assistir'),
      resumable ? h('button.btn.big', { onclick: () => playMovie(movie, version, { fromStart: true, onClose: renderActs }) }, ico('refresh'), 'Do início') : null,
      trailerButton(movie.name, trailer),
      d.laterBtn,
      d.favBtn,
      h('button.btn' + (isWatched(movie.id) ? '.seen-on' : ''), {
        title: isWatched(movie.id) ? 'Clique para desmarcar' : 'Marcar como assistido',
        onclick: () => {
          if (isWatched(movie.id)) clearProgress(movie.id);
          else {
            const dur = (p && p.d) || 1;
            setProgress(movie.id, { kind: 'movie', t: dur, d: dur });
          }
          renderActs();
          if (TV.on) focusEl(d.acts.querySelector('.btn.primary'));
        },
      }, ico('check'), isWatched(movie.id) ? 'Assistido' : 'Marcar como assistido'),
      S.vlc && !matchMedia('(hover: none) and (pointer: coarse)').matches ? h('button.btn', { onclick: () => openVlc(version.url, movie.name) }, ico('external'), 'VLC') : null,
      resumable ? h('button.icon-btn', { title: 'Remover de "Continuar assistindo"', onclick: () => { clearProgress(movie.id); renderActs(); } }, ico('close')) : null,
    );
  }
  renderActs();
  // Sinopse vem à parte no Xtream: skeleton enquanto chega, e some se não houver nenhuma.
  if (movie.versions.some((v) => v.xid)) d.plot.replaceChildren(...skLines(3));
  const endPlot = () => { if (d.plot.querySelector('.sk-box')) d.plot.replaceChildren(); };
  movieDetail(movie).then((info) => {
    if (info) d.fillMeta(info);
    endPlot();
    if (info && info.trailer) {
      trailer = info.trailer;
      renderActs();
      if (TV.on && (!document.activeElement || document.activeElement === document.body)) focusEl(d.acts.querySelector('.btn.primary'));
    }
  }).catch(endPlot);
  return { el: d.el };
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
  const d = heroBase(serie, 'series');
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
      const stopped = r > 0.02 && r < 0.95;
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
      epsEl.replaceChildren(h('div.error-box', 'Não foi possível carregar os episódios: ' + e.message));
    }
  }
  renderVersions();
  renderActs();
  load();
  return { el: d.el };
}
