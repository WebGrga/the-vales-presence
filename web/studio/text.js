// Plan and script: studio/plan.md and studio/script.md, edited in place and saved as you type.
// The agent may rewrite the file while it is open: an untouched editor takes the new text; while you type, your
// text wins and the server keeps the agent's version in studio/.history.
import { h } from '../shell/dom.js';
import { keepDraft, takeDraft, settleDraft, saver, beacon } from './persist.js';
import { words, readMinutes } from './format.js';

const ABOUT = {
  plan: { title: 'Plan', file: 'studio/plan.md', empty: 'The agent writes the plan at the Plan stage: the promise, the beats, what to film. You can write or change it here; every word is saved as you type.' },
  script: { title: 'Script', file: 'studio/script.md', empty: 'The script: what you will say, beat by beat. The agent drafts it from the plan if the recipe asks; edit it freely.' },
};

export function textSection(ctx, name) {
  const a = ABOUT[name];
  const area = h('textarea.st-text', { spellcheck: true, placeholder: a.empty, 'aria-label': a.title });
  const state = h('span.st-save');
  const count = h('span.dim');
  const note = h('div.st-note', { hidden: true });
  const el = h('section.st-pane.st-textpane',
    h('header.st-head', h('h2', a.title), h('code.dim', a.file), h('span.st-grow'), count, state),
    note, area);

  let base = 0, server = null, lastSent = null, first = true;
  const show = (s, e) => {
    state.textContent = { typing: 'Typing…', saving: 'Saving…', saved: 'Saved', error: `Not saved yet (${e?.message || 'offline'}): kept here, retrying` }[s] || '';
    state.dataset.s = s;
  };
  const counts = () => {
    const w = words(area.value);
    count.textContent = name === 'script' ? `${w} words · about ${readMinutes(area.value)} min spoken` : `${w} words`;
  };
  const tell = (text) => { note.textContent = text; note.hidden = !text; };

  const save = saver({
    status: show,
    send: async (text) => {
      const r = await ctx.api(`/api/studio/${ctx.id}/text`, { name, text, base });
      base = r.mtime; lastSent = text; server = text;
      settleDraft(ctx.id, name, text);
      if (r.conflict) tell(`The agent had changed this file while you typed. Your text is saved; the agent's version is kept in studio/${r.backup}.`);
    },
  });

  area.addEventListener('input', () => { keepDraft(ctx.id, name, area.value, base); save.push(area.value); counts(); });
  const onHide = () => { if (save.pending()) beacon(`/api/studio/${ctx.id}/text`, { name, text: area.value, base }); };
  window.addEventListener('pagehide', onHide);

  function render(data) {
    const t = data[name]?.text ?? '', m = data[name]?.mtime ?? 0;
    if (first) {
      first = false;
      const d = takeDraft(ctx.id, name);
      if (d && typeof d.value === 'string' && d.value !== t) {
        area.value = d.value; base = d.base || m; server = t;
        tell('Your unsaved text from last time is back, and is being saved now.');
        save.push(d.value);
      } else { area.value = t; base = m; server = t; }
      counts();
      return;
    }
    if (t === area.value) { base = m; server = t; return; }
    const untouched = !save.pending() && (area.value === server || area.value === lastSent);
    if (untouched && t !== server) {
      const pos = area.selectionStart;
      area.value = t; base = m; server = t;
      try { area.setSelectionRange(Math.min(pos, t.length), Math.min(pos, t.length)); } catch {}
      counts();
      tell(`The agent updated ${a.file}.`);
      setTimeout(() => tell(''), 6000);
    }
  }

  return { el, render, live: true, flush: () => save.flush(), unmount: () => { onHide(); window.removeEventListener('pagehide', onHide); } };
}
