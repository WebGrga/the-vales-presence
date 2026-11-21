// The feed preview: your title + thumbnail pairs in a home feed between the real researched videos, light or dark,
// desktop or phone width, so you see them as a viewer would. The pick here is the package (it picks the title and
// the thumbnail too). The look is neutral and plain on purpose: no pixel chrome inside the feed.
import { h } from '../shell/dom.js';
import { views, duration, ago, fileUrl } from './format.js';
import { ourPairs, mixFeed } from './feed-mix.js';
import { keepDraft, takeDraft, settleDraft, saver } from './persist.js';
import { empty } from './cards.js';
import { marksRow } from './feed-marks.js';
import { judgeControl, judgePanel, resultFor } from './judge-ui.js';
import { betSection } from './bet.js';

const hue = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };

export function feedSection(ctx) {
  let data = null, mark = false;
  const feedApi = (body) => ctx.api(`/api/studio/${ctx.id}/feed`, body).then(() => ctx.reload()).catch((e) => ctx.toast(e.message, 'error'));
  const seg = (key, opts) => h('div.seg', { 'data-key': key }, ...opts.map(([v, label]) => h('button.small', { type: 'button', 'data-v': v, on: { click: () => feedApi({ [key]: v }) } }, label)));
  const theme = seg('theme', [['light', 'Light'], ['dark', 'Dark']]);
  const width = seg('width', [['desktop', 'Desktop'], ['phone', 'Phone']]);
  const markBtn = h('button.small.calm', { type: 'button', title: 'Outline your tiles', on: { click: () => { mark = !mark; render(data); } } }, 'Mark mine');
  const shuffle = h('button.small.calm', { type: 'button', on: { click: () => feedApi({ seed: Math.floor(Math.random() * 1e6) }) } }, 'Shuffle');
  const channel = h('input', { type: 'text', placeholder: 'Your channel name', maxlength: 80, 'aria-label': 'Your channel name', size: 16 });
  const chSave = saver({ send: async (v) => { await ctx.api(`/api/studio/${ctx.id}/feed`, { channel: v }); settleDraft(ctx.id, 'feed.channel', v); } });
  channel.addEventListener('input', () => { keepDraft(ctx.id, 'feed.channel', channel.value); chSave.push(channel.value); });
  const stage = h('div.st-feedstage');
  const panel = h('div.st-judgebox');
  const bet = betSection(ctx);
  const judge = judgeControl(ctx, () => data, () => ourPairs(data.titles, data.thumbs));
  const getMarks = () => data?.pack?.marks || {};
  const setMarks = (m) => { if (data) data.pack = { ...(data.pack || {}), marks: m }; };
  const pairs = h('div.st-pairs');
  const el = h('section.st-pane', h('header.st-head', h('h2', 'Feed'), h('span.dim', 'your options among the real videos'), h('span.st-grow'), judge.el, channel, theme, width, shuffle, markBtn), panel, stage, pairs, bet.el);
  let first = true;

  function tile(t, f) {
    const ours = t.kind === 'ours';
    const v = ours ? null : t.video;
    const title = ours ? t.title.title : v.title;
    const src = ours ? fileUrl(ctx.id, `thumbs/${t.thumb.file}`, t.thumb.mtime) : fileUrl(ctx.id, v.thumb);
    const ch = ours ? (f.channel || 'Your channel') : (v.channel || '');
    const dur = ours ? duration(data.upload?.video?.duration) : duration(v.duration);
    const line = ours ? 'New' : [views(v.views), ago(v.published)].filter(Boolean).join(' · ');
    const mk = marksRow(ctx, { key: ours ? t.key : v.id, kind: t.kind, title }, getMarks, setMarks);
    const res = ours ? resultFor(data.pack?.judge, t.key) : null;
    const hasBar = Number.isFinite(data.pack?.judge?.bar);
    return h('div.yt-tile' + (ours ? '.ours' : '') + (ours && mark ? '.marked' : ''), { 'data-key': ours ? t.key : v.id },
      h('div.yt-thumb', h('img', { src, alt: '', loading: 'lazy', draggable: false }), dur ? h('span.yt-dur', dur) : '',
        res && res.score !== null ? h('span.yt-score' + (hasBar && res.score >= data.pack.judge.bar ? '.pass' : ''), { title: hasBar ? `Judges ${res.score}, the bar ${data.pack.judge.bar}` : 'The judges' }, `${res.score}`) : ''),
      h('div.yt-row',
        h('span.yt-av', { style: `--h:${hue(ch)}` }, (ch[0] || '?').toUpperCase()),
        h('div.yt-txt', h('div.yt-title', title), h('div.yt-sub', ch), h('div.yt-sub', ours ? h('span.yt-new', 'New') : line))),
      mk.el);
  }

  function render(dt) {
    data = dt;
    const f = dt.feed;
    bet.render(dt);
    if (first) { first = false; const d = takeDraft(ctx.id, 'feed.channel'); channel.value = d && d.value !== f.channel ? d.value : f.channel; if (d && d.value !== f.channel) chSave.push(d.value); }
    for (const [box, v] of [[theme, f.theme], [width, f.width]]) for (const b of box.children) b.classList.toggle('on', b.dataset.v === v);
    markBtn.classList.toggle('on', mark); markBtn.classList.toggle('calm', !mark);
    const ours = ourPairs(dt.titles, dt.thumbs);
    if (!ours.length) {
      stage.replaceChildren(empty('The feed needs at least one title and one thumbnail. Star the ones to compare (☆ To the feed) on the Titles and Thumbnails pages; with none starred it shows your picks or the first options.'));
      pairs.replaceChildren();
      panel.replaceChildren();
      return;
    }
    const tiles = mixFeed(dt.research.videos, ours, { total: f.width === 'phone' ? 8 : 12, seed: f.seed });
    const chips = ['All', ...((dt.research.patterns?.common || []).slice(0, 5).map((w) => w.word))];
    stage.replaceChildren(h('div.yt.' + f.theme + '.' + f.width,
      h('div.yt-top', h('span.yt-burger', '≡'), h('span.yt-search', 'Search'), h('span.yt-me', (f.channel || 'Y')[0].toUpperCase())),
      h('div.yt-chips', ...chips.map((c, i) => h('span.yt-chip' + (i === 0 ? '.on' : ''), c))),
      h('div.yt-grid', ...tiles.map((t) => tile(t, f)))));
    panel.replaceChildren(judgePanel(ctx, dt.pack?.judge, ours));
    const picked = f.picked ? `${f.picked.title}+${f.picked.thumb}` : null;
    pairs.replaceChildren(h('h3', 'Your pairs'), h('p.dim', 'Pick the package you would click. It becomes the picked title and thumbnail the upload uses.'),
      h('div.st-pairlist', ...ours.map((p) => h('div.st-pair' + (picked === p.key ? '.picked' : ''),
        h('img', { src: fileUrl(ctx.id, `thumbs/${p.thumb.file}`, p.thumb.mtime), alt: '', draggable: false }),
        h('div.st-pair-title', p.title.title, p.thumb.promise || p.title.promise ? h('div.dim.st-pair-promise', h('b', 'The promise: '), p.thumb.promise || p.title.promise) : null, (() => { const r = resultFor(dt.pack?.judge, p.key); return r && r.score !== null ? h('div.st-pair-score' + (Number.isFinite(dt.pack.judge.bar) && r.score >= dt.pack.judge.bar ? '.pass' : ''), `Judges: ${r.score}${Number.isFinite(dt.pack.judge.bar) ? ` against a bar of ${dt.pack.judge.bar}` : ''}`) : ''; })()),
        picked === p.key
          ? h('button.small.go', { type: 'button', on: { click: () => feedApi({ picked: null }) } }, '✓ Your package')
          : h('button.small', { type: 'button', on: { click: () => feedApi({ picked: { title: p.title.id, thumb: p.thumb.id } }) } }, 'Pick this package')))));
  }

  judge.resume();
  return { el, render, flush: () => Promise.all([chSave.flush(), bet.flush()]), unmount: () => judge.stop() };
}
