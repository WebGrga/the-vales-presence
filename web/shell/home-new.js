// The New project box of the Projects home: a title, a recipe card (what you bring, what you do, what the agent does, the
// stages as a bar, a rough time and cost), a topic when the recipe starts from an idea, and footage to drop in.
// Before it creates: a project with the same title asks "open it, or make another?", and the Setup check (GET /api/doctor)
// says what the studio is missing. The typed title and topic are kept as drafts, so a reload or a close never loses them.
// After Create the uploads start at once (new-footage.js) and the page opens on the tab the recipe starts on.
import { h, icon } from './dom.js';
import { createDraft, bindDraft } from './drafts.js';
import { sameTitle } from './home-logic.js';
import { recipeCards } from './home-recipes.js';
import { editRecipe } from './home-recipe-edit.js';
import { footagePicker, uploadFootage } from './new-footage.js';
import { startFor } from './recipe-tabs.js';
import { ask } from './home-dialog.js';

const LS_RECIPE = 'presence.home.recipe';
const tabName = (id) => ({ edit: 'Edit', shorts: 'Shorts', studio: 'Studio', context: 'Context', export: 'Export' }[id] || id);

// -> { el, focus(), update(recipes) }. opts: { app, recipes, projects: () => list, onOpen(id), onCreated(id, title, start), onRecipes() }
export function newProjectForm({ app, recipes, projects, onOpen, onCreated, onRecipes }) {
  let list = recipes;
  const draft = createDraft('-', 'new-project-title');
  const topicDraft = createDraft('-', 'new-project-topic');
  const name = bindDraft(h('input', { type: 'text', placeholder: 'What is the project called?', maxlength: 120, 'aria-label': 'New project title' }), draft);
  const topic = bindDraft(h('textarea', { rows: 2, maxlength: 2000, 'aria-label': 'What the video is about' }), topicDraft);
  const topicBox = h('label.home-topic', h('span.home-topic-l', 'What is the video about?'), topic, h('span.dim.home-topic-h'));
  const feet = footagePicker();
  let chosen = (() => { try { return localStorage.getItem(LS_RECIPE); } catch { return null; } })();
  if (!list.some((r) => r.id === chosen)) chosen = list[0]?.id;
  const recipe = () => list.find((r) => r.id === chosen) || list[0] || null;
  const remember = () => { try { localStorage.setItem(LS_RECIPE, chosen); } catch {} };

  const cards = recipeCards({ recipes: list, value: chosen, onPick: (id) => { chosen = id; remember(); paintExtras(); }, onCustomize, onDelete });
  const make = h('button.go', { type: 'button' }, icon('plus', true), h('span', 'Create'));
  const where = h('span.home-where.dim');
  const note = h('div.home-new-note', { hidden: true, role: 'status' });
  const say = (...kids) => { note.replaceChildren(...kids); note.hidden = !kids.length; };
  let setup = null; // the doctor's answer, asked once the box is touched
  const askSetup = () => (setup ||= app.api('/api/doctor').catch(() => null));
  name.addEventListener('focus', askSetup);

  // what the chosen recipe needs: a topic box when it starts from an idea; where Create will open
  function paintExtras() {
    const r = recipe();
    topicBox.hidden = !r?.topic;
    if (r?.topic) {
      topicBox.querySelector('.home-topic-l').textContent = r.topic.label || 'What is the video about?';
      topicBox.querySelector('.home-topic-h').textContent = r.topic.hint || '';
      topic.placeholder = 'For example: why I stopped using a project board';
    }
    const s = r ? startFor(r, { footage: feet.hasFiles(), topic: !!topic.value.trim() }) : null;
    where.textContent = s ? `Opens on the ${tabName(s.tab)} tab.` : '';
  }
  feet.onChange(paintExtras);
  topic.addEventListener('input', paintExtras);

  async function onCustomize(card) {
    const saved = await editRecipe(app, card);
    if (!saved) return;
    chosen = saved.id; remember();
    onRecipes?.();
  }
  async function onDelete(card) {
    const yes = await ask({ title: `Delete “${card.name}”?`, body: [h('p', 'Only the recipe goes. No project uses it, so nothing else is touched.')], ok: 'Delete', danger: true });
    if (!yes) return;
    try { await app.api('/api/recipes/delete', { id: card.id }); app.toast('Recipe deleted.', 'ok'); if (chosen === card.id) chosen = null; onRecipes?.(); } catch (e) { app.toast(e.message, 'error'); }
  }

  async function create(force = false) {
    const t = name.value.trim();
    if (!t) { say(h('p', 'Give it a name first.')); name.focus(); return; }
    if (!recipe()) { say(h('p', 'Pick a recipe first.')); return; }
    if (!force) {
      const twin = sameTitle(projects(), t);
      if (twin) {
        say(h('p', 'You already have ', h('b', twin.title || twin.id), '. Open it, or make another with the same name?'),
          h('div.pop-btns', h('button.calm.small', { type: 'button', on: { click: () => { say(); onOpen(twin.id); } } }, 'Open it'),
            h('button.small', { type: 'button', on: { click: () => create(true) } }, 'Make another')));
        return;
      }
      make.disabled = true; say(h('p.muted', 'Checking that this computer is ready…'));
      const d = await askSetup(); setup = null;
      make.disabled = false;
      const bad = (d?.checks || []).filter((c) => c.required && c.status !== 'ok');
      if (bad.length) {
        say(h('p', h('b', 'The studio is missing something it needs. '), 'Creating works, but it will not run until this is fixed:'),
          h('ul', ...bad.map((c) => h('li', h('b', c.title), ': ', (c.found || c.why || 'not ready').replace(/\.$/, ''), c.fix?.text ? '. ' + c.fix.text : ''))),
          h('div.pop-btns', h('button.calm.small', { type: 'button', on: { click: () => { say(); app.openTab?.('setup'); } } }, 'Open Setup'),
            h('button.small', { type: 'button', on: { click: () => create(true) } }, 'Create anyway')));
        return;
      }
    }
    say(); make.disabled = true;
    const r = recipe(), tp = r.topic ? topic.value.trim() : '', items = [...feet.items()];
    try {
      const p = await app.api('/api/projects', { title: t, recipe: r.id, topic: tp || undefined });
      const id = p?.id || p?.project?.id;
      draft.clear(); name.value = ''; topicDraft.clear(); topic.value = ''; feet.clear();
      if (id && items.length) uploadFootage(app, id, t, items);
      onCreated(id, t, startFor(r, { footage: items.length > 0, topic: !!tp }));
    } catch (e) { say(h('p.err', 'Could not create it: ' + e.message)); }
    make.disabled = false;
    paintExtras();
  }
  make.addEventListener('click', () => create());
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  topic.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) create(); });
  name.addEventListener('input', () => say());

  // the default recipe from Settings (when one is set, the box starts on it)
  app.api('/api/agent/settings').then((d) => { const id = d?.settings?.defaultRecipe; if (id && id !== chosen && list.some((x) => x.id === id)) { chosen = id; cards.set(id); paintExtras(); } }).catch(() => {});
  const el = h('div.home-new', h('div.home-new-row', name), cards.el, topicBox, feet.el, h('div.home-new-go', make, where), note);
  paintExtras();
  return {
    el, focus: () => name.focus(),
    update(next) { list = next; if (!list.some((x) => x.id === chosen)) chosen = list[0]?.id; cards.update(list); cards.set(chosen); paintExtras(); },
  };
}
