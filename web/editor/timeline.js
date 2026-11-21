// The timeline: a ruler with review markers, and four tracks, V2 overlays and blur boxes, captions, V1 clips with the cut marks
// (flagged ones amber, yours red, restored ones green) and A1 with the waveform; the playhead, In/Out, zoom around the pointer,
// snapping to edges. Joins are trimmed on V1 (timeline-edit.js), a click on V2 opens the overlay inspector (timeline-inspector.js),
// markers are timeline-ruler.js. Drawn on one canvas at the screen's own resolution (waveforms stay smooth). Maths in zoom.js and edl-map.js.
import { h, button } from '../shell/dom.js';
import { timeToX, xToTime, fitView, clampView, zoomAround, follow, snapTime, ticks, tickStep, tickLabel, fmtTime } from './zoom.js';
import { toSource, toEdit } from './edl-map.js';
import { applyEdits, boxEvents } from './edl-overlays.js';
import { createTrimmer } from './timeline-edit.js';
import { createRuler } from './timeline-ruler.js';
import { createInspector } from './timeline-inspector.js';

const TRACKS = [
  { id: 'ruler', h: 24 },
  { id: 'v2', h: 30, label: 'V2', icon: 'layers', title: 'Overlays' },
  { id: 'cap', h: 24, label: 'CC', icon: 'text', title: 'Captions' },
  { id: 'v1', h: 54, label: 'V1', icon: 'film', title: 'Clips and cuts' },
  { id: 'a1', h: 64, label: 'A1', icon: 'wave', title: 'Sound' },
];
const C = {
  bg: '#222034', bg2: '#1b1b2a', line: '#33304a', text: '#e8d6b3', dim: '#7d7d8c',
  clip: '#2b3f7a', clipTop: '#6fa3e0', wait: '#7a5134', hold: '#4c4c5a', card: '#111',
  mark: '#f5efe0', flag: '#d98a2b', you: '#e07a5a', restored: '#86c05a', sel: '#e8c547',
  wave: '#86c05a', waveDim: '#2f5a2e', overlay: '#6b3f8c', overlayTop: '#9b6fc0', zoom: '#1f5f5a', cap: '#1f5f5a', capTop: '#5fb3a8', blur: '#8c2f2f', blurTop: '#e07a5a',
  io: 'rgba(232,197,71,0.13)', head: '#e8c547', tan: '#d9a877',
};

