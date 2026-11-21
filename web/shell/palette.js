// The command palette (Ctrl+K): one box that finds actions, tabs, projects and skills. Up and Down choose, Enter runs,
// Esc closes. The list is built when it opens (projects and skills are read then); the search is palette-search.js.
import { h } from './dom.js';
import { search } from './palette-search.js';
import { TABS } from './tabs.js';

export function mountPalette(app) {
  let layer = null;

  function actions() {
    const p = app.project();
    const a = p?.view?.actions || [];
    const list = [];
    const act = (id, label, run, words = '') => list.push({ id, group: 'Actions', label, words, run });
    act('projects', 'Open the Projects page', () => app.home.open(), 'switch new create');
    act('live', 'Open the live log', () => app.drawer.open('live'), 'activity agent doing');
    act('history', 'Open the history of stages and turns', () => app.drawer.open('history'), 'log failed errors past');
    act('queue', 'Open the queue across projects', () => app.drawer.open('queue'), 'waiting line');
    act('spend', 'Open spend per day and month', () => app.drawer.open('spend'), 'cost money budget warn');
    act('undo', 'Undo the last Studio or Context change', () => app.undo?.undoTab(), 'ctrl z back');
    act('keys', 'Show the keyboard keys', () => import('./keys-help.js').then((m) => m.toggleKeys()), 'help shortcuts ?');
    act('tour', 'Replay the tour of the screen', () => app.tour?.start(), 'help welcome intro');
    act('report', 'Open Setup to copy a report', () => app.openTab('setup'), 'doctor versions help');
    // the ones that start work come last: Ctrl+K then Enter never runs the agent (type "go" to find them)
    if (a.includes('go')) act('go', 'Go: run the current stage', () => app.keys?.go(), 'start run agent');
    if (a.includes('approve')) act('approve', 'Approve the current stage', () => app.keys?.go(), 'accept lock');
    if (a.includes('stop')) act('stop', 'Stop the agent', () => app.api(`/api/projects/${encodeURIComponent(p.id)}/stop`, {}).catch((e) => app.toast(e.message, 'error')), 'halt cancel');
    if (a.includes('stop')) act('after', 'Stop after this stage', () => app.api(`/api/projects/${encodeURIComponent(p.id)}/stop-after`, { on: true }).then(() => app.toast('It will stop after this stage.', 'ok')).catch((e) => app.toast(e.message, 'error')), 'pause');
    return list;
  }
  function tabItems() {
    return TABS.map((t, i) => ({ id: 'tab-' + t.id, group: 'Tabs', label: `Go to ${t.label}`, hint: String(i + 1), words: '', run: () => app.openTab(t.id) }));
  }
  async function projectItems() {
    try {
      const d = await app.api('/api/projects');
      return (d.projects || []).map((p) => ({ id: 'p-' + p.id, group: 'Projects', label: `Open: ${p.title || p.id}`, hint: p.id === app.project()?.id ? 'open now' : '', words: p.id, run: () => app.select(p.id) }));
    } catch { return []; }
  }
  async function skillItems() {
    try {
      const m = await app.api('/api/context' + (app.project() ? `?project=${encodeURIComponent(app.project().id)}` : ''));
      return Object.values(m.nodes || {}).filter((n) => n.kind === 'skill').map((n) => ({ id: n.id, group: 'Skills', label: `Skill: ${n.label}`, words: n.description || '', run: () => { const msg = { type: 'open-context', id: n.id }; app.hooks.contextOpen = msg; app.openTab('context'); app.emit('open-context', msg); } }));
    } catch { return []; }
  }

  async function open() {
    if (layer) { close(); return; }
    const input = h('input', { type: 'text', placeholder: 'Type to find an action, a project, a tab or a skill…', 'aria-label': 'Command palette', autocomplete: 'off', spellcheck: false });
    const list = h('div.pal-list', { role: 'listbox' });
    const box = h('div.pal-box.px-frame', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, input, list, h('div.pal-foot.dim', '↑↓ choose · Enter run · Esc close'));
    layer = h('div.pal-layer', box);
    layer.addEventListener('pointerdown', (e) => { if (e.target === layer) close(); });
    document.body.append(layer);
    requestAnimationFrame(() => layer?.classList.add('in'));
    input.focus();
    let items = [...actions(), ...tabItems()], shown = [], at = 0;
    const draw = () => {
      shown = search(items, input.value);
      at = Math.min(at, Math.max(0, shown.length - 1));
      let last = '';
      list.replaceChildren(...(shown.length ? shown.flatMap((it, i) => {
        const row = h('div.pal-row' + (i === at ? '.on' : ''), { role: 'option', 'aria-selected': i === at ? 'true' : 'false', on: { click: () => run(it), pointermove: () => { if (at !== i) { at = i; mark(); } } } }, h('span', it.label), it.hint ? h('span.dim.pal-hint', it.hint) : null);
        const head = it.group !== last ? h('div.pal-group', it.group) : null; last = it.group;
        return head ? [head, row] : [row];
      }) : [h('p.dim.pal-none', 'Nothing matches. Try another word.')]));
    };
    const mark = () => { [...list.querySelectorAll('.pal-row')].forEach((r, i) => { r.classList.toggle('on', i === at); r.setAttribute('aria-selected', i === at ? 'true' : 'false'); }); list.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' }); };
    async function run(it) { close(); try { await it.run(); } catch (e) { app.toast(e.message || String(e), 'error'); } }
    input.addEventListener('input', () => { at = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[at]) run(shown[at]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    draw();
    const [ps, ss] = await Promise.all([projectItems(), skillItems()]);
    if (!layer) return;
    items = [...items, ...ps, ...ss]; draw();
  }
  function close() { if (!layer) return; const l = layer; layer = null; l.classList.remove('in'); setTimeout(() => l.remove(), 250); }
  return { open, close, isOpen: () => !!layer };
}
