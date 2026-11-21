// The tabs along the top right. Each tab is a module, web/<dir>/index.js, with mount(el, app) (it may return
// { unmount() }). A tab mounts the first time it is shown and stays mounted while hidden, so nothing typed in it is
// lost; when the project changes, the shown tab mounts again and the hidden ones the next time they are shown.
// A missing module, or one that throws, shows "coming soon". Each mount gets its own app whose on() listeners are
// dropped at the next mount.
import { h, icon } from './dom.js';

export const TABS = [
  { id: 'edit', dir: 'editor', label: 'Edit', icon: 'scissors' },
  { id: 'shorts', dir: 'shorts', label: 'Shorts', icon: 'phone' },
  { id: 'studio', dir: 'studio', label: 'Studio', icon: 'sparkle' },
  { id: 'context', dir: 'context', label: 'Context', icon: 'book' },
  { id: 'export', dir: 'export', label: 'Export', icon: 'export' },
  { id: 'setup', dir: 'setup', label: 'Setup', icon: 'gear' },
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

  async function mountTab(t) {
    const s = state[t.id];
    try { s.handle?.unmount?.(); } catch (e) { console.error(e); }
    for (const off of s.offs.splice(0)) off();
    s.el.replaceChildren();
    s.mounted = app.project()?.id ?? null;
    const scoped = { ...app, on: (type, fn) => { const off = app.on(type, fn); s.offs.push(off); return off; } };
    let mod = null;
    try { mod = await import(`../${t.dir}/index.js`); } catch (e) {
      if (!/Failed to fetch|404|Cannot find|error loading/i.test(String(e?.message))) console.error(e);
      return soon(s.el, t, null);
    }
    if (typeof mod?.mount !== 'function') return soon(s.el, t, null);
    try { s.handle = (await mod.mount(s.el, scoped)) || null; } catch (e) { console.error(e); soon(s.el, t, e); return; }
    app.emit('mounted', { type: 'mounted', tab: t.id, el: s.el });
  }

  function soon(el, t, err) {
    el.replaceChildren(h('div.coming-soon',
      h('img.icon.big', { src: `/icons/${t.icon}.png`, alt: '' }),
      h('h2', `${t.label}: coming soon`),
      h('p.muted', err ? `This room did not open: ${err.message}` : 'This room is still being built.')));
  }

  function show(id) {
    const t = TABS.find((x) => x.id === id) || TABS[0];
    shown = t.id;
    for (const b of bar.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === t.id);
    for (const [k, s] of Object.entries(state)) s.el.hidden = k !== t.id;
    const s = state[t.id], pid = app.project()?.id ?? null;
    if (s.mounted === undefined || s.mounted !== pid) mountTab(t);
    app.emit('tab', { type: 'tab', tab: t.id });
    app.route();
  }

  return {
    show,
    get shown() { return shown; },
    projectChanged() { if (shown) { const t = TABS.find((x) => x.id === shown); mountTab(t); } },
  };
}
