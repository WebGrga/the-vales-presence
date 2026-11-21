// Research: the niche's top and outlier videos (studio/research/videos.json) as a grid, and what their titles share.
// Outlier = the video's views against its channel's usual (the median of its last 30 uploads).
import { h } from '../shell/dom.js';
import { views, duration, ago, outlierLabel, fileUrl } from './format.js';
import { empty } from './cards.js';

const SORTS = { outlier: 'Outlier', views: 'Views', newest: 'Newest' };

export function researchSection(ctx) {
  let sort = 'outlier', q = '', data = null;
  const sortSel = h('select', { 'aria-label': 'Sort' }, ...Object.entries(SORTS).map(([k, v]) => h('option', { value: k }, v)));
  sortSel.addEventListener('change', () => { sort = sortSel.value; render(data); });
  const find = h('input', { type: 'text', placeholder: 'Filter titles…', 'aria-label': 'Filter titles' });
  find.addEventListener('input', () => { q = find.value.toLowerCase(); render(data); });
  const sub = h('span.dim');
  const pats = h('div.st-patterns');
  const notes = h('div.st-notes', { hidden: true });
  const grid = h('div.st-research');
  const el = h('section.st-pane', h('header.st-head', h('h2', 'Research'), sub, h('span.st-grow'), find, sortSel), notes, pats, grid);

  function patterns(p) {
    if (!p) return '';
    const rows = p.features.filter((f) => f.top || f.all).slice(0, 7).map((f) => h('div.st-pat',
      h('span.st-pat-label', f.label),
      h('span.st-bar', h('i.top', { style: `width:${f.top}%` }), h('i.all', { style: `width:${f.all}%` })),
      h('span.st-pat-num', `${f.top}% vs ${f.all}%`)));
    return h('div.px-frame.st-patbox',
      h('h3', `What the top ${p.topCount} share`), h('p.dim', `Top = ${p.topRule}, against all ${p.allCount}. Gold = top, grey = all.`),
      h('div.st-pat-figs',
        h('span', h('b', p.chars.top ?? '?'), ' characters ', h('span.dim', `(all: ${p.chars.all ?? '?'})`)),
        h('span', h('b', p.words.top ?? '?'), ' words ', h('span.dim', `(all: ${p.words.all ?? '?'})`))),
      ...rows,
      p.common.length ? h('div.st-words', h('span.dim', 'Words the top titles repeat: '), ...p.common.map((w) => h('span.st-tag', `${w.word} ×${w.n}`))) : '');
  }

  function card(v) {
    const o = outlierLabel(v.outlier);
    const img = v.thumb ? h('img', { src: fileUrl(ctx.id, v.thumb), alt: '', loading: 'lazy', draggable: false }) : h('div.st-thumb-missing', 'no picture');
    return h('article.st-vid',
      h('a.st-vid-thumb', { href: v.url || '#', target: '_blank', rel: 'noopener noreferrer', title: 'Open on YouTube' }, img,
        v.duration ? h('span.st-dur', duration(v.duration)) : ''),
      h('div.st-vid-body',
        h('span.st-out', { 'data-level': o.level, title: Number.isFinite(v.channelMedian) ? `${views(v.views)} against a usual ${views(v.channelMedian)}` : 'No channel average' }, o.text),
        h('div.st-vid-title', v.title),
        h('div.dim', [v.channel, views(v.views), ago(v.published)].filter(Boolean).join(' · ')),
        Number.isFinite(v.channelMedian) ? h('div.dim', `channel usually ${views(v.channelMedian)}${v.subscribers ? ` · ${views(v.subscribers, false)} subscribers` : ''}`) : '',
        v.note ? h('p.st-why', v.note) : ''));
  }

  function render(dt) {
    data = dt;
    const r = dt.research;
    let vids = r.videos.filter((v) => !q || v.title.toLowerCase().includes(q) || (v.channel || '').toLowerCase().includes(q));
    if (sort === 'views') vids = [...vids].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
    if (sort === 'newest') vids = [...vids].sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')));
    sub.textContent = r.videos.length ? `${r.query ? `“${r.query}” · ` : ''}${r.videos.length} videos${r.fetched ? ` · ${ago(r.fetched)}` : ''}` : '';
    notes.hidden = !r.notes; notes.textContent = r.notes || '';
    pats.replaceChildren(r.videos.length ? patterns(r.patterns) : '');
    grid.replaceChildren(...(r.videos.length ? vids.map(card) : [empty('No research yet. At the Research stage the agent finds the top and outlier videos of your topic (skills research-titles and research-thumbnails) and saves them here.',
      h('button.small', { type: 'button', on: { click: () => ctx.say('Research this video\'s topic now (skills research-titles and research-thumbnails): find the top and outlier videos and save studio/research/videos.json.') } }, 'Ask the agent to research'))]));
  }

  return { el, render };
}
