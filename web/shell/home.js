// The Projects home: the page that opens first, and from the tower and the project name in the top bar.
// New project, Pinned and Recent rows, every project as a card (poster, title, recipe, status, times, size), search, sort,
// a recipe filter, select several to send to the Bin, and the Bin. The decisions are in home-logic.js; the form in home-new.js.
//   mountHome(host, app) -> { open(), close(), isOpen(), refresh() }
import { h, icon, debounce } from './dom.js';
import { SORTS, sortProjects, filterProjects, rows } from './home-logic.js';
import { card, showMenu } from './home-card.js';
import { newProjectForm } from './home-new.js';
import { binSection } from './home-bin.js';
import * as A from './home-actions.js';

const FALLBACK_RECIPES = [
  { id: 'edit', name: 'Edit a video', about: 'Footage in, a finished edit out: rough cut, your review, visuals, export.' },
  { id: 'video', name: 'A video from the idea', about: 'Research, plan, record, edit, titles, thumbnails and upload.' },
  { id: 'short', name: 'Edit a Short', about: 'Like Edit a video, in 9:16.' },
  { id: 'shorts-from-long', name: 'Shorts from a long video', about: 'The agent picks the moments, you keep or drop each, it cuts the ones you kept.' },
];
const LS = 'presence.home';

export function mountHome(host, app) {
  const el = h('section.home', { hidden: true, 'aria-label': 'Projects' });
  host.append(el);
  let list = [], recipes = [], sizes = {}, form = null, err = null, loaded = false;
  const view = Object.assign({ sort: 'recent', recipe: '', q: '' }, (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })(), { q: '' });
  let selecting = false; const selected = new Set();
  const recipeName = (id) => recipes.find((r) => r.id === id)?.name || id;
  const save = () => { try { localStorage.setItem(LS, JSON.stringify({ sort: view.sort, recipe: view.recipe })); } catch {} };

  const bin = binSection(app, { onChange: (id) => { load(); if (id) app.toast('Back in your projects.', 'ok'); } });
  const grid = h('div.home-grid');
  const rowsEl = h('div.home-rows');
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
    h('div.home-tools', search, recSel, sortSel, selBtn, importBtn, fileIn), selbar, status, rowsEl, grid, bin.el));

  search.addEventListener('input', debounce(() => { view.q = search.value; paint(); }, 120));
  sortSel.addEventListener('change', () => { view.sort = sortSel.value; save(); paint(); });
  recSel.addEventListener('change', () => { view.recipe = recSel.value; save(); paint(); });

  const ctx = () => ({
    recipeName, current: app.project()?.id, selecting, selected, size: (id) => sizes[id], open: (id) => pick(id), pin: (p) => A.pin(app, p, load),
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
    const filtering = !!(view.q.trim() || view.recipe);
    const shown = sortProjects(filterProjects(list, view, recipeName), view.sort, recipeName);
    const { pinned, recent } = filtering ? { pinned: [], recent: [] } : rows(list);
    rowsEl.replaceChildren(...[['Pinned', pinned], ['Recent', recent]].filter(([, l]) => l.length).map(([t, l]) => h('div.home-row', h('h3', t), h('div.home-strip', ...l.map((p) => card(p, c, true))))));
    grid.replaceChildren(...shown.map((p) => card(p, c)));
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
    if (!recipes.length) { try { const r = await app.api('/api/recipes'); recipes = r?.recipes || []; } catch {} if (!recipes.length) recipes = FALLBACK_RECIPES; }
    loaded = true;
    if (!form) { form = newProjectForm({ app, recipes, projects: () => list, onOpen: (id) => pick(id), onCreated: (id, t) => { if (id) { pick(id); app.toast(`Started “${t}”. Drop your footage into the media bin.`, 'ok'); } else load(); } }); newWrap.append(h('h3', 'New project'), form.el); }
    paint();
    app.api('/api/projects/sizes').then((r) => { sizes = r?.sizes || {}; if (!el.hidden) paint(); }).catch(() => {});
  }

  function open() {
    el.hidden = false; document.body.classList.add('home-open');
    load(); bin.refresh();
    if (location.hash !== '#/-/home') history.replaceState(null, '', app.project() ? `#/${encodeURIComponent(app.project().id)}/home` : '#/-/home');
  }
  function close() { if (el.hidden) return; el.hidden = true; document.body.classList.remove('home-open'); selecting = false; selected.clear(); app.route(); }
  const live = debounce(() => { if (!el.hidden) load(); }, 400);
  app.on('projects', live); app.on('project', live);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden && app.project() && !document.querySelector('.home-dialog-layer, .home-menu') && !e.target.closest?.('input,select')) close(); });
  return { open, close, isOpen: () => !el.hidden, refresh: load, focusNew: () => form?.focus() };
}
