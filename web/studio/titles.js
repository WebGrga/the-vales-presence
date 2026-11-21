// Titles: the agent's options in studio/titles.json as cards. Pick one, star the ones to test in the feed,
// edit the words (the original stays), add your own, leave a note for the agent.
import { h } from '../shell/dom.js';
import { titleLength } from './format.js';
import { actions, noteBox, optionOp, hiddenToggle, empty } from './cards.js';
import { keepDraft, takeDraft, dropDraft } from './persist.js';

export function titlesSection(ctx) {
  const list = h('div.st-titles');
  const addBox = h('input.st-add', { type: 'text', placeholder: 'Write your own title and press Enter', maxlength: 100, 'aria-label': 'Your own title' });
  const head = h('header.st-head', h('h2', 'Titles'), h('span.dim.st-count'), h('span.st-grow'),
    h('span.dim', 'Pick one · star the ones to test in the feed'));
  const el = h('section.st-pane', head, list, h('div.st-addrow', addBox, h('button.small', { type: 'button', on: { click: add } }, 'Add')));
  let showHidden = false, data = null;

  const d = takeDraft(ctx.id, 'titles.add');
  if (d?.value) addBox.value = d.value;
  addBox.addEventListener('input', () => keepDraft(ctx.id, 'titles.add', addBox.value));
  addBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  async function add() {
    const t = addBox.value.trim();
    if (!t) return;
    const r = await optionOp(ctx, 'titles', 'add', null, t);
    if (r?.id) { addBox.value = ''; dropDraft(ctx.id, 'titles.add'); }
  }

  function card(doc, o) {
    const len = titleLength(o.title);
    const words = h('div.st-title-text', { contenteditable: 'plaintext-only', spellcheck: true, role: 'textbox', 'aria-label': 'Title (edit to change)' }, o.title);
    const key = `titles.edit.${o.id}`;
    const dr = takeDraft(ctx.id, key);
    if (dr?.value && dr.value !== o.title) { words.textContent = dr.value; queueMicrotask(() => commit()); }
    const lenEl = h('span.st-len', { 'data-level': len.level, title: 'Characters: the hook should land in about 45, the whole under about 70' }, `${len.n}`);
    words.addEventListener('input', () => { keepDraft(ctx.id, key, words.textContent); const l = titleLength(words.textContent); lenEl.textContent = l.n; lenEl.dataset.level = l.level; });
    words.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); words.blur(); } });
    words.addEventListener('blur', commit);
    async function commit() {
      const t = words.textContent.replace(/\s+/g, ' ').trim();
      if (!t || t === o.title) { if (!t) words.textContent = o.title; dropDraft(ctx.id, key); return; }
      const r = await optionOp(ctx, 'titles', 'edit', o.id, t);
      if (r && !r.error) dropDraft(ctx.id, key);
    }
    const meta = h('div.st-meta',
      o.family ? h('span.st-tag', o.family) : null,
      o.by === 'you' ? h('span.st-tag.you', 'yours') : null,
      o.original ? h('span.dim', { title: 'The agent wrote' }, `was: ${o.original}`) : null);
    return h('article.st-card.st-title' + (doc.picked === o.id ? '.picked' : '') + (o.hidden ? '.hidden' : ''), { 'data-id': o.id },
      h('div.st-title-row', words, lenEl),
      meta,
      o.why ? h('p.st-why', o.why) : null,
      h('div.st-cardfoot', actions(ctx, 'titles', doc, o), noteBox(ctx, 'titles', doc, o)));
  }

  function render(dt) {
    data = dt;
    const doc = dt.titles;
    const vis = doc.options.filter((o) => !o.hidden), hid = doc.options.filter((o) => o.hidden);
    head.querySelector('.st-count').textContent = vis.length ? `${vis.length} option${vis.length === 1 ? '' : 's'}` : '';
    list.replaceChildren(
      ...(vis.length ? vis.map((o) => card(doc, o)) : [empty('No titles yet. The agent writes them at the Titles stage (skill title-options) into studio/titles.json. You can add your own below.',
        h('button.small', { type: 'button', on: { click: () => ctx.say('Write title options for this video now (skill title-options), into studio/titles.json.') } }, 'Ask the agent for titles'))]),
      hiddenToggle(hid.length, showHidden, () => { showHidden = !showHidden; render(data); }) || '',
      ...(showHidden ? hid.map((o) => card(doc, o)) : []));
  }

  return { el, render };
}
