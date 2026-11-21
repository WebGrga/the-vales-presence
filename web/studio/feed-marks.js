// Marks under each feed tile (E45): "I like it", and "Got why" or "Missed why" (did you see why a stranger would click?).
// A Missed why with your words becomes a lesson in your house rules, so the agent stops making the same mistake;
// the words you type are kept as you type and survive a redraw.
import { h } from '../shell/dom.js';
import { keepDraft, takeDraft, dropDraft } from './persist.js';

// ctx; tile = { key, kind: 'ours'|'real', title }; get() -> the marks object; set(marks) stores the server's answer
export function marksRow(ctx, tile, get, set) {
  const k = tile.key, dk = `feed.words.${k}`;
  const like = h('button.yt-mk', { type: 'button', 'aria-pressed': 'false', title: 'You would click this one', on: { click: () => send({ like: !(get()[k]?.like) }) } }, '♥ I like it');
  const got = h('button.yt-mk', { type: 'button', title: 'You see why someone would click it', on: { click: () => send({ why: get()[k]?.why === 'got' ? null : 'got' }) } }, 'Got why');
  const missed = h('button.yt-mk', { type: 'button', title: 'You do not see why someone would click it', on: { click: () => { const on = get()[k]?.why !== 'missed'; box.hidden = !on; if (on) words.focus(); send({ why: on ? 'missed' : null }); } } }, 'Missed why');
  const words = h('input.yt-words', { type: 'text', maxlength: 400, placeholder: tile.kind === 'ours' ? 'What did you read wrong? (this becomes a lesson)' : 'What did you not see? (this becomes a lesson)', 'aria-label': 'Your words' });
  const state = h('span.yt-mk-note');
  const box = h('div.yt-why', { hidden: true }, words, h('button.yt-mk', { type: 'button', on: { click: () => saveWords() } }, 'Save'), state);
  const el = h('div.yt-marks', like, got, missed, box);
  let busy = Promise.resolve(), waiting = 0;

  function send(change) {
    // one change after another; only the last answer repaints, so an older answer never undoes what you just clicked
    waiting++;
    busy = busy.then(() => ctx.api(`/api/studio/${ctx.id}/marks`, { key: k, kind: tile.kind, title: tile.title, ...change }))
      .then((r) => { set(r.marks); if (waiting === 1) paint(r.lesson); })
      .catch((e) => { ctx.toast(e.message || String(e), 'error'); if (waiting === 1) paint(); })
      .finally(() => { waiting--; });
    return busy;
  }
  function saveWords() {
    const v = words.value.trim();
    send({ why: 'missed', words: v }).then(() => { if (v) dropDraft(ctx.id, dk); });
  }
  function paint(lesson) {
    const m = get()[k] || {};
    like.classList.toggle('on', !!m.like); like.setAttribute('aria-pressed', String(!!m.like));
    got.classList.toggle('on', m.why === 'got');
    missed.classList.toggle('on', m.why === 'missed');
    box.hidden = m.why !== 'missed';
    const d = takeDraft(ctx.id, dk);
    if (document.activeElement !== words) words.value = d?.value ?? m.words ?? '';
    state.textContent = lesson || m.lesson ? 'Kept as a lesson in your house rules.' : m.why === 'missed' ? 'Write what you read wrong and it becomes a lesson.' : '';
  }
  words.addEventListener('input', () => keepDraft(ctx.id, dk, words.value));
  words.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveWords(); } });
  words.addEventListener('blur', () => { const m = get()[k]; if (m?.why === 'missed' && words.value.trim() !== (m.words || '')) saveWords(); });
  paint();
  return { el, paint };
}
