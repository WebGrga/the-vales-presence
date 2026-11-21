// The Context tab's side panel: one item read and edited in place. Who writes it, where it is kept, who reads it, its
// size in words; its text in an editor whose every keystroke is kept (this browser at once, the server a moment later),
// saved with a file-time check; reset to the shipped version; a skill switched on and off per stage; the lessons of the
// house rules counted. forms.js has the stage view and the new-skill form.
import { h, icon, debounce } from '../shell/dom.js';
import { KIND, stateBadge, writersWords, readersWords, words, startText, lessonCounts } from './view.js';
import { stageView, newSkillForm } from './forms.js';

import { nameForm, download } from './set-panels.js';

const LS = 'presence.context.';
const countWords = (t) => (String(t || '').match(/\S+/g) || []).length;

export function createPanel(side, app, host) {
  let cur = null; // { id, node, baseMtime, ta, dirty, note }
  const local = (key) => { try { return JSON.parse(localStorage.getItem(LS + key) || 'null'); } catch { return null; } };
  const setLocal = (key, v) => { try { if (v) localStorage.setItem(LS + key, JSON.stringify(v)); else localStorage.removeItem(LS + key); } catch {} };
  const pid = () => app.project()?.id || '';
  const keyOf = (id) => (id === 'brief' ? `brief:${pid()}` : id);
  const pq = () => { const p = new URLSearchParams(host.query()); return p; };
  const post = (path, body) => {
    const p = pq();
    return app.api(path, { project: p.get('project') || undefined, recipe: p.get('recipe') || undefined, ...body });
  };

  const toServer = debounce((id, text, baseMtime) => {
    post('/api/context/draft', { id, text, baseMtime }).catch(() => {});
  }, 500);

  function empty() {
    cur = null;
    host.opened(null);
    side.replaceChildren(h('div.cx-empty',
      h('h3', 'What the agent reads'),
      h('p', 'Each column is a stage of the recipe. It reads the skills switched on for it, plus the shared things below: the standing instructions (CLAUDE.md), your house rules and the brief. A line joins every stage to what it reads.'),
      h('p', 'Click anything to read it, change it in place, or switch a skill on or off for a stage. Your changes are kept in your data folder; the shipped versions stay as they are, and “Reset to default” brings them back.'),
      h('p.dim', 'Sizes are in words.')));
  }

  // ---------------------------------------------------------------- one item
  async function open(id) {
    if (cur?.dirty) toServer.flush();
    let r;
    try { r = await app.api(`/api/context/node?id=${encodeURIComponent(id)}&${host.query()}`); } catch (e) { app.toast(e.message, 'error'); return; }
    show(r.node, r.draft);
  }

  function show(n, serverDraft) {
    const m = host.map(), columns = m?.columns || [];
    const s = startText(n, serverDraft, local(keyOf(n.id)));
    const [badge, bcls] = stateBadge(n);
    const info = m?.nodes?.[n.id] || n;
    const ta = h('textarea.cx-text', { spellcheck: 'false', readOnly: !n.editable, rows: 18 });
    ta.value = s.text;
    const count = h('span.cx-words', words(countWords(s.text)));
    const saveBtn = h('button.small.go', { type: 'button', on: { click: () => save(false) } }, icon('keep', true), h('span', 'Save'));
    const undoBtn = h('button.small.calm', { type: 'button', title: 'Throw away what you typed and read the file again', on: { click: discard } }, icon('undo', true), h('span', 'Discard'));
    const note = h('div.cx-note', { hidden: true });
    cur = { id: n.id, node: n, baseMtime: s.stale ? -1 : n.mtime, ta, dirty: s.restored, note, saveBtn, undoBtn };
    if (s.restored) say(s.stale ? 'Your unsaved changes are back. The file changed since you typed them: read it through before you save.' : 'Your unsaved changes are back.', 'warn');
    const sync = () => { saveBtn.disabled = undoBtn.disabled = !cur.dirty; count.textContent = words(countWords(ta.value)); side.classList.toggle('dirty', cur.dirty); };
    ta.addEventListener('input', () => {
      cur.dirty = ta.value !== n.text;
      setLocal(keyOf(n.id), cur.dirty ? { text: ta.value, at: Date.now(), baseMtime: n.mtime } : null);
      toServer(n.id, cur.dirty ? ta.value : null, n.mtime);
      sync();
    });
    ta.addEventListener('blur', () => toServer.flush());
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (cur.dirty) save(false); } });

    const rows = [
      ['Size', words(n.words)],
      ['Written by', writersWords(info)],
      ['Kept in', h('code', n.kept)],
      ['Read by', readersWords(info, columns)],
    ];
    const acts = [];
    if (n.canReset) acts.push(twoStep('Reset to default', 'Click again: your version goes (a backup is kept)', () => reset(n)));
    if (n.kind === 'skill') {
      acts.push(h('button.small.calm', { type: 'button', title: 'Copy this skill under a new name; the original stays', on: { click: () => duplicate(n) } }, icon('plus', true), h('span', 'Duplicate')));
      acts.push(h('button.small.calm', { type: 'button', title: 'Save this skill as one file to share', on: { click: () => exportSkill(n) } }, icon('export', true), h('span', 'Export')));
    }
    if (n.canRemove) acts.push(twoStep('Remove this skill', 'Click again to remove it (a backup is kept)', () => reset(n)));

    side.replaceChildren(h('div.cx-panel',
      h('header.cx-p-head', icon(KIND[n.kind]?.icon || 'note'), h('div', h('h3', n.label), h('span.cx-badge.' + bcls, badge)),
        h('button.icon-only.cx-close', { type: 'button', title: 'Close', on: { click: empty } }, icon('cross', true))),
      n.description ? h('p.cx-desc', n.description) : null,
      h('dl.cx-rows', ...rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
      n.kind === 'skill' ? skillSwitches(n, columns) : null,
      n.kind === 'rules' ? lessonList(m?.lessons || []) : null,
      n.why ? h('p.cx-why.dim', n.why) : null,
      n.kind === 'brief' && !n.editable ? null : h('div.cx-edit',
        ta,
        n.editable ? h('div.cx-edit-bar', saveBtn, undoBtn, h('div.grow'), count) : h('div.cx-edit-bar', h('div.grow'), count),
        note),
      acts.length ? h('div.cx-acts', ...acts) : null));
    sync();
    host.opened(n.id);
  }

  function say(text, kind = 'info', ...kids) {
    if (!cur) return;
    cur.note.hidden = !text;
    cur.note.className = 'cx-note ' + kind;
    cur.note.replaceChildren(h('span', text), ...kids);
  }

  async function save(force) {
    const c = cur;
    if (!c) return;
    c.saveBtn.disabled = true;
    let r;
    try { r = await post('/api/context/save', { id: c.id, text: c.ta.value, baseMtime: c.baseMtime, force }); } catch (e) { c.saveBtn.disabled = false; say('Not saved: ' + e.message, 'error'); return; }
    if (r.conflict) {
      c.saveBtn.disabled = false;
      say('The file changed since you opened it (the agent may have written to it). Your text is still here.', 'warn',
        h('button.small.warn', { type: 'button', on: { click: () => save(true) } }, 'Save mine over it'),
        h('button.small.calm', { type: 'button', on: { click: () => theirs(r) } }, 'Read the file instead'));
      return;
    }
    setLocal(keyOf(c.id), null);
    app.toast(`${c.node.label} saved.`, 'ok');
    show(r.node, null);
  }
  function theirs() { setLocal(keyOf(cur.id), null); post('/api/context/draft', { id: cur.id, text: null }).catch(() => {}); open(cur.id); }
  async function discard() {
    if (!cur) return;
    setLocal(keyOf(cur.id), null);
    toServer(cur.id, null, null); toServer.flush();
    open(cur.id);
  }
  async function reset(n) {
    try { await post('/api/context/reset', { id: n.id }); } catch (e) { app.toast(e.message, 'error'); return; }
    setLocal(keyOf(n.id), null);
    app.toast(n.canRemove ? `${n.label} removed.` : `${n.label} is the shipped version again.`, 'ok');
    if (n.canRemove) empty(); else open(n.id);
  }

  // a button that asks once more before it acts
  function twoStep(label, again, fn) {
    const b = h('button.small.warn', { type: 'button' }, icon('restore', true), h('span', label));
    let armed = null;
    b.addEventListener('click', () => {
      if (armed) { clearTimeout(armed); armed = null; fn(); return; }
      b.lastChild.textContent = again;
      armed = setTimeout(() => { armed = null; b.lastChild.textContent = label; }, 4000);
    });
    return b;
  }

  // ---------------------------------------------------------------- skills per stage, lessons
  function skillSwitches(n, columns) {
    const agentCols = columns.filter((c) => c.agent);
    if (!agentCols.length) return null;
    return h('div.cx-switches', h('div.cx-label', 'Switched on for'),
      ...agentCols.map((c) => {
        const on = c.skills.some((s) => s.id === n.id);
        const box = h('input', { type: 'checkbox', checked: on, on: { change: () => toggle(c.id, n.name || n.label, box.checked) } });
        return h('label.cx-switch', box, h('span', c.title), h('span.dim', c.kind));
      }));
  }

  function lessonList(list) {
    if (!list.length) return h('p.cx-why.dim', 'No lessons yet. They are written by the agent, in the same turn you correct it.');
    return h('div.cx-switches', h('div.cx-label', 'Lessons'),
      h('ol.cx-lesson-list.in-panel', ...list.map((l) => h('li' + (l.review ? '.review' : ''),
        h('span', l.text),
        h('span.cx-counts', h('b.kept', `kept ${l.kept}`), ' · ', h('b.against', `against ${l.against}`)),
        l.date || l.evidence ? h('span.dim', [l.date, l.evidence].filter(Boolean).join(': ')) : null,
        h('span.cx-lesson-acts',
          h('button.small.calm', { type: 'button', title: 'It held up: count one more kept', on: { click: () => count(l, 'kept') } }, '+ held up'),
          h('button.small.calm', { type: 'button', title: 'It was wrong here: count one more against', on: { click: () => count(l, 'against') } }, '+ went wrong'),
          l.review ? h('span.cx-review', { title: lessonCounts(l) }, 'up for review') : null)))));
  }
  async function count(l, field) {
    if (cur?.dirty) { app.toast('Save or discard your changes to the house rules first.', 'warn'); return; }
    try { await post('/api/context/lesson', { lesson: l.id, field }); } catch (e) { app.toast(e.message, 'error'); }
  }

  function duplicate(n) {
    if (cur?.dirty) { app.toast('Save or discard your changes first, so the copy has your text.', 'warn'); return; }
    nameForm(ctx, { title: 'Duplicate skill', label: 'Name of the copy', value: (n.name || n.label) + '-copy', verb: 'Make the copy', intro: `A new skill of your own, copied from ${n.label}. ${n.label} stays as it is.`,
      go: async (name) => { const r = await post('/api/context/skill-duplicate', { skill: n.name || n.label, name }); app.toast('Copy made.', 'ok'); open(r.id); } });
  }
  async function exportSkill(n) {
    try { const r = await app.api(`/api/context/export?kind=skill&id=${encodeURIComponent(n.name || n.label)}&${host.query()}`); download(`${r.name}.presence-skill.json`, r.bundle); app.toast('Skill exported.', 'ok'); } catch (e) { app.toast(e.message, 'error'); }
  }

  async function toggle(stage, skill, on) {
    let r;
    try { r = await post('/api/context/toggle', { stage, skill, on }); } catch (e) { app.toast(e.message, 'error'); host.reload(); return; }
    app.toast(`${skill} ${on ? 'on' : 'off'} for ${host.map()?.columns.find((c) => c.id === stage)?.title || stage}.${r?.forked ? ` The shipped set is never changed, so this went into a new set, ${r.forked.name}.` : ''}`, 'ok');
  }

  // ---------------------------------------------------------------- the map changed
  async function refresh() {
    if (!cur) return;
    if (cur.form) return; // a form keeps what is typed
    if (cur.stage) return stage(cur.stage);
    if (cur.dirty) return; // typed text is never replaced; a save checks the file time
    let r;
    try { r = await app.api(`/api/context/node?id=${encodeURIComponent(cur.id)}&${host.query()}`); } catch { return empty(); }
    if (!cur || cur.dirty || cur.form) return;
    show(r.node, r.draft);
  }

  const ctx = { app, host, side, post, toggle, open, empty, local, setLocal, set: (c) => { cur = c; } };
  async function stage(id) { if (cur?.dirty) toServer.flush(); await stageView(ctx, id); }
  async function newSkill(stageId) { if (cur?.dirty) toServer.flush(); await newSkillForm(ctx, stageId); }

  empty();
  return { ctx, open, stage, newSkill, toggle, refresh, close() { toServer.flush(); } };
}
