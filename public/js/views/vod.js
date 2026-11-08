// Filmes e Séries: prateleiras, grade por categoria e páginas de detalhe.
import { h, ico, img, incremental, matcher, debounce, fmtDur, fmtTime, toast } from '../util.js';
import { starIcon } from '../icons.js';
import {
  C, S, visibleCats, visibleItems, favItems, isFav, toggleFav, getProgress, clearProgress,
  continueMovies, continueSeries, clearContinue, seriesDetail, movieDetail, preferredVersion, setSetting, api,
} from '../store.js';
import { playMovie, playEpisode } from './vodplayer.js';

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

export function posterCard(section, item, ctx) {
  const th = img(item.poster, item.name, 'cover');
  const tags = versionTags(item);
  if (tags) th.append(tags);
  if (item.rating) th.append(h('span.badge.gold.rating', '★ ' + Number(item.rating).toFixed(1)));
  const r = progressRatio(section, item);
  if (r > 0.02 && r < 0.95) th.append(h('div.pbar', h('i', { style: { width: r * 100 + '%' } })));
  if (section === 'series') {
    const last = getProgress('s:' + item.id);
    if (last) th.append(h('div.tags', { style: { top: 'auto', bottom: '8px' } }, h('span.badge', `T${last.season}:E${last.num}`)));
  }
  return h('div.poster', { onclick: () => ctx.navigate(`#/${cfg[section].detail}?id=${encodeURIComponent(item.id)}`), title: item.name },
    th, h('div.pt', item.name), h('div.pm', item.year ? String(item.year) : ' '));
}

// ---------- página inicial da seção ----------

export function vodHome(section) {
  return (params, ctx) => {
    const cat = params.get('cat');
    if (cat) return vodGrid(section, cat, ctx);
    ctx.setTitle(cfg[section].title);
    const sec = C()[section];
    const page = h('div.page');
    const ios = [];

    if (!sec.items.length) {
      page.append(h('div.center-state', { style: { height: '60vh' } }, ico(section === 'movies' ? 'film' : 'series'),
        h('h2', `Nenhum${section === 'series' ? 'a' : ''} ${cfg[section].one} nesta lista`),
        h('p', 'Esta lista só tem canais ao vivo, ou o provedor não liberou esse conteúdo.')));
      return { el: page };
    }

    const shelf = (title, items, link, onClear) => {
      if (!items.length) return null;
      const row = h('div.shelf-row');
      for (const it of items.slice(0, 30)) row.append(posterCard(section, it, ctx));
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
      shelf('Favoritos', favItems(section), `#/${section}?cat=fav`),
    ].filter(Boolean));
    if (section === 'movies' && sec.items.some((m) => m.added)) {
      const recent = [...visibleItems(section)].sort((a, b) => b.added - a.added).slice(0, 30);
      const sh = shelf('Adicionados recentemente', recent, `#/${section}?cat=all&sort=new`);
      if (sh) page.append(sh);
    }

    // Prateleiras por categoria, preenchidas só quando aparecem na tela.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const items = sec.byCat.get(e.target.dataset.cat) || [];
        const row = e.target.querySelector('.shelf-row');
        for (const it of items.slice(0, 24)) row.append(posterCard(section, it, ctx));
      }
    }, { root: document.getElementById('view'), rootMargin: '600px' });
    ios.push(io);

    for (const c of visibleCats(section)) {
      const el = h('div.shelf',
        h('div.shelf-head', h('h3', c.name), h('span.faint', String(c.count)),
          h('a', { onclick: () => ctx.navigate(`#/${section}?cat=${encodeURIComponent(c.id)}`) }, 'Ver tudo →')),
        h('div.shelf-row', { style: { minHeight: '290px' } }));
      el.dataset.cat = c.id;
      page.append(el);
      io.observe(el);
    }

    return { el: page, destroy: () => ios.forEach((x) => x.disconnect()) };
  };
}

// ---------- grade de uma categoria ----------

