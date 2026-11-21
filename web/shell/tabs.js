// The tabs along the top right. Each tab is a module, web/<dir>/index.js, with mount(el, app) (it may return
// { unmount() }). A tab mounts the first time it is shown and stays mounted while hidden, so nothing typed in it is
// lost; when the project changes, the shown tab mounts again and the hidden ones the next time they are shown.
// A module that cannot be loaded, or one that throws, says why and has a Retry (tab-fail.js). Each mount gets its own
// app whose on() listeners are dropped at the next mount.
import { h, icon } from './dom.js';
import { tabsFor, stageTab, currentStage } from './recipe-tabs.js';
import { explain } from './tab-fail.js';

export const TABS = [
  { id: 'edit', dir: 'editor', label: 'Edit', icon: 'scissors' },
  { id: 'shorts', dir: 'shorts', label: 'Shorts', icon: 'phone' },
  { id: 'studio', dir: 'studio', label: 'Studio', icon: 'sparkle' },
  { id: 'context', dir: 'context', label: 'Context', icon: 'book' },
  { id: 'export', dir: 'export', label: 'Export', icon: 'export' },
  { id: 'setup', dir: 'setup', label: 'Setup', icon: 'keep' },
  { id: 'settings', dir: 'settings', label: 'Settings', icon: 'gear' },
];

export function createTabs(bar, host, app) {
  const state = {}; // id -> { el, mounted: projectId|undefined, handle, offs }
  let shown = null;
  for (const t of TABS) {
    const b = h('button.tab.calm', { type: 'button', 'data-tab': t.id, title: `${t.label}` }, icon(t.icon, true), h('span.tab-t', t.label));
    b.addEventListener('click', () => show(t.id));
    bar.append(b);
    const el = h('section.tab-pane', { 'data-tab': t.id, hidden: true });
    host.append(el);
    state[t.id] = { el, mounted: undefined, handle: null, offs: [] };
  }

  // the tabs the recipe uses stay; the others are hidden (the one you are on never is). The tab the current stage wants gets a mark.
  function paintTabs() {
    const p = app.project(), r = p?.recipeDef || null;
    const use = tabsFor(r);
    const want = r ? stageTab(currentStage(p, r)) : null;
    for (const b of bar.querySelectorAll('.tab')) {
      const id = b.dataset.tab;
      b.hidden = !!use && !use.has(id) && id !== shown;
      b.classList.toggle('wants', !!want && id === want && id !== shown && !!currentStage(p, r));
      b.title = id === want && id !== shown && currentStage(p, r) ? `${TABS.find((x) => x.id === id).label}: the ${currentStage(p, r).title || currentStage(p, r).id} stage works here` : TABS.find((x) => x.id === id).label;
    }
  }
  app.on('project', () => setTimeout(paintTabs, 0));
  app.on('project-view', () => paintTabs());

  let tries = 0;
  async function mountTab(t, retry) {
    const s = state[t.id];
    try { s.handle?.unmount?.(); } catch (e) { console.error(e); }
    for (const off of s.offs.splice(0)) off();
    s.el.replaceChildren();
    s.mounted = app.project()?.id ?? null;
    const scoped = { ...app, on: (type, fn) => { const off = app.on(type, fn); s.offs.push(off); return off; } };
    let mod = null;
    try { mod = await import(`../${t.dir}/index.js${retry ? `?retry=${++tries}` : ''}`); } catch (e) { console.error(e); return failed(s.el, t, 'load', e); }
    if (typeof mod?.mount !== 'function') return failed(s.el, t, 'shape');
    try { s.handle = (await mod.mount(s.el, scoped)) || null; } catch (e) { console.error(e); failed(s.el, t, 'mount', e); return; }
    app.emit('mounted', { type: 'mounted', tab: t.id, el: s.el });
  }

  // the tab says why it did not open, and Retry tries again (the state of your project is not touched)
  function failed(el, t, stage, err) {
    const w = explain(t.label, stage, err);
    el.replaceChildren(h('div.coming-soon.tab-failed', { role: 'alert' },
      h('img.icon.big', { src: '/icons/cross.png', alt: '' }),
      h('h2', w.title),
      h('p.muted', w.why),
      h('p.dim', w.hint),
      h('button.go', { type: 'button', on: { click: () => mountTab(t, true) } }, icon('redo', true), h('span', 'Retry'))));
  }

  function show(id) {
    const t = TABS.find((x) => x.id === id) || TABS[0];
    shown = t.id;
    for (const b of bar.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === t.id);
    for (const [k, s] of Object.entries(state)) s.el.hidden = k !== t.id;
    const s = state[t.id], pid = app.project()?.id ?? null;
    if (s.mounted === undefined || s.mounted !== pid) mountTab(t);
    app.emit('tab', { type: 'tab', tab: t.id });
    paintTabs();
    app.route();
  }

  return {
    show,
    get shown() { return shown; },
    projectChanged() {
      // the tab you were on is not one this project's recipe uses: go to Edit instead
      const use = tabsFor(app.project()?.recipeDef);
      if (shown && use && !use.has(shown)) return show('edit');
      if (shown) { const t = TABS.find((x) => x.id === shown); mountTab(t); } paintTabs(); },
  };
}
