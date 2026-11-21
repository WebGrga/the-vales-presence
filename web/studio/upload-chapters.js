// "Add chapters" on the Upload page: the video's YouTube chapters (the same lines as the Export tab's Chapters, from the video's chapters or its
// spoken words) added to the end of the description, without an agent. POST /api/export/:id { kind: 'chapters' } -> { text }.
import { h } from '../shell/dom.js';

// pure: the description with the chapter lines added once (a description that has them already is left alone)
export function withChapters(description, text) {
  const d = String(description || '').trimEnd(), t = String(text || '').trim();
  if (!t) return d;
  if (d.includes(t)) return d;
  return d ? `${d}\n\n${t}` : t;
}

export function chaptersButton(ctx, { get, set }) {
  const b = h('button.small.calm', { type: 'button', title: 'Add the video’s chapters (0:00 lines) to the description: no agent needed' }, 'Add chapters');
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await ctx.api(`/api/export/${ctx.id}`, { kind: 'chapters' });
      const next = withChapters(get(), r.text);
      if (next === get()) ctx.toast('The chapters are already in the description.');
      else { set(next); ctx.toast(`${r.count} chapters added to the description.${r.from === 'chapters.json' ? '' : ' They are drafted from the words: check the titles.'}`, 'ok'); }
    } catch (e) { ctx.toast(`No chapters yet: ${e.message}`, 'error'); }
    b.disabled = false;
  });
  return b;
}
