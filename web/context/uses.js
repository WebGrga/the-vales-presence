// "Uses: <skills>" for the Studio and Shorts pages: the skills the project's set switches on for the stages shown, each a
// link to the Context tab focused on that skill. stageIds = the stages the page covers; 'studio' = the Studio's own turns.
import { h } from '../shell/dom.js';

export function usesLine(app, stageIds = []) {
  if (!document.querySelector('link[data-cx]')) document.head.append(h('link', { rel: 'stylesheet', href: '/context/context.css', 'data-cx': '' }));
  const el = h('p.cx-uses.muted', { hidden: true });
  async function load() {
    const p = app.project?.();
    if (!p?.id) { el.hidden = true; return; }
    let r;
    try { r = await app.api(`/api/context/uses?project=${encodeURIComponent(p.id)}`); } catch { el.hidden = true; return; }
    const names = [...new Set([...stageIds.flatMap((s) => r.stages[s] || []), ...(stageIds.includes('studio') ? r.studio : [])])];
    el.hidden = !names.length;
    const open = (n) => (e) => { e.preventDefault(); const m = { type: 'open-context', id: 'skill:' + n }; app.hooks.contextOpen = m; app.emit('open-context', m); };
    el.replaceChildren('Uses: ', ...names.flatMap((n, i) => [i ? ', ' : '', h('a', { href: '#', title: `Open ${n} in the Context tab`, on: { click: open(n) } }, n)]), h('span.dim', ` (skill set: ${r.set.name})`));
  }
  load();
  return { el, load };
}
