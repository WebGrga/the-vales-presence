// Research: what a search for the topic found (studio/research/videos.json, kept as runs), as a grid you can star,
// hide and look at large, and what the titles of the top ones share. The query bar above it says what is searched.
// Outlier = the video's views against its channel's usual (the median of its last 30 uploads); tier = top, typical or flop.
import { h } from '../shell/dom.js';
import { views, duration, ago, outlierLabel, fileUrl } from './format.js';
import { empty } from './cards.js';
import { queryBar } from './research-bar.js';
import { runsPanel } from './research-runs.js';
import { openView, tierTag, TIERS } from './research-view.js';

const SORTS = { outlier: 'Outlier', views: 'Views', newest: 'Newest' };
const NOTES_ASK = 'Read studio/research/videos.json (the user searched it from the Research page; do not search again) and write the notes and the thumbs brief into it (skills research-titles step 4 and research-thumbnails). Keep every video, run and mark as it is.';

function css(href) {
  if (document.querySelector(`link[data-studio="${href}"]`)) return;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL(href, import.meta.url).href, 'data-studio': href }));
}

export function researchSection(ctx) {
  css('./research.css');
  let sort = 'outlier', q = '', tier = 'all', showHidden = false, data = null;
  const bar = queryBar(ctx);
  const runs = runsPanel(ctx, (r) => bar.usePhrases(r));
  const sortSel = h('select', { 'aria-label': 'Sort' }, ...Object.entries(SORTS).map(([k, v]) => h('option', { value: k }, v)));
  sortSel.addEventListener('change', () => { sort = sortSel.value; render(data); });
  const find = h('input', { type: 'text', placeholder: 'Filter titles…', 'aria-label': 'Filter titles' });
  find.addEventListener('input', () => { q = find.value.toLowerCase(); render(data); });
  const sub = h('span.dim');
  const tiers = h('div.seg.st-tiers');
  const pats = h('div.st-patterns');
  const notes = h('div.st-notes', { hidden: true });
  const ask = h('button.small.calm', { type: 'button', title: 'Asks the agent (uses your Claude subscription). The search itself is free.', on: { click: () => ctx.say(NOTES_ASK) } }, 'Ask the agent for notes');
  const grid = h('div.st-research');
  const more = h('div.st-research-more');
  const el = h('section.st-pane',
    h('header.st-head', h('h2', 'Research'), sub, h('span.st-grow'), find, sortSel),
    bar.el, runs.el, tiers, notes, pats, grid, more);

  // a mark shows at once; the server keeps it and rewrites what the title and thumbnail agents read
  function mark(v, patch) {
    Object.assign(v, patch);
    if (patch.hidden) v.starred = false;
    ctx.api(`/api/studio/${ctx.id}/research/mark`, { video: v.id, ...patch }).then(() => ctx.reload()).catch((e) => { ctx.toast(e.message || String(e), 'error'); ctx.reload(); });
    render(data);
  }
  const own = () => (data?.thumbs?.options || []).filter((o) => !o.hidden).map((o) => ({ ...o, picked: data.thumbs.picked === o.id, title: data.titles.options.find((t) => t.id === o.title)?.title }));

  function patterns(p) {
    if (!p) return '';
    const rows = p.features.filter((f) => f.top || f.all).slice(0, 7).map((f) => h('div.st-pat',
      h('span.st-pat-label', f.label),
      h('span.st-bar', h('i.top', { style: `width:${f.top}%` }), h('i.all', { style: `width:${f.all}%` })),
      h('span.st-pat-num', `${f.top}% vs ${f.all}%`)));
    return h('details.px-frame.st-patbox', h('summary', h('b', `What the top ${p.topCount} share`), h('span.dim', ' title patterns, tap to open')), h('p.dim', `Top = ${p.topRule}, against all ${p.allCount} (typical and flop videos included). Gold = top, grey = all.`),
      h('div.st-pat-figs',
        h('span', h('b', p.chars.top ?? '?'), ' characters ', h('span.dim', `(all: ${p.chars.all ?? '?'})`)),
        h('span', h('b', p.words.top ?? '?'), ' words ', h('span.dim', `(all: ${p.words.all ?? '?'})`))),
      ...rows,
      p.common.length ? h('div.st-words', h('span.dim', 'Words the top titles repeat: '), ...p.common.map((w) => h('span.st-tag', `${w.word} ×${w.n}`))) : '');
  }

  function card(v, shown) {
    const o = outlierLabel(v.outlier);
    const img = v.thumb ? h('img', { src: fileUrl(ctx.id, v.thumb), alt: '', loading: 'lazy', draggable: false }) : h('div.st-thumb-missing', 'no picture');
    const look = h('button.st-vid-thumb', { type: 'button', title: 'Look at it large and compare with your own thumbnails', 'aria-label': `Look at “${v.title}” large`, on: { click: () => openView(ctx, { list: [...shown], start: shown.indexOf(v), own, mark }) } }, img, v.duration ? h('span.st-dur', duration(v.duration)) : '');
    return h('article.st-vid' + (v.starred ? '.starred' : '') + (v.hidden ? '.hidden' : ''), { 'data-id': v.id },
      look,
      h('div.st-vid-body',
        h('div.st-vid-top',
          h('span.st-out', { 'data-level': o.level, title: Number.isFinite(v.channelMedian) ? `${views(v.views)} against a usual ${views(v.channelMedian)}` : 'No channel average' }, o.text), tierTag(v), h('span.st-grow'),
          h('button.small.st-star' + (v.starred ? '.on' : '.calm'), { type: 'button', 'aria-pressed': v.starred ? 'true' : 'false', title: v.starred ? 'A model: the title and thumbnail agents learn from it. Click to remove.' : 'Mark as a model for the title and thumbnail agents to learn from', on: { click: () => mark(v, { starred: !v.starred }) } }, v.starred ? '★' : '☆'),
          h('button.small.calm', { type: 'button', title: v.hidden ? 'Bring it back' : 'Hide it from the research (it is kept)', on: { click: () => mark(v, { hidden: !v.hidden }) } }, v.hidden ? 'Bring back' : 'Hide')),
        h('div.st-vid-title', v.title),
        h('div.dim', [v.channel, views(v.views), ago(v.published)].filter(Boolean).join(' · ')),
        Number.isFinite(v.channelMedian) ? h('div.dim', `channel usually ${views(v.channelMedian)}${v.subscribers ? ` · ${views(v.subscribers, false)} subscribers` : ''}`) : '',
        v.note ? h('p.st-why', v.note) : ''));
  }

  function render(dt) {
    data = dt;
    const r = dt.research;
    bar.setData(r);
    runs.render(r);
    const all = r.videos;
    const count = (t) => (t === 'all' ? all.length : t === 'starred' ? all.filter((v) => v.starred).length : t === 'none' ? all.filter((v) => !v.tier).length : all.filter((v) => v.tier === t).length);
    tiers.replaceChildren(...(all.length ? [['all', 'All'], ['top', 'Top'], ['typical', 'Typical'], ['flop', 'Flop'], ['none', 'Unscored'], ['starred', '★ Models']] : []).map(([k, label]) =>
      h('button.small' + (k === tier ? '.on' : ''), { type: 'button', title: k === 'all' ? '' : k === 'starred' ? 'The ones you marked as models' : k === 'none' ? 'No channel average, so no score' : `${TIERS[k]}: ${k === 'top' ? '2x its channel’s usual or more' : k === 'flop' ? 'under half its channel’s usual' : 'in between'}`, on: { click: () => { tier = k; render(data); } } }, `${label} ${count(k)}`)));
    const fits = (v) => (!q || v.title.toLowerCase().includes(q) || (v.channel || '').toLowerCase().includes(q)) && (tier === 'all' || (tier === 'starred' ? v.starred : tier === 'none' ? !v.tier : v.tier === tier));
    let vids = all.filter(fits);
    if (sort === 'views') vids = [...vids].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    if (sort === 'newest') vids = [...vids].sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')));
    find.hidden = sortSel.hidden = !all.length; // nothing to filter or sort before a search has found videos
    sub.textContent = all.length ? `${r.query ? `“${r.query}” · ` : ''}${all.length} videos${r.fetched ? ` · ${ago(r.fetched)}` : ''}` : '';
    notes.hidden = !r.notes; notes.textContent = r.notes || '';
    if (all.length && !r.notes) { notes.hidden = false; notes.replaceChildren(h('span.dim', 'No agent notes yet. '), ask); }
    pats.replaceChildren(all.length ? patterns(r.patterns) : '');
    grid.replaceChildren(...(all.length ? (vids.length ? vids.map((v) => card(v, vids)) : [h('p.dim', 'Nothing matches this filter.')]) : (r.runs.length ? [empty('This run found nothing usable. Change the phrases above and search again.')] : [])));
    const hid = r.hiddenVideos || [];
    more.replaceChildren(...(hid.length ? [
      h('button.small.calm', { type: 'button', on: { click: () => { showHidden = !showHidden; render(data); } } }, showHidden ? `Hide the hidden (${hid.length})` : `Show hidden (${hid.length})`),
      ...(showHidden ? [h('div.st-research.hid', ...hid.map((v) => card(v, hid)))] : [])] : []));
  }

  return { el, render, live: true, unmount: () => bar.unmount() };
}
