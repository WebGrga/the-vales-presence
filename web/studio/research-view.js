// A research video large: its picture at full size, the numbers, star and hide, and next to it one of the
// project's own thumbnails to compare. Left and right arrows go through the videos, Esc closes.
import { h } from '../shell/dom.js';
import { views, duration, ago, outlierLabel, fileUrl } from './format.js';

export const TIERS = { top: 'Top', typical: 'Typical', flop: 'Flop' };
const TIP = { top: 'Did at least 2x its channel’s usual', typical: 'Close to its channel’s usual', flop: 'Under half its channel’s usual' };
export const tierTag = (v) => (v.tier ? h('span.st-tier', { 'data-tier': v.tier, title: TIP[v.tier] }, TIERS[v.tier]) : null);

// ctx: studio page context; list: the videos to go through; start: index; own(): the project's own thumbnail options; mark(v, patch)
export function openView(ctx, { list, start, own, mark }) {
  let i = start, ownId = null;
  const back = h('div.st-viewer');
  const close = () => { document.removeEventListener('keydown', onKey, true); back.classList.remove('on'); setTimeout(() => back.remove(), 250); };
  const onKey = (e) => {
    if (e.target.tagName === 'SELECT') { if (e.key === 'Escape') close(); return; }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
  };
  const go = (d) => { i = (i + d + list.length) % list.length; draw(); };

  function ownPick() {
    const o = own();
    if (!o.length) return null;
    return o.find((x) => x.id === ownId) || o.find((x) => x.picked) || o[0];
  }

  function draw() {
    const v = list[i], o = outlierLabel(v.outlier), mine = own(), pick = ownPick();
    const big = (src, alt) => h('img', { src, alt, draggable: false });
    const left = h('figure.st-vfig',
      v.thumb ? big(fileUrl(ctx.id, v.thumb), v.title) : h('div.st-thumb-missing', 'no picture'),
      h('figcaption', h('b', v.title), h('span.dim', [v.channel, views(v.views), ago(v.published), v.duration ? duration(v.duration) : ''].filter(Boolean).join(' · '))));
    const sel = h('select', { 'aria-label': 'Compare with your thumbnail' }, ...mine.map((t) => h('option', { value: t.id, selected: pick && t.id === pick.id }, `${t.picked ? '✓ ' : ''}${t.text || t.file}`)));
    sel.addEventListener('change', () => { ownId = sel.value; draw(); });
    const right = pick
      ? h('figure.st-vfig.mine', big(fileUrl(ctx.id, `thumbs/${pick.file}`, pick.mtime), pick.text || pick.file), h('figcaption', h('b', 'Yours'), h('span.dim', pick.title ? `made for “${pick.title}”` : pick.file)))
      : h('div.st-vfig.mine.none', h('p', mine.length ? '' : 'This project has no thumbnail options yet. When it does, compare them here.'));
    const star = h('button.small' + (v.starred ? '.on' : '.calm'), { type: 'button', title: 'A model to learn from: the title and thumbnail agents read it first', on: { click: () => { mark(v, { starred: !v.starred }); draw(); } } }, v.starred ? '★ A model' : '☆ Mark as model');
    const hide = h('button.small.calm', { type: 'button', on: { click: () => { mark(v, { hidden: !v.hidden }); if (list.length > 1) { list.splice(i, 1); i = Math.min(i, list.length - 1); draw(); } else close(); } } }, v.hidden ? 'Bring back' : 'Hide');
    back.replaceChildren(h('div.px-frame.st-vbox', { role: 'dialog', 'aria-label': 'Research video' },
      h('header.st-vhead',
        h('span.st-out', { 'data-level': o.level }, o.text), tierTag(v),
        h('span.dim', `${i + 1} of ${list.length}`), h('span.st-grow'),
        star, hide,
        h('a.small.calm.btn', { href: v.url || '#', target: '_blank', rel: 'noopener noreferrer' }, 'Open on YouTube'),
        h('button.small.calm', { type: 'button', 'aria-label': 'Close', on: { click: close } }, 'Close')),
      h('div.st-vcols', left, h('div.st-vcol', h('label.st-vcmp', h('span', 'Compare with'), mine.length ? sel : h('span.dim', 'no thumbnails yet')), right)),
      h('div.st-vnav', h('button.small.calm', { type: 'button', on: { click: () => go(-1) } }, '← Previous'), h('button.small.calm', { type: 'button', on: { click: () => go(1) } }, 'Next →'))));
  }

  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  draw();
  requestAnimationFrame(() => back.classList.add('on'));
}
