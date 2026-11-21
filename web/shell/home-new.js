// The New project form of the Projects home (kept in its own file: it is meant to be redesigned later).
// A title and a recipe, POST /api/projects. Before it creates: a project with the same title asks "open it, or make
// another?", and the Setup check (GET /api/doctor) says what the studio is missing, with a way to the Setup tab.
// The typed title is kept as a draft, so a reload or a close never loses it.
import { h, icon } from './dom.js';
import { createDraft, bindDraft } from './drafts.js';
import { sameTitle } from './home-logic.js';

// -> { el, focus() }. opts: { app, recipes, projects: () => list, onOpen(id), onCreated(id, title) }
export function newProjectForm({ app, recipes, projects, onOpen, onCreated }) {
  const draft = createDraft('-', 'new-project-title');
  const name = bindDraft(h('input', { type: 'text', placeholder: 'What is the project called?', maxlength: 120, 'aria-label': 'New project title' }), draft);
  const pick = h('select', { 'aria-label': 'Recipe' }, ...recipes.map((r) => h('option', { value: r.id }, r.name || r.id)));
  const about = h('p.dim.recipe-about');
  const showAbout = () => { about.textContent = recipes.find((r) => r.id === pick.value)?.about || ''; };
  pick.addEventListener('change', showAbout); showAbout();
  const make = h('button.go', { type: 'button' }, icon('plus', true), h('span', 'Create'));
  const note = h('div.home-new-note', { hidden: true, role: 'status' });
  const say = (...kids) => { note.replaceChildren(...kids); note.hidden = !kids.length; };
  let setup = null; // the doctor's answer, asked once the box is touched
  const askSetup = () => (setup ||= app.api('/api/doctor').catch(() => null));
  name.addEventListener('focus', askSetup);

  async function create(force = false) {
    const t = name.value.trim();
    if (!t) { say(h('p', 'Give it a name first.')); name.focus(); return; }
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
    try {
      const p = await app.api('/api/projects', { title: t, recipe: pick.value });
      draft.clear(); name.value = '';
      onCreated(p?.id || p?.project?.id, t);
    } catch (e) { say(h('p.err', 'Could not create it: ' + e.message)); }
    make.disabled = false;
  }
  make.addEventListener('click', () => create());
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  name.addEventListener('input', () => say());

  const el = h('div.home-new', h('div.home-new-row', name, pick, make), about, note);
  return { el, focus: () => name.focus() };
}