export function createTimeline(store, ui) {
  const S = store.S;
  const canvas = h('canvas.tl-canvas.smooth');
  const heads = h('div.tl-heads', ...TRACKS.map((t) => t.id === 'ruler'
    ? h('div.tl-head.ruler', { style: `height:${t.h}px` })
    : h('div.tl-head', { style: `height:${t.h}px`, title: t.title }, h('img.icon.sm', { src: `/icons/${t.icon}.png`, alt: '' }), h('span.pixel', t.label))));
  const zoomSlider = h('input', { type: 'range', min: 0, max: 1000, value: 0, title: 'Zoom (= and -, Ctrl + wheel)' });
  const snapBtn = button('snap', '', 'Snap to edges and cuts (S)', () => ui.act('toggleSnap'));
  const ioEl = h('span.tl-io.pixel');
  const changeEl = h('span.tl-changed');
  const resetBtn = button('undo', 'Start over', 'Drop every strike and Restore: back to the agent’s edit list (your Keeps and notes stay)', () => ui.act('resetWorking'), 'small calm');
  const rebuildBtn = button('film', 'Rebuild rough', 'Have the rough built from your working edit list (asks the agent)', () => ui.act('rebuild'), 'small');
  const tools = h('span.tl-tools',
    button('scissors', 'Blade', 'Split the piece at the playhead (B)', () => ui.act('blade'), 'small calm'),
    button(null, 'Ripple delete', 'Take out In to Out and close the gap (Shift+Delete)', () => ui.act('rippleDelete'), 'small calm'));
  const bar = h('div.tl-bar',
    button('zoomout', '', 'Zoom out (-)', () => zoomBy(1 / 1.5)), zoomSlider, button('zoomin', '', 'Zoom in (=)', () => zoomBy(1.5)),
    button(null, 'Fit', 'Show it all (Shift+Z)', () => fit(), 'small calm'), snapBtn, tools, ioEl, h('div.grow'), changeEl, resetBtn, rebuildBtn);
  const scroll = h('input.tl-scroll', { type: 'range', min: 0, max: 1000, value: 0, title: 'Scroll (wheel)' });
  const wrap = h('div.tl-canvas-wrap', canvas);
  const el = h('div.timeline', bar, h('div.tl-body', heads, wrap), scroll);

  let view = { start: 0, pps: 10 }, width = 600, height = TRACKS.reduce((a, t) => a + t.h, 0), dpr = 1, pending = false, fitted = false;
  let marks = []; // [{ x-time, cut, kind: 'cut'|'restored'|'you'|'edge' }]
  let overlays = []; // events mapped onto the working list
  const total = () => (S.ps.length ? S.ps[S.ps.length - 1].end : 0);
  const top = (id) => { let y = 0; for (const t of TRACKS) { if (t.id === id) return y; y += t.h; } return y; };
  const cutTime = (c) => toEdit(S.ps, c.src, Number(c.to));
  const tl = { top, view: () => view, xToTime: (x) => xToTime(x, view), timeToX: (t) => timeToX(t, view), draw: () => draw(), paintIO: () => api.paintIO(), cutTime };
  const trimmer = createTrimmer(store, ui, tl);
  const ruler = createRuler(store, ui, tl);
  const inspector = createInspector(store, ui, el);

  // ------------------------------------------------------------------ data
  function rebuild() {
    marks = [];
    const seen = new Set();
    for (const c of S.cuts) {
      if (c.jump) { const at = toEdit(S.ps, c.src, Number(c.to)); if (at != null) marks.push({ t: at, cut: c, kind: 'cut' }); continue; }
      const back = S.review[c.id]?.keep === false && store.restorable(c.id);
      const at = back ? toEdit(S.ps, c.src, (Number(c.from) + Number(c.to)) / 2) : toEdit(S.ps, c.src, Number(c.to));
      if (at == null) continue;
      marks.push({ t: at, cut: c, kind: back ? 'restored' : 'cut' });
      seen.add(Math.round(at * 100));
    }
    for (const p of S.ps.slice(1)) {
      if (seen.has(Math.round(p.at * 100))) continue;
      marks.push({ t: p.at, cut: null, kind: p.cut?.by === 'you' ? 'you' : 'edge' });
    }
    // the overlays were timed on the engine's rough: put them where those moments now play
    const move = (x) => { const s = toSource(S.basePs, x); return s && s.media ? toEdit(S.ps, s.media, s.time) : null; };
    overlays = [...applyEdits(S.events, S.eventEdits), ...boxEvents(S.redactions)].map((e) => {
      const at = move(Number(e.at)), end = move(Math.max(Number(e.at), Number(e.end) - 0.001));
      return at == null ? null : { ...e, a: at, b: end == null ? at + (Number(e.end) - Number(e.at)) : end };
    }).filter(Boolean);
    const n = (S.working?.working?.restored || []).length, k = S.strikes.length, tr = S.trims.length, bl = S.blades.length;
    changeEl.textContent = n || k || tr || bl ? [n ? `${n} restored` : '', k ? `${k} struck` : '', tr ? `${tr} join${tr > 1 ? 's' : ''} moved` : '', bl ? `${bl} split` : ''].filter(Boolean).join(' · ') + ' · not built yet' : '';
    resetBtn.hidden = rebuildBtn.hidden = !(n || k || tr || bl);
    ruler.rebuild(); trimmer.rebuild(); inspector.refresh();
    if (!fitted && total()) { fit(); fitted = true; }
    draw();
  }

  // ------------------------------------------------------------------ view
  function setView(v) { view = clampView(v, total(), width); syncControls(); draw(); }
  let fittedView = true; // the view still shows it all: it fits again when the panel is resized
  function fit() { setView(fitView(total(), width)); fittedView = true; }
  function zoomBy(f, x = width / 2) { setView(zoomAround(view, f, x, total(), width)); fittedView = false; }
  function syncControls() {
    const lo = Math.log(fitView(total(), width).pps), hi = Math.log(400);
    zoomSlider.value = String(Math.round(((Math.log(view.pps) - lo) / Math.max(0.001, hi - lo)) * 1000));
    const span = width / view.pps, maxStart = Math.max(0.001, total() - span * 0.9);
    scroll.value = String(Math.round((view.start / maxStart) * 1000));
    scroll.disabled = span >= total();
  }
  zoomSlider.addEventListener('input', () => {
    const lo = Math.log(fitView(total(), width).pps), hi = Math.log(400);
    const pps = Math.exp(lo + (Number(zoomSlider.value) / 1000) * (hi - lo));
    const x = Math.max(0, Math.min(width, timeToX(ui.time(), view)));
    view = clampView(zoomAround(view, pps / view.pps, x, total(), width), total(), width); fittedView = false; draw(); syncControls();
  });
  scroll.addEventListener('input', () => {
    const span = width / view.pps, maxStart = Math.max(0, total() - span * 0.9);
    view = { ...view, start: (Number(scroll.value) / 1000) * maxStart }; draw();
  });

  // ------------------------------------------------------------------ drawing
  function draw() { if (!pending) { pending = true; requestAnimationFrame(paint); } }
  function paint() {
    pending = false;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg2; g.fillRect(0, 0, width, height);
    const X = (t) => timeToX(t, view);
    const t0 = view.start, t1 = view.start + width / view.pps;
    // track grounds
    for (const [n, tr] of TRACKS.entries()) { g.fillStyle = n % 2 ? C.bg : C.bg2; g.fillRect(0, top(tr.id), width, tr.h); }
    g.fillStyle = C.line; for (const tr of TRACKS) g.fillRect(0, top(tr.id) + tr.h - 1, width, 1);
    // In / Out
    if (ui.marks.in != null || ui.marks.out != null) {
      const a = X(ui.marks.in ?? 0), b = X(ui.marks.out ?? total());
      g.fillStyle = C.io; g.fillRect(a, TRACKS[0].h, b - a, height);
    }
    rulerPaint(g, X);
    ruler.paint(g, X, width, TRACKS[0].h);
    // V2 and captions
    for (const e of overlays) {
      if (e.b < t0 || e.a > t1) continue;
      const cap = e.kind === 'caption', y = top(cap ? 'cap' : 'v2') + 3, hh = (cap ? 24 : 30) - 7;
      const x = X(e.a), w = Math.max(2, X(e.b) - x);
      const blur = e.kind === 'blur';
      g.fillStyle = cap ? C.cap : blur ? C.blur : e.kind === 'zoom' ? C.zoom : C.overlay; g.fillRect(x, y, w, hh);
      g.fillStyle = cap ? C.capTop : blur ? C.blurTop : C.overlayTop; g.fillRect(x, y, w, 2);
      if (e.id === inspector.id || (blur && e.box && e.box === ui.selectedBox?.())) { g.fillStyle = C.sel; g.fillRect(x, y + hh - 2, w, 2); }
      const label = cap ? (e.words || []).map((w) => (Array.isArray(w) ? w[2] : w?.w || '')).join(' ')
        : blur ? `${e.box ? 'your ' : ''}${e.mode || 'blur'} ${e.box || e.id}` : `${e.edited ? '\u270e ' : ''}${e.text || e.props?.text || e.what || e.comp || e.kind || e.id || ''}`;
      text(g, String(label), x + 3, y + hh - 5, w - 6, C.text, 11);
    }
    // V1 pieces
    const y1 = top('v1') + 3, h1 = 54 - 7;
    for (const p of S.ps) {
      if (p.end < t0 || p.at > t1) continue;
      const x = X(p.at), w = Math.max(1, X(p.end) - x - 1);
      g.fillStyle = p.type === 'play' ? C.clip : p.type === 'wait' ? C.wait : p.type === 'hold' ? C.hold : C.card;
      g.fillRect(x, y1, w, h1);
      g.fillStyle = p.type === 'play' ? C.clipTop : C.tan; g.fillRect(x, y1, w, 2);
      if (p.type === 'wait') { g.fillStyle = 'rgba(232,197,71,0.18)'; for (let k = x; k < x + w; k += 8) g.fillRect(k, y1 + 2, 3, h1 - 2); }
      if (w > 40) text(g, p.type === 'wait' ? `wait ×${+p.rate.toFixed(1)}` : p.type === 'card' ? 'card' : `${p.media} ${fmtTime(p.in)}`, x + 4, y1 + 15, w - 8, C.text, 11);
    }
    // cut marks
    const sel = ui.currentCut()?.id;
    for (const m of marks) {
      if (m.t < t0 - 1 || m.t > t1 + 1) continue;
      const x = Math.round(X(m.t));
      const col = m.kind === 'restored' ? C.restored : m.kind === 'you' ? C.you : m.cut?.flag ? C.flag : m.kind === 'edge' ? C.dim : C.mark;
      if (m.cut && m.cut.id === sel) { g.fillStyle = 'rgba(232,197,71,0.28)'; g.fillRect(x - 5, y1 - 3, 10, h1 + 6); }
      g.fillStyle = col;
      if (m.kind === 'restored') { diamond(g, x, y1 + h1 / 2, 5); continue; }
      g.fillRect(x - 1, y1 - 2, m.cut?.flag ? 3 : 2, h1 + 4);
      tri(g, x, y1 - 2, m.cut?.flag ? 5 : 4);
      if (m.cut && S.review[m.cut.id]?.keep === true) { g.fillStyle = C.restored; g.fillRect(x - 2, y1 + h1 - 4, 4, 4); }
    }
    trimmer.paint(g, X, y1, h1);
    wavePaint(g, X, t0, t1);
    // the playhead
    const px = Math.round(X(ui.time()));
    if (px >= -2 && px <= width + 2) {
      g.fillStyle = C.head; g.fillRect(px - 1, 0, 2, height);
      g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px + 6, 6); g.lineTo(px, 12); g.lineTo(px - 6, 6); g.closePath(); g.fill();
    }
  }
  function rulerPaint(g, X) {
    const step = tickStep(view.pps), fps = S.fps || 30;
    g.fillStyle = C.dim;
    const minor = step / 5;
    for (let t = Math.floor(view.start / minor) * minor; t < view.start + width / view.pps; t += minor) g.fillRect(Math.round(X(t)), 18, 1, 6);
    for (const t of ticks(view, width)) {
      const x = Math.round(X(t));
      g.fillStyle = C.dim; g.fillRect(x, 10, 1, 14);
      text(g, tickLabel(t, step, fps), x + 3, 13, 200, C.text, 11);
    }
  }
  function wavePaint(g, X, t0, t1) {
    const y = top('a1'), hh = 64, mid = y + hh / 2;
    let any = false;
    for (const p of S.ps) {
      if (p.end < t0 || p.at > t1) continue;
      const pk = S.peaks[p.media];
      const xa = Math.max(0, X(p.at)), xb = Math.min(width, X(p.end));
      if (!pk || p.type !== 'play') { g.fillStyle = C.waveDim; g.fillRect(xa, mid, xb - xa, 1); continue; }
      any = true;
      g.fillStyle = C.wave;
      for (let x = Math.floor(xa); x < xb; x++) {
        const ta = xToTime(x, view), tb = xToTime(x + 1, view);
        const sa = p.in + (ta - p.at), sb = p.in + (tb - p.at);
        let i0 = Math.max(0, Math.floor(sa * pk.rate)), i1 = Math.min(pk.peaks.length - 1, Math.ceil(sb * pk.rate));
        let v = 0; for (let i = i0; i <= i1; i++) if (pk.peaks[i] > v) v = pk.peaks[i];
        const a = Math.max(1, v * (hh - 8) / 2);
        g.fillRect(x, mid - a, 1, a * 2);
      }
    }
    if (!any && S.ps.length) text(g, 'The waveform shows once the server has made the proxy.', 8, y + 14, width, C.dim, 11);
  }
  function text(g, s, x, y, max, color, size) {
    if (max < 12) return;
    g.font = `${size}px 'Pixelify Sans', 'Segoe UI', system-ui, sans-serif`; g.fillStyle = color;
    let str = s;
    if (g.measureText(str).width > max) { while (str.length > 1 && g.measureText(str + '…').width > max) str = str.slice(0, -1); str += '…'; }
    g.fillText(str, x, y);
  }
  const tri = (g, x, y, s) => { g.beginPath(); g.moveTo(x - s, y - s); g.lineTo(x + s, y - s); g.lineTo(x, y + 1); g.closePath(); g.fill(); };
  const diamond = (g, x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); g.fill(); };

  // ------------------------------------------------------------------ pointer
  const snapMarks = () => [0, total(), ...S.ps.map((p) => p.at), ...marks.map((m) => m.t), ui.marks.in, ui.marks.out].filter((x) => x != null);
  canvas.addEventListener('pointerdown', (e) => {
    ui.setScope('editor');
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (ruler.down(x, y)) return;
    if (trimmer.down(e, x, y, () => canvas.getBoundingClientRect())) return;
    if (y >= top('v1') && y < top('v1') + 54) {
      const hit = marks.filter((m) => m.cut).map((m) => ({ m, d: Math.abs(timeToX(m.t, view) - x) })).sort((a, b) => a.d - b.d)[0];
      if (hit && hit.d <= 6) { ui.selectCut(hit.m.cut.id, { seek: true }); return; }
    }
    if (y >= top('v2') && y < top('cap')) {
      const t = xToTime(x, view), ev = overlays.filter((o) => o.kind !== 'caption' && t >= o.a && t <= o.b).pop();
      if (ev?.box) { inspector.close(); ui.selectBox?.(ev.box); ui.seek(Math.max(0, ev.a)); draw(); return; }
      if (ev) { inspector.open(ev.id, x); draw(); return; }
    }
    canvas.setPointerCapture(e.pointerId);
    const scrub = (ev) => {
      const xx = ev.clientX - r.left;
      let t = Math.max(0, Math.min(total(), xToTime(xx, view)));
      if (ui.snap && !ev.shiftKey) t = snapTime(t, snapMarks(), view.pps).t;
      ui.seek(t);
    };
    scrub(e);
    const move = (ev) => scrub(ev);
    const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left);
    else setView({ ...view, start: view.start + ((e.deltaX || e.deltaY) / view.pps) * 0.8 });
  }, { passive: false });
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let tip = ruler.tip(x, y);
    if (tip) { canvas.title = tip; return; }
    if (y >= top('v1') && y < top('v1') + 54 && (tip = trimmer.tip(x))) {
      const m = marks.find((mm) => mm.cut && Math.abs(timeToX(mm.t, view) - x) <= 6);
      if (m) tip = `${m.cut.id} · ${m.cut.kind || 'cut'}${m.cut.flag ? ' · flagged' : ''}${m.kind === 'restored' ? ' · restored' : ''}\n${m.cut.why || ''}\n\n${tip}`;
    } else if (y >= top('v1') && y < top('v1') + 54) {
      const m = marks.find((mm) => Math.abs(timeToX(mm.t, view) - x) <= 6);
      if (m?.cut) tip = `${m.cut.id} · ${m.cut.kind || 'cut'}${m.cut.flag ? ' · flagged' : ''}${m.kind === 'restored' ? ' · restored' : ''}\n${m.cut.why || ''}`;
      else if (m?.kind === 'you') tip = 'Your cut (struck in the transcript)';
      else {
        const t = xToTime(x, view), p = S.ps.find((q) => t >= q.at && t < q.end);
        if (p) tip = p.type === 'play' ? `${p.media}: ${fmtTime(p.in)}–${fmtTime(p.in + p.len)} of the recording (${p.len.toFixed(1)} s)` : p.type === 'wait' ? `A wait played ${+p.rate.toFixed(1)}× faster (${p.media} from ${fmtTime(p.in)})` : p.type === 'hold' ? 'A still picture' : 'A card';
      }
    } else if (y >= top('v2') && y < top('cap') + 24) {
      const t = xToTime(x, view), e2 = overlays.find((o) => t >= o.a && t <= o.b && ((y >= top('cap')) === (o.kind === 'caption')));
      if (e2) tip = `${e2.box ? `your blur box ${e2.box}` : `${e2.id || ''} ${e2.kind || ''}`}: ${e2.text || e2.props?.text || e2.what || e2.comp || ''}\n(click to ${e2.box ? 'change it in the viewer' : 'open the inspector'})`;
    }
    canvas.title = tip;
  });

  new ResizeObserver(() => {
    const r = wrap.getBoundingClientRect();
    if (!r.width) return; // hidden (another tab)
    width = Math.max(100, Math.floor(r.width)); dpr = devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    if ((!fitted || fittedView) && total()) { fit(); fitted = true; } else setView(view);
  }).observe(wrap);

  const api = {
    el, rebuild, draw, fit, zoomBy, inspector,
    nudge: (dir) => trimmer.nudge(dir), blade: () => trimmer.blade(), ripple: () => trimmer.ripple(),
    follow(t) { const v = follow(view, t, width); if (v !== view) setView(v); else draw(); },
    paintIO() {
      const { in: a, out: b } = ui.marks;
      ioEl.textContent = a != null || b != null ? `I ${a != null ? fmtTime(a) : '–'}  O ${b != null ? fmtTime(b) : '–'}` : '';
      draw();
    },
    paintSnap() { snapBtn.classList.toggle('on', ui.snap); },
  };
  return api;
}
