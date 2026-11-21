// More like this, Mix these two, and side-by-side compare on title and thumbnail cards.
// "More like this" and "Mix" ask the agent (one confirmed turn, like every Studio ask); compare is free and shows
// two options big, next to each other. A selection lives here, so it survives the page drawing again.
import { h } from '../shell/dom.js';
import { fileUrl, titleLength } from './format.js';

const picks = new Map(); // `${project}.${kind}` -> up to two option ids, the older dropped first
const key = (project, kind) => `${project}.${kind}`;
export const selected = (project, kind) => picks.get(key(project, kind)) || [];

export function toggle(project, kind, oid) {
  const cur = selected(project, kind);
  const next = cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid].slice(-2);
  picks.set(key(project, kind), next);
  window.dispatchEvent(new CustomEvent('st-sel', { detail: { project, kind } }));
}

const quote = (t) => `“${String(t).slice(0, 160)}”`;

// the agent's brief for "more like this" / "mix": a sentence the agent can act on, naming the files
export function moreText(kind, o, titleOf) {
  return kind === 'titles'
    ? `More like this title (skill title-options): ${quote(o.title)} (${o.id}). Keep its premise and shape, find 4 new wordings, check each for clarity, judge them as text among the real winners and add the ones above the gate with new ids. Change nothing else.`
    : `More like this thumbnail (skill thumbnail-options): ${o.id} (studio/thumbs/${o.file})${titleOf ? ` made for ${quote(titleOf)}` : ''}. Keep its idea and layout, make 2 new options that vary one thing (the face or logo, the screen crop, the words). Three elements at most, check at 160x90, add them with new ids. Change nothing else.`;
}
export function mixText(kind, a, b) {
  return kind === 'titles'
    ? `Mix these two titles (skill title-options): ${quote(a.title)} (${a.id}) and ${quote(b.title)} (${b.id}). Write 3 new titles that take the strongest part of each, clear to a stranger; judge them as text and add the ones above the gate with new ids. Change nothing else.`
    : `Mix these two thumbnails (skill thumbnail-options): ${a.id} (studio/thumbs/${a.file}) and ${b.id} (studio/thumbs/${b.file}). Make 2 new options that take the best element of each, three elements at most, check at 160x90, add them with new ids. Change nothing else.`;
}

export function moreButton(ctx, kind, o, titleOf) {
  return h('button.small.calm', { type: 'button', title: 'Ask the agent for options like this one', on: { click: () => ctx.say(moreText(kind, o, titleOf)) } }, 'More like this');
}

export function selectButton(ctx, kind, o) {
  const b = h('button.small.calm.st-sel', { type: 'button', 'data-oid': o.id, title: 'Select two to mix them or compare them side by side', on: { click: () => toggle(ctx.id, kind, o.id) } }, 'Select');
  const paint = () => { const on = selected(ctx.id, kind).includes(o.id); b.classList.toggle('on', on); b.textContent = on ? '✓ Selected' : 'Select'; };
  paint();
  const f = (e) => { if (!b.isConnected) { window.removeEventListener('st-sel', f); return; } if (e.detail.project === ctx.id && e.detail.kind === kind) paint(); };
  window.addEventListener('st-sel', f);
  return b;
}

// a strip above the cards: appears when something is selected
export function selectionBar(ctx, kind, getDoc) {
  const el = h('div.st-selbar', { hidden: true });
  const draw = () => {
    const { doc, titles } = getDoc() || {};
    const ids = selected(ctx.id, kind).filter((id) => doc?.options.some((o) => o.id === id && !o.hidden));
    if (ids.length !== selected(ctx.id, kind).length) picks.set(key(ctx.id, kind), ids);
    el.hidden = !ids.length;
    if (!ids.length) { el.replaceChildren(); return; }
    const two = ids.length === 2, [a, b] = ids.map((id) => doc.options.find((o) => o.id === id));
    el.replaceChildren(
      h('span', two ? 'Two selected.' : 'One selected: pick a second to mix or compare.'),
      h('button.small', { type: 'button', disabled: !two, on: { click: () => ctx.say(mixText(kind, a, b)) } }, 'Mix these two'),
      h('button.small', { type: 'button', disabled: !two, on: { click: () => compare(ctx, kind, a, b, doc, titles) } }, 'Compare side by side'),
      h('button.small.calm', { type: 'button', on: { click: () => { picks.set(key(ctx.id, kind), []); window.dispatchEvent(new CustomEvent('st-sel', { detail: { project: ctx.id, kind } })); } } }, 'Clear'));
  };
  const f = (e) => { if (!el.isConnected && el.dataset.seen) { window.removeEventListener('st-sel', f); return; } if (e.detail.project === ctx.id && e.detail.kind === kind) draw(); };
  window.addEventListener('st-sel', f);
  queueMicrotask(() => { el.dataset.seen = '1'; });
  return { el, update: draw };
}

// two options, big, side by side; Esc or a click outside closes
export function compare(ctx, kind, a, b, doc, titles) {
  const pane = (o) => {
    const len = kind === 'titles' ? titleLength(o.title) : null;
    const t = kind === 'thumbs' ? titles?.options.find((x) => x.id === o.title) : null;
    return h('div.st-cmp-pane',
      kind === 'titles'
        ? h('div.st-cmp-title', o.title)
        : h('img.st-cmp-img', { src: fileUrl(ctx.id, `thumbs/${o.file}`, o.mtime), alt: o.text || o.file }),
      h('div.st-meta', len ? h('span.st-len', { 'data-level': len.level }, `${len.n} characters`) : null, o.family ? h('span.st-tag', o.family) : null, o.score !== undefined ? h('span.st-tag', `score ${o.score}`) : null, t ? h('span.dim', `for “${t.title}”`) : null),
      o.promise ? h('p.st-promise', h('b', 'The promise: '), o.promise) : null,
      o.why ? h('p.st-why', o.why) : null,
      h('button.small' + (doc.picked === o.id ? '.go' : ''), { type: 'button', on: { click: async () => { await ctx.api(`/api/studio/${ctx.id}/options`, { kind, op: doc.picked === o.id ? 'unpick' : 'pick', id: o.id }); close(); ctx.reload(); } } }, doc.picked === o.id ? '✓ Picked' : 'Pick this one'));
  };
  const close = () => { document.removeEventListener('keydown', onKey); box.classList.remove('on'); setTimeout(() => box.remove(), 300); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div.st-compare', { role: 'dialog', 'aria-label': 'Compare side by side', on: { click: (e) => { if (e.target === box) close(); } } },
    h('div.st-cmp-card', h('div.st-cmp-head', h('h3', 'Side by side'), h('button.small.calm', { type: 'button', on: { click: close } }, 'Close')), h('div.st-cmp-grid', pane(a), pane(b))));
  document.body.append(box);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => box.classList.add('on'));
}
