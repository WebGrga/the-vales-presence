// The Projects home: the page that opens first, and from the tower and the project name in the top bar.
// New project (recipe cards, topic, footage), every project once as a card (poster, title, recipe, a badge that names the
// stage and what it is doing, times, size) with the pinned ones first, search, sort, a recipe filter, select several to
// send to the Bin, and the Bin. The decisions are in home-logic.js; the form in home-new.js.
//   mountHome(host, app) -> { open(), close(), isOpen(), refresh() }
import { h, icon, debounce } from './dom.js';
import { SORTS, sortProjects, filterProjects, split } from './home-logic.js';
import { card, showMenu } from './home-card.js';
import { newProjectForm } from './home-new.js';
import { binSection } from './home-bin.js';
import * as A from './home-actions.js';

const LS = 'presence.home';

export function mountHome(host, app) {
  const el = h('section.home', { hidden: true, 'aria-label': 'Projects' });
  host.append(el);
  let list = [], recipes = [], sizes = {}, form = null, err = null, loaded = false;
  const view = Object.assign({ sort: 'recent', recipe: '', q: '' }, (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })(), { q: '' });
  let selecting = false; const selected = new Set();
  const recipeName = (id) => recipes.find((r) => r.id === id)?.name || id;
  const recipeIcon = (id) => recipes.find((r) => r.id === id)?.icon || 'film';
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ sort: view.sort, recipe: view.recipe })); } catch {} };

  const bin = binSection(app, { onChange: (id) => { load(); if (id) app.toast('Back in your projects.', 'ok'); } });
  const groups = h('div.home-groups');
  const selbar = h('div.home-selbar', { hidden: true });
  const search = h('input', { type: 'text', placeholder: 'Search projects', 'aria-label': 'Search projects' });
  const sortSel = h('select', { 'aria-label': 'Sort' }, ...SORTS.map(([v, t]) => h('option', { value: v }, 'Sort: ' + t)));
  const recSel = h('select', { 'aria-label': 'Recipe' });
  const selBtn = h('button.calm.small', { type: 'button', on: { click: () => { selecting = !selecting; selected.clear(); paint(); } } }, 'Select');
  const back = h('button.calm.small', { type: 'button', hidden: true, on: { click: () => close() } }, icon('back', true), h('span.back-t', 'Back'));
  const fileIn = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) A.importZip(app, f, (id) => { load(); id && open(); }); });
  const importBtn = h('button.calm.small', { type: 'button', title: 'Bring in a project that was exported as a zip', on: { click: () => fileIn.click() } }, icon('upload', true), h('span', 'Import'));
  const newWrap = h('div.home-newbox');
  const status = h('p.home-status', { role: 'status' });
  el.append(h('div.home-inner',
    h('div.home-head', h('h2.display', 'Projects'), h('div.grow'), back),
    newWrap,
    h('div.home-tools', search, recSel, sortSel, selBtn, importBtn, fileIn), selbar, status, groups, bin.el));

  search.addEventListener('input', debounce(() => { view.q = search.value; paint(); }, 120));
  sortSel.addEventListener('change', () => { view.sort = sortSel.value; save(); paint(); });
  recSel.addEventListener('change', () => { view.recipe = recSel.value; save(); paint(); });

  const ctx = () => ({
    recipeName, recipeIcon, current: app.project()?.id, selecting, selected, size: (id) => sizes[id], open: (id) => pick(id), pin: (p) => A.pin(app, p, load),
    toggle: (id) => { selected.has(id) ? selected.delete(id) : selected.add(id); paint(); },
    menu: (p, x, y) => showMenu([
      { label: 'Open', run: () => pick(p.id) }, { label: p.pinned ? 'Unpin' : 'Pin to the top', run: () => A.pin(app, p, load) }, { line: true },
      { label: 'Rename…', run: () => A.rename(app, p, () => list, load) }, { label: 'Duplicate…', run: () => A.duplicate(app, p, load, pick) },
      { label: 'Open folder', run: () => A.reveal(app, p) }, { label: 'Free space…', run: () => A.freeSpace(app, p, () => { sizes = {}; load(); }) },
      { label: 'Export as zip…', run: () => A.exportZip(app, p) }, { line: true },
      { label: 'Move to the Bin', danger: true, run: () => binThese([p]) }], x, y),
  });

  async function binThese(ps) {
    const wasOpen = app.project() && ps.some((p) => p.id === app.project().id);
    await A.toBin(app, ps, () => { selected.clear(); selecting = false; load(); bin.refresh(); });
    if (wasOpen) app.select(null);
  }
  function pick(id) { close(); app.select(id); }

  function paint() {
    const c = ctx();
    recSel.replaceChildren(h('option', { value: '' }, 'All recipes'), ...recipes.map((r) => h('option', { value: r.id }, r.name)));
    recSel.value = view.recipe; sortSel.value = view.sort;
    selBtn.textContent = selecting ? 'Done selecting' : 'Select'; selBtn.classList.toggle('on', selecting);
    const shown = sortProjects(filterProjects(list, view, recipeName), view.sort, recipeName);
    // one calm layout: each project once, the pinned ones first under their own heading, every card the same size
    const { pinned, rest } = split(shown);
    groups.replaceChildren(...[['Pinned', pinned], [pinned.length ? 'Everything else' : '', rest]].filter(([, l]) => l.length)
      .map(([t, l]) => h('div.home-group', t ? h('h3', t) : null, h('div.home-grid', ...l.map((p) => card(p, c))))));
    status.textContent = err ? '' : !loaded ? 'Reading the projects…' : !list.length ? 'No projects yet. Name your first one above.' : !shown.length ? 'No project matches. Clear the search or the recipe filter.' : '';
    status.hidden = !status.textContent;
    selbar.hidden = !selecting;
    if (selecting) selbar.replaceChildren(h('span', selected.size ? `${selected.size} selected` : 'Click projects to select them'),
      h('button.calm.small', { type: 'button', on: { click: () => { for (const p of shown) selected.add(p.id); paint(); } } }, 'Select all shown'),
      h('button.warn.small', { type: 'button', disabled: !selected.size, on: { click: () => binThese(list.filter((p) => selected.has(p.id))) } }, `Move ${selected.size || ''} to the Bin`.replace('  ', ' ')));
    if (err) status.replaceChildren(), status.append(h('span', 'Could not read the projects: ' + err + '. They are still on disk. '), h('button.small', { type: 'button', on: { click: () => load() } }, 'Retry')), status.hidden = false;
    back.hidden = !app.project();
    back.querySelector('.back-t').textContent = app.project() ? `Back to ${app.project().title || app.project().id}` : 'Back';
  }

  async function load() {
    try { const r = await app.api('/api/projects'); list = Array.isArray(r) ? r : r?.projects || []; err = null; } catch (e) { err = e.message; }
    if (!recipes.length) await loadRecipes();
    loaded = true;
    if (!form && recipes.length) {
      form = newProjectForm({ app, recipes, projects: () => list, onOpen: (id) => pick(id), onRecipes: () => loadRecipes().then(() => { form.update(recipes); paint(); }), onCreated: started });
      // the box can be folded away once you have projects to look at; it stays folded in this browser
      const fold = h('button.calm.small', { type: 'button', 'aria-expanded': 'true', on: { click: () => setFolded(form.el.hidden === false) } });
      const setFolded = (f) => { form.el.hidden = f; fold.textContent = f ? 'Show' : 'Hide'; fold.setAttribute('aria-expanded', String(!f)); try { localStorage.setItem(LS + '.folded', f ? '1' : ''); } catch {} };
      newWrap.append(h('div.home-newhead', h('h3', 'New project'), fold), form.el);
      setFolded(!!list.length && (() => { try { return !!localStorage.getItem(LS + '.folded'); } catch { return false; } })());
    }
    paint();
    app.api('/api/projects/sizes').then((r) => { sizes = r?.sizes || {}; if (!el.hidden) paint(); }).catch(() => {});
  }

  async function loadRecipes() { try { const r = await app.api('/api/recipes'); recipes = r?.recipes || []; } catch (e) { err = err || e.message; } }
  // a project was made: the page opens on the tab its recipe starts on, with the one-line "Next: ..." under the stage bar
  async function started(id, title, start) {
    if (!id) return load();
    close();
    await app.select(id, start.tab);
    app.hint?.(start.hint);
    load();
  }

  function open() {
    el.hidden = false; document.body.classList.add('home-open');
    load(); bin.refresh();
    if (location.hash !== '#/-/home') history.replaceState(null, '', app.project() ? `#/${encodeURIComponent(app.project().id)}/home` : '#/-/home');
  }
  function close() { if (el.hidden) return; el.hidden = true; document.body.classList.remove('home-open'); selecting = false; selected.clear(); app.route(); }
  const live = debounce(() => { if (!el.hidden) load(); }, 400);
  app.on('projects', live); app.on('project', live);
  // the badge on a card says what the agent does: it follows 'live' (a stage starts, sleeps, waits, ends) and the link coming back
  const later = debounce(() => { if (!el.hidden) load(); }, 1500);
  app.on('live', later); app.on('queue', later);
  app.on('agent', (m) => { if (m.event === 'done' || m.event === 'question') later(); });
  app.on('socket', (m) => { if (m.up && m.again) live(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden && app.project() && !document.querySelector('.home-dialog-layer, .home-menu') && !e.target.closest?.('select') && !(e.target.closest?.('input,textarea') && e.target.value)) close(); }); // Esc closes the page unless you are in the middle of typing
  return { open, close, isOpen: () => !el.hidden, refresh: load, focusNew: () => form?.focus() };
}
