// The bet (E51): before you upload, say what you expect this package to move and in which direction; a week after the
// upload the Studio asks how it did, with a place to write the result. Judges are not real click-through: this is the
// real test, against your own usual numbers (the median of your recent uploads).
import { h } from '../shell/dom.js';
import { keepDraft, takeDraft, dropDraft, saver } from './persist.js';

const METRICS = [['ctr', 'Click-through rate'], ['views48', 'Views in the first 48 hours'], ['retention', 'Average view duration'], ['subs', 'New subscribers']];
const asked = new Set(); // projects whose "time to check" toast was already shown this session

export function betSection(ctx) {
  const metric = h('select', { 'aria-label': 'What you expect to move' }, ...METRICS.map(([v, l]) => h('option', { value: v }, l)));
  const dir = h('select', { 'aria-label': 'Above or below your usual' }, h('option', { value: 'above' }, 'above'), h('option', { value: 'below' }, 'below'));
  const median = h('input', { type: 'text', maxlength: 40, size: 10, placeholder: 'e.g. 1,200', 'aria-label': 'Your usual number' });
  const note = h('input', { type: 'text', maxlength: 300, placeholder: 'Why this package should do it (one line)', 'aria-label': 'Why', style: 'flex:1;min-width:220px' });
  const result = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'What happened? (the number, and whether the bet held)', 'aria-label': 'The result', style: 'width:100%;max-width:640px' });
  const when = h('p.dim');
  const resBox = h('div.st-bet-result', { hidden: true }, h('h4', 'How did it do?'), result,
    h('div', h('button.small.go', { type: 'button', on: { click: saveResult } }, 'Save the result')));
  const el = h('section.st-bet.st-box.px-frame',
    h('h3', 'Your bet for this upload'),
    h('p.dim', 'Judges are not real click-through. Say now what you expect, and a week after the upload you check it against your own usual numbers.'),
    h('div.st-bet-row', h('span', 'I expect'), metric, h('span', 'to be'), dir, h('span', 'my usual'), median, note),
    when, resBox);
  let data = null, first = true;

  const save = saver({ send: async () => { await ctx.api(`/api/studio/${ctx.id}/bet`, { metric: metric.value, direction: dir.value, median: median.value, note: note.value }); dropDraft(ctx.id, 'bet.fields'); } });
  const changed = () => { keepDraft(ctx.id, 'bet.fields', JSON.stringify({ m: metric.value, d: dir.value, x: median.value, n: note.value })); save.push(metric.value + dir.value + median.value + note.value); };
  for (const f of [metric, dir, median, note]) f.addEventListener('input', changed);
  result.addEventListener('input', () => keepDraft(ctx.id, 'bet.result', result.value));
  async function saveResult() {
    const text = result.value.trim();
    if (!text) { ctx.toast('Write what happened first.', 'error'); return; }
    const r = await ctx.api(`/api/studio/${ctx.id}/bet`, { result: { text } });
    dropDraft(ctx.id, 'bet.result');
    paintDone(r.bet); // at once: a page you are typing in is not redrawn by the reload
    ctx.reload();
  }

  function paintDone(bet) {
    if (!bet?.result) return;
    resBox.hidden = false; when.textContent = ''; el.classList.remove('due');
    resBox.replaceChildren(h('h4', 'The result'), h('p', bet.result.text), h('p.dim', `Written ${new Date(bet.result.at).toLocaleDateString()}. You bet ${METRICS.find(([k]) => k === bet.metric)?.[1].toLowerCase()} ${bet.direction} your usual${bet.median ? ` (${bet.median})` : ''}.`));
  }

  function render(dt) {
    data = dt;
    const p = dt.pack || {}, bet = p.bet, st = p.betState || { phase: 'none' };
    if (first) {
      first = false;
      const d = takeDraft(ctx.id, 'bet.fields');
      let v = bet ? { m: bet.metric, d: bet.direction, x: bet.median, n: bet.note } : { m: 'ctr', d: 'above', x: '', n: '' };
      if (d) { try { const o = JSON.parse(d.value); v = { m: o.m, d: o.d, x: o.x, n: o.n }; save.push('draft'); } catch {} }
      metric.value = v.m; dir.value = v.d; median.value = v.x || ''; note.value = v.n || '';
      const r = takeDraft(ctx.id, 'bet.result'); if (r?.value) result.value = r.value;
    }
    if (!bet) when.textContent = 'No bet yet. It is saved as you type.';
    else if (st.phase === 'none') when.textContent = 'Saved. The check shows here a week after you upload.';
    else if (st.phase === 'waiting') when.textContent = `Saved. Check it in ${st.days} day${st.days === 1 ? '' : 's'} (${new Date(st.due).toLocaleDateString()}).`;
    else if (st.phase === 'due') when.textContent = 'A week has passed since the upload: time to check your bet.';
    else when.textContent = '';
    resBox.hidden = !(st.phase === 'due' || st.phase === 'done');
    el.classList.toggle('due', st.phase === 'due');
    if (st.phase === 'done' && bet?.result) paintDone(bet);
    if (st.phase === 'due' && !asked.has(ctx.id)) { asked.add(ctx.id); ctx.toast('A week since the upload: check your bet on the Upload page.'); }
  }
  return { el, render, flush: () => save.flush() };
}