function vodGrid(section, cat, ctx) {
  const sec = C()[section];
  const name = cat === 'all' ? `Todos os ${cfg[section].many}` : cat === 'fav' ? 'Favoritos' : sec.catName.get(cat) || cfg[section].title;
  ctx.setTitle(cfg[section].title);
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
      h('button.btn.small.ghost', { onclick: () => ctx.navigate(`#/${section}`) }, ico('back'), cfg[section].title),
      h('h2', { style: { margin: 0, font: '600 20px var(--font-display)' } }, name), count, h('div.grow'),
      h('label.filter', { style: { width: '240px' } }, ico('search'), filter), chips),
    grid);

  function items() {
    let arr = cat === 'all' ? visibleItems(section) : cat === 'fav' ? favItems(section) : sec.byCat.get(cat) || [];
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
    if (!arr.length) grid.append(h('div.empty', { style: { gridColumn: '1/-1' } }, 'Nada encontrado.'));
    inc = incremental(grid, arr, (it) => posterCard(section, it, ctx), { root: document.getElementById('view'), batch: 60 });
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
  return { el: h('div.detail', backdrop, inner), inner, meta, versions, acts, favBtn, fillMeta };
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

export function movieView(params, ctx) {
  const movie = C().movies.byId.get(params.get('id'));
  ctx.setTitle('Filmes');
  if (!movie) return { el: h('div.center-state', h('h2', 'Filme não encontrado'), h('p', 'Ele pode ter saído da lista.')) };
  const d = heroBase(movie, 'movies');
  let version = preferredVersion(movie.versions);

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
      d.favBtn,
      S.vlc ? h('button.btn', { onclick: () => openVlc(version.url, movie.name) }, ico('external'), 'VLC') : null,
      resumable ? h('button.icon-btn', { title: 'Remover de "Continuar assistindo"', onclick: () => { clearProgress(movie.id); renderActs(); } }, ico('close')) : null,
    );
  }
  renderActs();
  movieDetail(movie).then((info) => info && d.fillMeta(info)).catch(() => {});
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
  const d = heroBase(serie, 'series');
  const seasonsBar = h('div.seasons');
  const epsEl = h('div.episodes');
  d.inner.append(seasonsBar, epsEl);

  const last = getProgress('s:' + serie.id);
  // Xtream: versões no nível da série. M3U: versões no nível do episódio.
  const serieVersions = serie.versions ? serie.versions.map((v) => v.label) : null;
  let versionLabel = (last && last.version) || (serie.versions ? preferredVersion(serie.versions).label : S.settings.versionPref);
  let seasons = [];
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

  function renderActs() {
    const lastNow = getProgress('s:' + serie.id);
    const first = seasons[0]?.eps[0];
    const target = lastNow && seasons.some((s) => s.num === lastNow.season && s.eps.some((e) => e.id === lastNow.ep))
      ? { season: lastNow.season, id: lastNow.ep, label: `Continuar T${lastNow.season}:E${lastNow.num}` }
      : first ? { season: seasons[0].num, id: first.id, label: `Assistir T${seasons[0].num}:E${first.num}` } : null;
    d.acts.replaceChildren(
      target ? h('button.btn.primary.big', { onclick: () => playEpisode(serie, seasons, target.season, target.id, { versionLabel, onClose: renderAll }) }, ico('play'), target.label) : null,
      d.favBtn,
    );
  }

  function renderSeasons() {
    seasonsBar.replaceChildren(...seasons.map((s) =>
      h('button.chip' + (s.num === season ? '.on' : ''), { onclick: () => { season = s.num; renderSeasons(); renderEps(); } },
        `Temporada ${s.num}`, h('span.faint', ` · ${s.eps.length}`))));
  }

  function renderEps() {
    const s = seasons.find((x) => x.num === season);
    epsEl.replaceChildren();
    if (!s) return;
    for (const ep of s.eps) {
      const p = getProgress(ep.id);
      const r = p && p.d ? p.t / p.d : 0;
      const th = img(ep.img || serie.poster, ep.title, 'cover');
      th.append(h('div.play', ico('play')));
      const hasVersion = !!serieVersions || ep.versions.some((v) => v.label === versionLabel);
      epsEl.append(h('div.ep', { onclick: () => playEpisode(serie, seasons, s.num, ep.id, { versionLabel, onClose: renderAll }) },
        h('div.n', String(ep.num)),
        th,
        h('div.info',
          h('div.t', ep.title, !hasVersion && ep.versions.length ? h('span.faint', `  · só ${ep.versions.map((v) => v.label).join('/')}`) : null),
          h('div.faint', { style: { fontSize: '12px' } }, [ep.dur ? fmtDur(ep.dur) : null, r >= 0.95 ? 'Assistido' : null].filter(Boolean).join(' · ')),
          ep.plot ? h('div.d', ep.plot) : null,
          r > 0.02 ? h('div.bar', h('i', { style: { width: Math.min(100, r * 100) + '%' } })) : null)));
    }
  }

  function renderAll() {
    renderVersions();
    renderActs();
    renderSeasons();
    renderEps();
  }

  async function load() {
    epsEl.replaceChildren(h('div.row', h('div.spinner.small'), h('span.muted', 'Carregando episódios…')));
    try {
      const info = await seriesDetail(serie, versionLabel);
      seasons = info.seasons || [];
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
