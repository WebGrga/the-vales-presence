// The "Saved / Saving… / Not saved" chip in the top bar. One answer for the whole app: the editor reports its own state
// (app.save.report), and every save the Studio, the Context tab and the drafts make is seen as a request (fetch-watch.js).
// The pure parts (what counts as a save, how states add up) are tested in save-state.test.js.
import { h } from './dom.js';
import { watch } from './fetch-watch.js';

// which source a request belongs to, or null when it is not a save (agent commands, uploads and the like are not)
export function sourceOf(method, url) {
  if (String(method).toUpperCase() !== 'POST') return null;
  if (/^\/api\/projects\/[^/]+\/drafts$/i.test(url)) return 'drafts';
  if (/^\/api\/studio\/[^/]+\/(text|options|feed|upload-fields|marks|bet)$/i.test(url)) return 'Studio';
  if (/^\/api\/context\/(save|reset|skill|toggle|stage-reset|lesson|draft|set-[a-z]+|skill-duplicate|import)$/.test(url)) return 'Context';
  return null;
}

// the editor's own words (store.js saveState / editsState) -> 'saving' | 'saved' | 'failed' | null
export function editorState(...texts) {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (!t) return null;
  if (/not saved|trying again|kept in this browser only/.test(t)) return 'failed';
  if (/saving/.test(t)) return 'saving';
  if (/saved/.test(t)) return 'saved';
  return null;
}

// sources: Map(name -> { state, msg }) -> { state: 'saved'|'saving'|'failed', failed: [{ name, msg }] }
export function summary(sources) {
  const failed = [], saving = [];
  for (const [name, s] of sources) { if (s.state === 'failed') failed.push({ name, msg: s.msg || '' }); else if (s.state === 'saving') saving.push(name); }
  return { state: failed.length ? 'failed' : saving.length ? 'saving' : 'saved', failed, saving };
}

const WORDS = { saved: 'Saved', saving: 'Saving…', failed: 'Not saved' };

export function createSaveState(onChange) {
  const sources = new Map(); // name -> { state, msg, n, retry, at }
  const fire = () => onChange?.(summary(sources));
  const api = {
    // the editor (or any part) says how it stands
    report(name, state, msg, retry) {
      if (!state) return;
      const s = sources.get(name) || {};
      sources.set(name, { ...s, state, msg: msg || '', retry: retry || s.retry, n: 0, at: state === 'saved' ? Date.now() : s.at });
      fire();
    },
    start(name) { const s = sources.get(name) || { state: 'saved' }; sources.set(name, { ...s, n: (s.n || 0) + 1, state: s.state === 'failed' ? 'failed' : 'saving' }); fire(); },
    end(name, ok, msg, retry) {
      const s = sources.get(name) || {};
      const n = Math.max(0, (s.n || 1) - 1);
      if (!ok) sources.set(name, { ...s, n, state: 'failed', msg: msg || 'the server did not take it', retry });
      else sources.set(name, { ...s, n, state: n ? 'saving' : 'saved', msg: '', at: Date.now(), retry: n ? s.retry : undefined });
      fire();
    },
    failed: () => [...sources.entries()].filter(([, s]) => s.state === 'failed'),
    last: () => Math.max(0, ...[...sources.values()].map((s) => s.at || 0)),
  };
  return api;
}

// mounts the chip in `el` and wires the request watcher; -> the save api for app.save
export function mountSaveChip(el, app) {
  const dot = h('span.save-dot');
  const text = h('span.save-t', 'Saved');
  const chip = h('button.save-chip.calm.saved', { type: 'button', title: 'Everything you changed is saved', 'aria-live': 'polite' }, dot, text);
  el.append(chip);
  const st = createSaveState((s) => {
    chip.className = `save-chip calm ${s.state}`;
    text.textContent = WORDS[s.state];
    const when = st.last() ? new Date(st.last()).toLocaleTimeString() : '';
    chip.title = s.state === 'failed' ? `Not saved: ${s.failed.map((f) => `${f.name}${f.msg ? ` (${f.msg})` : ''}`).join('; ')}. Click to try again.`
      : s.state === 'saving' ? 'Saving…' : `Everything you changed is saved${when ? ` (last at ${when})` : ''}`;
  });
  chip.addEventListener('click', async () => {
    const bad = st.failed();
    if (!bad.length) { app.toast(chip.title, 'info'); return; }
    app.toast('Trying to save again…', 'info');
    for (const [name, s] of bad) { try { await s.retry?.(); } catch { st.report(name, 'failed', 'still not saved'); } }
  });
  watch((r) => {
    const name = sourceOf(r.method, r.url);
    if (!name) return;
    if (r.phase === 'start') return void st.start(name);
    const gone = name === 'drafts' && r.status === 404; // a server without drafts keeps them in the browser
    const retry = () => fetch(r.input, r.init);
    st.end(name, r.ok || gone, r.error ? 'no answer from the server' : r.status === 413 ? 'too large' : `server said ${r.status}`, retry);
  });
  addEventListener('beforeunload', (e) => { if (st.failed().length) { e.preventDefault(); e.returnValue = ''; } });
  return st;
}
