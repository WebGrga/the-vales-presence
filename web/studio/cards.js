// What title and thumbnail cards share: star, pick, hide, and a note saved as you type.
import { h } from '../shell/dom.js';
import { keepDraft, takeDraft, settleDraft, saver } from './persist.js';

export function optionOp(ctx, kind, op, id, text) {
  return ctx.api(`/api/studio/${ctx.id}/options`, { kind, op, id, text }).then((r) => { ctx.reload(); return r; }).catch((e) => ctx.toast(e.message || String(e), 'error'));
}

export function actions(ctx, kind, doc, o) {
  const starred = doc.shortlist.includes(o.id), picked = doc.picked === o.id;
  const star = h('button.small' + (starred ? '.on' : '.calm'), { type: 'button', title: starred ? 'Take it out of the feed test' : 'Put it in the feed test', on: { click: () => optionOp(ctx, kind, 'star', o.id) } }, starred ? '★ In the feed' : '☆ To the feed');
  const pick = h('button.small' + (picked ? '.go' : ''), { type: 'button', title: picked ? 'Your pick (click to unpick)' : 'Pick this one', on: { click: () => optionOp(ctx, kind, picked ? 'unpick' : 'pick', o.id) } }, picked ? '✓ Picked' : 'Pick');
  const hide = o.hidden
    ? h('button.small.calm', { type: 'button', on: { click: () => optionOp(ctx, kind, 'show', o.id) } }, 'Bring back')
    : h('button.small.calm', { type: 'button', title: 'Hide it (the file stays)', on: { click: () => optionOp(ctx, kind, 'hide', o.id) } }, 'Hide');
  return h('div.st-acts', pick, o.hidden ? null : star, hide);
}

// a note on one option: the draft is kept at once, sent after a pause
const notes = new Map();
export function noteBox(ctx, kind, doc, o) {
  const key = `${kind}.note.${o.id}`;
  const server = doc.notes[o.id] || '';
  const d = takeDraft(ctx.id, key);
  const box = h('textarea.st-optnote', { rows: 1, placeholder: 'A note for the agent (what to change, why you like it)…', 'aria-label': 'Note' });
  box.value = d && d.value !== server ? d.value : server;
  let s = notes.get(`${ctx.id}.${key}`);
  if (!s) {
    s = saver({ send: async (text) => { await ctx.api(`/api/studio/${ctx.id}/options`, { kind, op: 'note', id: o.id, text }); settleDraft(ctx.id, key, text); } });
    notes.set(`${ctx.id}.${key}`, s);
  }
  if (d && d.value !== server) s.push(d.value);
  box.addEventListener('input', () => { keepDraft(ctx.id, key, box.value); s.push(box.value); fit(); });
  const fit = () => { box.style.height = 'auto'; box.style.height = Math.min(160, box.scrollHeight + 2) + 'px'; };
  requestAnimationFrame(fit);
  return box;
}

export function flushNotes() { return Promise.all([...notes.values()].map((s) => s.flush())); }

export function hiddenToggle(count, open, onToggle) {
  if (!count) return null;
  return h('button.small.calm.st-hidden-toggle', { type: 'button', on: { click: onToggle } }, open ? `Hide the hidden (${count})` : `Show hidden (${count})`);
}

export function empty(text, ...more) {
  return h('div.st-empty.px-frame', h('p', text), ...more);
}
