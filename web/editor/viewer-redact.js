// Blur boxes on the viewer: press "Blur box" (or pick one on V2), draw a box over what must not be seen; it runs from In to Out when
// both are marked, else three seconds from the playhead. A box shows blurred live (the browser's own blur) while it is on; drag it to
// move, its corners to resize; with a box picked, I and O set its start and end, Delete removes it. Every change is saved at once to
// video/out/redactions.json, which the engine draws in the compose pass (engine/redact.py). Geometry in viewer-boxes.js.
import { h, button } from '../shell/dom.js';
import { fitRect, toFrame, toScreen, boxFrom, hit, drag, activeAt, nextId, timesFor, setTime, put, MODES } from './viewer-boxes.js';
import { workingToBase, baseToWorking } from './edl-overlays.js';
import { ensureStyle } from './timeline-style.js';

export function createRedactor(store, ui, screen) {
  const S = store.S;
  ensureStyle();
  const layer = h('div.v-boxes');
  const panel = h('div.v-boxpanel', { hidden: true });
  screen.append(layer, panel);
  let drawing = false, picked = null, draft = null, t = 0, mode = 'after';
  const toolBtn = button(null, 'Blur box', 'Draw a box to blur on the picture (then In and Out set when it runs)', () => setDrawing(!drawing), 'small calm blurtool');

  const W = () => Number(S.edl?.width) || 1920, H = () => Number(S.edl?.height) || 1080;
  const duration = () => Number(S.edl?.total) || (S.basePs.length ? S.basePs[S.basePs.length - 1].end : 0);
  const boxes = () => (Array.isArray(S.redactions?.boxes) ? S.redactions.boxes : []);
  const fit = () => { const r = screen.getBoundingClientRect(); return fitRect(r.width, r.height, W(), H()); };
  const baseT = () => workingToBase(S.basePs, S.ps, t) ?? t;
  const visible = () => mode === 'after' || mode === 'final';

  function save(list, why) { store.saveEdits('redactions', { version: 1, boxes: list }); if (why) ui.toast?.(why); }

  function setDrawing(on) {
    drawing = !!on && visible();
    layer.classList.toggle('drawing', drawing);
    toolBtn.classList.toggle('on', drawing);
    if (drawing) ui.toast?.('Drag a box over what must not be seen. Mark In and Out first to set when it runs (else 3 s from here). Esc cancels.');
    paint();
  }

  // ------------------------------------------------------------------ drawing the boxes on screen
  let lastKey = '';
  function paint(force) {
    if (!visible()) { if (lastKey) { layer.replaceChildren(); panel.hidden = true; lastKey = ''; } return; }
    const f = fit(), now = baseT();
    const on = new Set(activeAt(boxes(), now).map((b) => b.id));
    const key = JSON.stringify([[...on], picked, draft, f, S.redactions, S.editsState]);
    if (key === lastKey && !force) return; // playing: nothing to redraw until a box comes or goes
    lastKey = key;
    const show = boxes().filter((b) => on.has(b.id) || b.id === picked);
    const els = show.map((b) => {
      const s = toScreen(b, f);
      const el = h(`div.v-box.${b.mode || 'blur'}`, { 'data-id': b.id, style: `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px` },
        h('span.lbl', `${b.id} · ${b.mode || 'blur'} · ${b.at.toFixed(1)}–${b.end.toFixed(1)} s`));
      if (!on.has(b.id)) el.classList.add('off');
      if (b.id === picked) { el.classList.add('sel'); for (const c of ['nw', 'ne', 'sw', 'se']) el.append(h(`span.hd.${c}`)); }
      el.addEventListener('pointerdown', (e) => grab(e, b.id));
      return el;
    });
    if (draft) { const s = toScreen(draft, f); els.push(h('div.v-draft', { style: `left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px` })); }
    layer.replaceChildren(...els);
    paintPanel();
  }

  function paintPanel() {
    const b = boxes().find((x) => x.id === picked);
    if (!b) { panel.hidden = true; return; }
    const sel = h('select', { title: 'How it hides' }, ...MODES.map((m) => h('option', { value: m, selected: m === (b.mode || 'blur') }, { blur: 'Blur', pixelate: 'Pixelate', fill: 'Black box' }[m])));
    sel.addEventListener('change', () => save(put(boxes(), b.id, { ...b, mode: sel.value })));
    const at = (which) => button(null, which === 'in' ? 'In = playhead (I)' : 'Out = playhead (O)', `The box ${which === 'in' ? 'starts' : 'ends'} where the playhead is`, () => mark(which), 'small calm');
    panel.replaceChildren(
      h('b', b.id), h('span', `${b.at.toFixed(2)}–${b.end.toFixed(2)} s`), sel, at('in'), at('out'),
      button(null, 'Go to it', 'Put the playhead at its start', () => { const w = baseToWorking(S.basePs, S.ps, b.at); if (w != null) ui.seek(w); }, 'small calm'),
      button(null, 'Delete', 'Remove this box (Delete)', () => remove(), 'small warn'),
      h('span.state', S.editsState && S.editsState !== 'saved' ? S.editsState : 'saved'),
      button(null, '✕', 'Done with this box', () => pick(null), 'small calm'));
    panel.hidden = false;
  }

  // ------------------------------------------------------------------ pointer
  function pointIn(e) { const r = screen.getBoundingClientRect(); return toFrame(e.clientX - r.left, e.clientY - r.top, fit()); }

  layer.addEventListener('pointerdown', (e) => {
    if (!drawing || e.target !== layer) return;
    e.preventDefault(); e.stopPropagation();
    const a = pointIn(e);
    layer.setPointerCapture(e.pointerId);
    const move = (ev) => { draft = boxFrom(a, pointIn(ev), W(), H()) || null; paint(); };
    const up = (ev) => {
      layer.removeEventListener('pointermove', move); layer.removeEventListener('pointerup', up);
      const box = boxFrom(a, pointIn(ev), W(), H());
      draft = null;
      setDrawing(false);
      if (!box) { paint(); return; }
      const m = ui.marks, base = (x) => (x == null ? null : workingToBase(S.basePs, S.ps, x));
      const times = timesFor(baseT(), { in: base(m.in), out: base(m.out) }, duration());
      const nb = { id: nextId(boxes()), ...times, ...box, mode: 'blur' };
      picked = nb.id;
      save(put(boxes(), null, nb), `Blur box ${nb.id} from ${times.at.toFixed(1)} to ${times.end.toFixed(1)} s, saved. I and O move its ends while it is picked.`);
      ui.boxesChanged?.();
    };
    layer.addEventListener('pointermove', move); layer.addEventListener('pointerup', up);
  });

  function grab(e, id) {
    if (drawing) return;
    e.preventDefault(); e.stopPropagation();
    const f = fit(), r = screen.getBoundingClientRect();
    const h0 = hit(boxes().filter((b) => b.id === id), e.clientX - r.left, e.clientY - r.top, f) || { id, part: 'move' };
    picked = id; ui.boxesChanged?.();
    const b0 = boxes().find((b) => b.id === id);
    const p0 = pointIn(e);
    let moved = null;
    const move = (ev) => { const p = pointIn(ev); moved = drag(b0, h0.part, p.x - p0.x, p.y - p0.y, W(), H()); store.S.redactions = { version: 1, boxes: put(boxes(), id, moved) }; paint(); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (moved) save(put(boxes(), id, moved)); else paint(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    paint();
  }

  // ------------------------------------------------------------------ actions
  function pick(id) { picked = id && boxes().some((b) => b.id === id) ? id : null; paint(); ui.boxesChanged?.(); }
  // I / O with a box picked: its start or end (true when it took the key)
  function mark(which) {
    const b = boxes().find((x) => x.id === picked);
    if (!b) return false;
    const nb = setTime(b, which, baseT(), duration());
    save(put(boxes(), b.id, nb), `${b.id} ${which === 'in' ? 'starts' : 'ends'} at ${(which === 'in' ? nb.at : nb.end).toFixed(2)} s.`);
    return true;
  }
  function remove() {
    const b = boxes().find((x) => x.id === picked);
    if (!b) return false;
    picked = null;
    save(put(boxes(), b.id, null), `Blur box ${b.id} removed.`);
    ui.boxesChanged?.();
    return true;
  }
  function cancel() { if (!drawing && !draft) { if (picked) { pick(null); return true; } return false; } draft = null; setDrawing(false); return true; }

  new ResizeObserver(() => paint()).observe(screen);

  return {
    toolBtn, paint, pick, mark, remove, cancel,
    get picked() { return picked; },
    onTime(x, m) { t = x; if (m !== mode) { mode = m; if (!visible()) setDrawing(false); } paint(); },
  };
}
