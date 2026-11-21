// "From the agent": the things the agent asks you to look at or listen to (video/out/review-items.json, written by the
// rough cut and the Inspect stage), as cards at the top of the Cuts list with timecodes that play from there.
// reviewItems() is pure (tested in cuts-items.test.js); itemsSection() draws them.
import { h, icon } from '../shell/dom.js';
import { inline } from '../shell/markdown.js';
import { fmtTime } from './zoom.js';

const KIND_ICON = { listen: 'wave', look: 'eye', check: 'eye', length: 'clock', private: 'lock', join: 'scissors', question: 'question', pace: 'clock', words: 'text', flag: 'flag' };
const KIND_WORD = { listen: 'Listen', look: 'Look', check: 'Check', length: 'Length', private: 'Private on screen', join: 'A join', question: 'A question', pace: 'Pace', words: 'Words', flag: 'Flagged', other: 'Look at this' };

// { items: [...] } or a bare array (the review-items route's, or the file's) -> [{ id, at, end, text, kind, from, done }]:
// the open ones first, each group in time order (items with no time last)
export function reviewItems(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const num = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Math.max(0, Number(x)));
  return list.filter((x) => x && (x.text || x.title)).map((x, i) => ({
    id: String(x.id ?? `r${i + 1}`),
    at: num(x.at ?? x.t ?? x.start),
    end: num(x.end ?? x.to),
    text: String(x.text || x.title || '').trim(),
    title: x.text && x.title ? String(x.title) : '',
    kind: String(x.kind || '').toLowerCase(),
    from: String(x.from || x.source || x.stage || ''),
    done: !!x.done,
  })).sort((a, b) => (a.done - b.done) || ((a.at ?? Infinity) - (b.at ?? Infinity)));
}

// the section: a fold head and a card per item (the ones still open first); seek(t) plays the edit from t,
// onDone(id, done) marks one looked at (kept by the server, so it stays marked after a reload)
export function itemsSection(items, { seek, folded, onFold, onDone }) {
  if (!items.length) return [];
  const open = items.filter((x) => !x.done).length;
  const head = h('button.cuts-sec.calm.from-agent', { type: 'button' }, icon('agent', true), h('span', 'From the agent'), h('span.dim', open === items.length ? String(items.length) : `${open} of ${items.length} open`), h('span.caret', folded ? '▸' : '▾'));
  const body = h('div.cuts-sec-body', { hidden: !!folded });
  head.addEventListener('click', () => { const f = !body.hidden; body.hidden = f; head.querySelector('.caret').textContent = f ? '▸' : '▾'; onFold?.(f); });
  for (const it of items) {
    const tc = (t) => { const b = h('button.cut-at.small.calm', { type: 'button', title: 'Play from here' }, fmtTime(t)); b.addEventListener('click', () => seek(t)); return b; };
    const text = h('div.item-text');
    text.innerHTML = inline(it.text);
    const done = onDone ? h('button.small.calm.item-done' + (it.done ? '.on' : ''), { type: 'button', title: it.done ? 'Looked at: click to open it again' : 'Mark it looked at' }, it.done ? '✓ Looked at' : 'Looked at') : null;
    done?.addEventListener('click', () => onDone(it.id, !it.done));
    body.append(h('div.item-card' + (it.kind ? '.k-' + it.kind.replace(/[^a-z-]/g, '') : '') + (it.done ? '.done' : ''), { 'data-id': it.id },
      h('div.cut-top', it.at != null ? tc(it.at) : null, it.end != null && it.at != null && it.end > it.at ? [h('span.dim', '–'), tc(it.end)] : null,
        h('span.cut-kind', icon(KIND_ICON[it.kind] || 'flag', true), h('span', it.title || KIND_WORD[it.kind] || 'Look at this')), it.from && it.from !== 'agent' ? h('span.cut-id.dim', it.from) : null),
      text, done ? h('div.item-acts', done) : null));
  }
  body.addEventListener('click', (e) => { const b = e.target.closest('.tc'); if (b) seek(Number(b.dataset.t)); });
  return [head, body];
}
