// The Settings tab: the agent's settings (GET/POST /api/agent/settings), one row each with what it changes and when.
// Nothing typed is lost: the form lives as long as the tab (a tab stays mounted while hidden), and what is typed and not
// saved is also kept in this browser, so a reload brings it back. The server checks every value; its words are shown as they are.
import { h } from '../shell/dom.js';
import { ensureCss } from '../setup/first.js';
import { FIELDS, optionsFor, patchFrom, valuesOf, changedKeys } from './form.js';

const KEY = 'presence.settingsDraft';
const keep = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch {} };
const kept = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

export function mount(el, app) {
  ensureCss(new URL('./settings.css', import.meta.url));
  const status = h('p.set-status', { role: 'status', 'aria-live': 'polite' });
  const rows = h('div.set-rows');
  const save = h('button.go', { type: 'button', on: { click: () => doSave() } }, 'Save');
  const undo = h('button.calm', { type: 'button', on: { click: () => reset() } }, 'Undo my changes');
  el.append(h('div.settings',
    h('h2', 'Settings'),
    h('p.muted.set-intro', 'How the agents work. They are kept in data/settings.json, so a change here and a change in that file are the same thing.'),
    rows, h('div.set-bar', save, undo, status)));

  let meta = null, saved = null, values = null, inputs = {}, busy = false;

  function say(text, kind) { status.textContent = text; status.className = 'set-status' + (kind ? ' is-' + kind : ''); }

  function read() {
    for (const f of FIELDS) {
      const c = inputs[f.key]; if (!c) continue;
      values[f.key] = f.kind === 'toggle' ? c.checked : c.value;
    }
  }
  function touch(keepMessage) {
    read();
    const ch = changedKeys(values, saved);
    keep(ch.length ? values : null);
    save.disabled = !ch.length || busy; undo.disabled = !ch.length || busy;
    for (const f of FIELDS) inputs[f.key]?.closest('.set-row')?.classList.toggle('is-changed', ch.includes(f.key));
    if (ch.length) { if (!keepMessage || !status.textContent) say(`${ch.length === 1 ? 'One change' : ch.length + ' changes'} not saved yet.`, 'pending'); }
    else if (!keepMessage) say('');
  }

  function control(f) {
    let c;
    if (f.kind === 'select') {
      c = h('select', { id: 'set-' + f.key });
      for (const o of optionsFor(f.key, meta, values[f.key])) c.append(h('option', { value: o.value }, o.label));
      c.value = values[f.key];
    } else if (f.kind === 'toggle') {
      c = h('input', { type: 'checkbox', id: 'set-' + f.key, checked: !!values[f.key] });
    } else {
      c = h('input', { type: 'number', id: 'set-' + f.key, min: f.min, max: f.max, step: 1, inputmode: 'numeric', value: values[f.key] });
    }
    c.addEventListener('input', () => touch());
    c.addEventListener('change', () => touch());
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && f.kind === 'number') { e.preventDefault(); doSave(); } });
    inputs[f.key] = c;
    return c;
  }

  function render() {
    inputs = {};
    rows.replaceChildren(...FIELDS.map((f) => {
      const c = control(f);
      const lab = h('label.set-label.pixel', { for: 'set-' + f.key }, f.label);
      let wrap = c;
      if (f.kind === 'toggle') {
        const word = h('span', values[f.key] ? 'On' : 'Off');
        c.addEventListener('change', () => { word.textContent = c.checked ? 'On' : 'Off'; });
        wrap = h('span.set-toggle', c, word);
      } else if (f.kind === 'number') wrap = h('span.set-num', c, h('span.dim', f.unit));
      return h('div.set-row', h('div.set-head', lab, wrap), h('p.set-help', f.help));
    }));
    touch(true);
  }

  async function load() {
    try {
      const d = await app.api('/api/agent/settings');
      meta = d; saved = d.settings; values = valuesOf(saved);
      const draft = kept();
      if (draft) for (const f of FIELDS) if (draft[f.key] !== undefined) values[f.key] = draft[f.key];
      say('');
      render();
      if (changedKeys(values, saved).length) say('Your unsaved changes are back. Save them or undo them.', 'pending');
    } catch (e) { say(`The settings did not load: ${e.message}`, 'error'); save.disabled = true; undo.disabled = true; }
  }

  const when = (p) => (p.permissionMode ? 'The mode applies to the next session that starts.'
    : p.model || p.effort ? 'It applies the next time an open session is given work.' : 'It applies at once.');

  async function doSave() {
    if (busy || !saved) return;
    read();
    const patch = patchFrom(values, saved);
    if (!Object.keys(patch).length) return;
    busy = true; save.disabled = true; undo.disabled = true; say('Saving…');
    try {
      const d = await app.api('/api/agent/settings', patch);
      saved = d.settings; keep(null);
      values = valuesOf(saved);
      render();
      say(`Saved: ${Object.keys(patch).map((k) => FIELDS.find((f) => f.key === k).label).join(', ')}. ${when(patch)}`, 'ok');
    } catch (e) {
      say(`Not saved: ${e.message}`, 'error'); // what was typed stays in the form
    } finally { busy = false; touch(true); }
  }

  function reset() { values = valuesOf(saved); keep(null); render(); say(''); }

  // another window saved: take its values when nothing here is waiting to be saved
  app.on('settings', (m) => {
    if (!m.settings || busy || !saved) return;
    const waiting = changedKeys(values, saved).length;
    saved = m.settings;
    if (waiting) { touch(true); return; }
    values = valuesOf(saved); render();
  });

  say('Loading…');
  load();
  return { unmount() {} };
}
