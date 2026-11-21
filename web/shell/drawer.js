// The Activity drawer: a panel from the right edge with four views of the same work, over every tab.
//   Live log (what the agent is doing, step by step), History (every stage run and chat turn), Queue (what runs and
//   waits, across projects) and Spend (per day and per month). Opens from the strip, the top bar button, Ctrl+K.
// Each view is a module with mount(host, app) -> { refresh() }; it is mounted once and refreshed when it is shown.
import { h, icon } from './dom.js';
import { mount as live } from './drawer-live.js';
import { mount as history } from './drawer-history.js';
import { mount as queue } from './drawer-queue.js';
import { mount as spend } from './drawer-spend.js';

export const VIEWS = [
  { id: 'live', label: 'Live log', mount: live },
  { id: 'history', label: 'History', mount: history },
  { id: 'queue', label: 'Queue', mount: queue },
  { id: 'spend', label: 'Spend', mount: spend },
];

export function mountDrawer(app) {
  const tabs = h('div.dr-tabs', { role: 'tablist' });
  const body = h('div.dr-body');
  const close = h('button.icon-only.dr-close', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', on: { click: () => hide() } }, icon('cross', true));
  const el = h('aside.drawer.px-frame', { role: 'dialog', 'aria-label': 'Activity', 'aria-hidden': 'true', inert: true }, h('div.dr-head', h('h2', 'Activity'), h('div.grow'), close), tabs, body);
  document.body.append(el);
  const views = {};
  let current = null, openNow = false;

  for (const v of VIEWS) {
    const b = h('button.small.calm.dr-tab', { type: 'button', role: 'tab', 'data-view': v.id, on: { click: () => show(v.id) } }, v.label);
    tabs.append(b);
    views[v.id] = { host: h('section.dr-view', { hidden: true, 'data-view': v.id }), api: null, mount: v.mount };
    body.append(views[v.id].host);
  }

  function show(id) {
    const v = views[id] || views.live;
    id = views[id] ? id : 'live';
    current = id;
    for (const [k, x] of Object.entries(views)) x.host.hidden = k !== id;
    for (const b of tabs.querySelectorAll('.dr-tab')) { b.classList.toggle('on', b.dataset.view === id); b.setAttribute('aria-selected', b.dataset.view === id ? 'true' : 'false'); }
    if (!v.api) { try { v.api = v.mount(v.host, app); } catch (e) { console.error(e); v.host.replaceChildren(h('p.dr-err', `This view did not open: ${e.message}`)); } }
    v.api?.refresh?.();
    if (!openNow) { openNow = true; el.removeAttribute('inert'); el.setAttribute('aria-hidden', 'false'); el.classList.add('in'); }
  }
  function hide() {
    if (!openNow) return;
    openNow = false; el.classList.remove('in'); el.setAttribute('aria-hidden', 'true'); el.setAttribute('inert', '');
    app.emit('drawer', { type: 'drawer', open: false });
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && openNow && !document.querySelector('.home-dialog-layer, .pal-layer')) { hide(); e.stopPropagation(); } }, true);
  document.addEventListener('pointerdown', (e) => { if (openNow && !el.contains(e.target) && !e.target.closest('.act-strip, .act-btn, .pal-layer, #toasts, .undo-bar')) hide(); });
  app.on('select', () => { if (openNow && current) views[current].api?.refresh?.(); });

  return { open: (id) => show(id || current || 'live'), close: hide, toggle: (id) => (openNow && (!id || id === current) ? hide() : show(id)), isOpen: () => openNow, get view() { return current; }, views: VIEWS.map((v) => v.id) };
}
