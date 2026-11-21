// Undo for Studio picks, notes and upload fields, and for Context skill edits. The server keeps the old files
// (server/undo.js) and says so in an x-undo header on the answer; this shows a small "Undo" after each change and puts
// Ctrl+Z to work when focus is not in a text box. (The Edit tab has its own Ctrl+Z for the cuts and keeps it.)
import { h } from './dom.js';
import { watch } from './fetch-watch.js';

// pure: which undo stack a Ctrl+Z means. entries: [{ scope, label, at }] (the ones seen this session), tab: the shown tab
export function pickScope(entries, tab, projectId) {
  if (tab === 'context') return 'context';
  if (tab === 'studio') return projectId || null;
  const mine = (entries || []).filter((e) => e.scope === 'context' || e.scope === projectId).sort((a, b) => b.at - a.at);
  return mine[0]?.scope || null;
}

// pure: the header's words -> { scope, label, at } | null
export function parseHeader(v) {
  if (!v) return null;
  try { const o = JSON.parse(decodeURIComponent(v)); return o && o.scope && o.label ? { scope: String(o.scope), label: String(o.label), at: Number(o.at) || Date.now() } : null; } catch { return null; }
}

export function mountUndo(app) {
  const entries = [];
  const label = h('span.undo-t');
  const btn = h('button.small.go', { type: 'button', title: 'Put it back as it was (Ctrl+Z)' }, 'Undo');
  const bar = h('div.undo-bar', { role: 'status', 'aria-live': 'polite' }, label, btn);
  document.body.append(bar);
  let timer = null;
  const hide = () => { bar.classList.remove('in'); clearTimeout(timer); };
  const show = (e) => {
    label.textContent = `${e.label}.`;
    btn.onclick = () => run(e.scope);
    bar.classList.add('in');
    clearTimeout(timer); timer = setTimeout(hide, 9000);
  };
  bar.addEventListener('pointerenter', () => clearTimeout(timer));
  bar.addEventListener('pointerleave', () => { clearTimeout(timer); timer = setTimeout(hide, 3000); });

  async function run(scope) {
    hide();
    if (!scope) { app.toast('Nothing to undo here.', 'info'); return false; }
    try {
      const r = await app.api('/api/undo', { scope });
      const i = entries.map((e) => e.scope).lastIndexOf(scope); if (i >= 0) entries.splice(i, 1);
      app.toast(`Undone: ${r.label}.`, 'ok');
      return true;
    } catch (e) { app.toast(e.status === 409 ? 'Nothing to undo here.' : 'Undo did not work: ' + e.message, e.status === 409 ? 'info' : 'error'); return false; }
  }

  watch((r) => {
    if (r.phase !== 'end' || !r.ok) return;
    const e = parseHeader(r.headers?.get?.('x-undo'));
    if (!e) return;
    entries.push(e);
    if (entries.length > 60) entries.shift();
    show(e);
  });

  return { run, undoTab: () => run(pickScope(entries, app.shownTab?.(), app.project()?.id)) };
}
