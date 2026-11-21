// The overlay inspector: click an overlay on V2 to read and change its words, its props and its timing. Every change is saved at once
// (after you stop typing) to video/out/event-edits.json, which the engine applies over events.json on every render; it says what
// will be drawn again (only that overlay's window). Blur boxes you drew open in the viewer instead.
import { h, button } from '../shell/dom.js';
import { applyEdits, editFor, setEdit, textOf, reRenderNote, baseToWorking, workingToBase } from './edl-overlays.js';
import { ensureStyle } from './timeline-style.js';

export function createInspector(store, ui, host) {
  const S = store.S;
  ensureStyle();
  const el = h('div.tl-insp', { hidden: true });
  host.append(el);
  let id = null, timer = 0, fields = null;

  const duration = () => Number(S.edl?.total) || (S.basePs.length ? S.basePs[S.basePs.length - 1].end : 0);
  const orig = () => (S.events || []).find((e) => e.id === id);
  const shown = () => applyEdits(S.events, S.eventEdits).find((e) => e.id === id) || null;

  function open(evId, x) {
    if (id && id !== evId) flush();
    id = evId;
    const o = orig();
    if (!o) return close();
    render();
    const w = host.clientWidth;
    el.style.left = `${Math.max(8, Math.min(w - 338, (x ?? 60) - 160))}px`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('in'));
  }

  function render() {
    const o = orig(), e = shown() || o, hidden = !!S.eventEdits?.edits?.[id]?.hide;
    const num = (v) => h('input', { type: 'number', step: '0.01', min: '0', value: String(Math.round(Number(v) * 1000) / 1000) });
    const at = num(e.at), end = num(e.end);
    const text = h('textarea', { rows: 2, spellcheck: true }, textOf(e));
    const hasText = !!textOf(o) || ['text', 'card'].includes(o.kind);
    const props = {};
    const propRows = Object.entries(o.props || {}).filter(([k, v]) => k !== 'text' && (typeof v === 'string' || typeof v === 'number')).map(([k, v]) => {
      const cur = (e.props || {})[k] ?? v;
      const inp = h('input', typeof v === 'number' ? { type: 'number', step: 'any', value: String(cur) } : { type: 'text', value: String(cur) });
      props[k] = { inp, num: typeof v === 'number' };
      inp.addEventListener('input', changed);
      return h('label', h('span', k), inp, h('span'));
    });
    const hide = h('input', { type: 'checkbox', checked: hidden });
    const fromHead = (inp) => button(null, '⟵ playhead', 'Set it to where the playhead is', () => { const b = workingToBase(S.basePs, S.ps, ui.time()); if (b != null) { inp.value = String(Math.round(b * 1000) / 1000); changed(); } }, 'small calm');
    const state = h('span.state.grow', S.eventEdits?.edits?.[id] ? 'your edit is saved' : '');
    const note = h('div.note', reRenderNote(applyEdits(S.events, S.eventEdits), id, duration()));
    for (const inp of [at, end, text]) inp.addEventListener('input', changed);
    hide.addEventListener('change', changed);
    fields = { at, end, text, props, hide, state, note, hasText };
    el.replaceChildren(
      h('h3', h('span', `${o.id} · ${o.kind}${o.comp ? ' · ' + o.comp : ''}`), h('span.grow'), button(null, '✕', 'Close (your changes are saved)', () => close(), 'small calm')),
      hasText ? h('label', h('span', 'Words'), text) : null,
      ...propRows,
      h('label', h('span', 'From (s)'), at, fromHead(at)),
      h('label', h('span', 'To (s)'), end, fromHead(end)),
      h('label', h('span', 'Hide'), h('span', hide, ' leave this one out of the video'), h('span')),
      note,
      h('div.row', state,
        button(null, 'Play it', 'Play this overlay', () => { const t = baseToWorking(S.basePs, S.ps, Number(at.value)); if (t != null) ui.seek(Math.max(0, t - 0.5), { play: true }); }, 'small calm'),
        button(null, 'Undo my changes', 'Back to the overlay as the visuals stage made it', () => revert(), 'small calm')),
    );
  }

  function read() {
    const p = {};
    for (const [k, f] of Object.entries(fields.props)) p[k] = f.num ? Number(f.inp.value) : f.inp.value;
    return { at: Number(fields.at.value), end: Number(fields.end.value), text: fields.hasText ? fields.text.value : undefined, props: p, hide: fields.hide.checked };
  }
  function changed() { if (fields) fields.state.textContent = 'saving…'; clearTimeout(timer); timer = setTimeout(flush, 450); }
  function flush() {
    clearTimeout(timer); timer = 0;
    if (!id || !fields) return;
    const o = orig();
    if (!o) return;
    const f = read();
    if (!(f.end > f.at)) { fields.state.textContent = 'not saved: it must end after it starts'; return; }
    const ed = editFor(o, f);
    const before = JSON.stringify(S.eventEdits?.edits?.[id] || null);
    if (JSON.stringify(ed) === before) { fields.state.textContent = ed ? 'your edit is saved' : ''; return; }
    store.saveEdits('event-edits', setEdit(S.eventEdits, id, ed)).then((ok) => { if (fields) fields.state.textContent = !ok ? (S.editsState || 'not saved yet') : ed ? 'saved: it is drawn again when the visuals run' : 'back to the original'; });
    fields.note.textContent = reRenderNote(applyEdits(S.events, S.eventEdits), id, duration());
  }
  function revert() { clearTimeout(timer); store.saveEdits('event-edits', setEdit(S.eventEdits, id, null)); render(); }
  function close() { flush(); el.classList.remove('in'); setTimeout(() => { if (!el.classList.contains('in')) el.hidden = true; }, 300); id = null; fields = null; }

  // the edits changed under us (saved elsewhere, reloaded): show them unless you are typing here
  function refresh() { if (id && !timer && !el.contains(document.activeElement)) { if (orig()) render(); else close(); } }

  return { open, close, refresh, flush, get id() { return id; } };
}
