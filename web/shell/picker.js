// The project picker in the top bar: the projects, and a New project box (title + recipe, POST /api/projects).
// A failed read says so with a Retry (never "no projects"); the popover stays inside the window at every width.
// The decisions are in picker-view.js.
import { h, icon, button } from './dom.js';
import { createDraft, bindDraft } from './drafts.js';
import { listState, rowWords, popLeft } from './picker-view.js';

const FALLBACK_RECIPES = [
  { id: 'edit', name: 'Edit a video', about: 'Footage in, a finished edit out: rough cut, your review, visuals, export.' },
  { id: 'video', name: 'A video from the idea', about: 'Research, plan, record, edit, titles, thumbnails and upload.' },
  { id: 'short', name: 'Edit a Short', about: 'Like Edit a video, in 9:16.' },
  { id: 'shorts-from-long', name: 'Shorts from a long video', about: 'The agent picks the moments, you keep or drop each, it cuts the ones you kept.' },
];

const recipesOf = (x) => (Array.isArray(x) ? x : Array.isArray(x?.recipes) ? x.recipes : []);

export function mountPicker(el, app) {
  const btn = h('button.calm.picker-btn', { type: 'button', title: 'Projects', 'aria-haspopup': 'dialog' }, icon('folder', true), h('span.picker-name', 'No project'), h('span.caret', '▾'));
  const pop = h('div.popover.picker-pop.px-frame', { hidden: true, role: 'dialog', 'aria-label': 'Projects' });
  el.append(btn, pop);
  let recipes = null, asked = 0;

  const close = () => { pop.hidden = true; btn.classList.remove('on'); };
  btn.addEventListener('click', () => { if (pop.hidden) open(); else close(); });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !el.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) close(); });
  addEventListener('resize', () => { if (!pop.hidden) place(); });

  // inside the window: the popover's width is capped by the window, its left edge moved in when it would run off
  function place() {
    pop.style.left = '0px';
    const a = el.getBoundingClientRect(), w = pop.getBoundingClientRect().width;
    pop.style.left = popLeft(a.left, w, document.documentElement.clientWidth) + 'px';
  }

  async function open() {
    pop.hidden = false; btn.classList.add('on');
    pop.replaceChildren(h('h3', 'Projects'), h('p.muted', 'Reading the projects…'));
    place();
    const n = ++asked;
    let res;
    try { res = { ok: true, projects: await app.api('/api/projects') }; } catch (e) { res = { ok: false, error: e.message }; }
    if (!recipes) { try { recipes = recipesOf(await app.api('/api/recipes')); } catch { recipes = []; } if (!recipes.length) recipes = FALLBACK_RECIPES; }
    if (n !== asked || pop.hidden) return;
    draw(listState(res));
    place();
  }

  function draw(st) {
    const cur = app.project()?.id;
    const list = h('div.picker-list');
    if (st.show === 'error') {
      list.append(h('div.picker-err', { role: 'alert' },
        h('p', h('b', 'Could not read the projects. '), h('span', st.error), '. Your projects are still on disk; this is the link to the server.'),
        button('restore', 'Retry', 'Ask the server again', () => open(), 'small calm')));
    } else if (st.show === 'empty') list.append(h('p.muted', 'No projects yet. Start one below.'));
    for (const p of st.projects) {
      const row = h('button.picker-row' + (p.id === cur ? '.on' : '') + '.calm', { type: 'button', title: p.title || p.id, 'aria-current': p.id === cur ? 'true' : null },
        h('b', p.title || p.id), h('span.picker-sub', rowWords(p, recipes)));
      row.addEventListener('click', () => { close(); app.select(p.id); });
      list.append(row);
    }
    const draft = createDraft('-', 'new-project-title');
    const name = bindDraft(h('input.picker-title', { type: 'text', placeholder: 'What is it called?', maxlength: 120, 'aria-label': 'New project title' }), draft);
    const pick = h('select', { 'aria-label': 'Recipe' }, ...recipes.map((r) => h('option', { value: r.id }, r.name || r.id)));
    const about = h('p.dim.recipe-about', '');
    const showAbout = () => { about.textContent = recipes.find((r) => r.id === pick.value)?.about || ''; };
    pick.addEventListener('change', showAbout); showAbout();
    const make = h('button.go', { type: 'button' }, icon('plus', true), h('span', 'Create'));
    const create = async () => {
      const t = name.value.trim();
      if (!t) { name.focus(); return; }
      make.disabled = true;
      try {
        const p = await app.api('/api/projects', { title: t, recipe: pick.value });
        draft.clear(); close();
        const id = p?.id || p?.project?.id;
        if (id) app.select(id);
        app.toast(`Started “${t}”. Drop your footage into the media bin.`, 'ok');
      } catch (e) { app.toast('Could not create it: ' + e.message, 'error'); }
      make.disabled = false;
    };
    make.addEventListener('click', create);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    pop.replaceChildren(h('h3', 'Projects'), list, h('h3', 'New project'), h('div.picker-new', name, h('div.picker-new-row', pick, make)), about);
  }

  return {
    update(p) { const n = btn.querySelector('.picker-name'); n.textContent = p ? (p.title || p.id) : 'No project'; btn.title = p ? `Project: ${p.title || p.id} (click for all projects)` : 'Projects'; },
    open,
  };
}
