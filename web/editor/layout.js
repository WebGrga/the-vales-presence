// The Edit tab on a phone (under 700 px wide): the viewer on top and one panel at a time under it, picked from a row
// of tabs (Cuts, Agent, Words, Timeline, Media), remembered in this browser. The desktop grid is left as it is; the
// CSS in web/style/phone.css only lays it out again. The agent's tab turns orange while it waits for your answer, and
// "Answer" in the stage bar opens it.
import { h, icon } from '../shell/dom.js';

const KEY = 'presence.phonePanel';
export const PANELS = [
  { id: 'cuts', label: 'Cuts', icon: 'scissors' },
  { id: 'agent', label: 'Agent', icon: 'agent' },
  { id: 'tr', label: 'Words', icon: 'text' },
  { id: 'tl', label: 'Timeline', icon: 'film' },
  { id: 'bin', label: 'Media', icon: 'folder' },
];

// the panel to show: the one remembered when it is known, else Cuts
export const phonePanel = (saved) => (PANELS.some((p) => p.id === saved) ? saved : 'cuts');

export function phoneLayout(root, app) {
  const ed = root.querySelector('.ed');
  if (!ed || root.querySelector('.ed-phone')) return;
  let cur = phonePanel((() => { try { return localStorage.getItem(KEY); } catch { return null; } })());
  const bar = h('nav.ed-phone', { 'aria-label': 'Panels' });
  const btns = PANELS.map((p) => {
    const b = h('button.calm.ed-phone-b', { type: 'button', 'data-p': p.id }, icon(p.icon, true), h('span', p.label));
    b.addEventListener('click', () => show(p.id));
    bar.append(b);
    return b;
  });
  ed.append(bar); // hidden on a desktop; on a phone it sits between the viewer and the panel
  function show(id) {
    cur = id;
    ed.dataset.phone = id;
    for (const b of btns) b.classList.toggle('on', b.dataset.p === id);
    try { localStorage.setItem(KEY, id); } catch {}
    if (id === 'tl') requestAnimationFrame(() => window.presence?.editor?.timeline?.draw?.());
  }
  show(cur);
  const paintAsk = () => btns.find((b) => b.dataset.p === 'agent')?.classList.toggle('ask', !!app.waiting?.asking);
  paintAsk();
  const offs = [
    app.on('waiting', paintAsk),
    app.on('focus-question', () => show('agent')),
  ];
  // the listeners go when the tab mounts again (a new project): the bar goes with the old DOM
  const mo = new MutationObserver(() => { if (!bar.isConnected) { offs.forEach((o) => o()); mo.disconnect(); } });
  mo.observe(root, { childList: true });
}
