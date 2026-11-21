// Editing on the timeline: trim a join (drag one side of it on V1, or nudge the picked side a frame with , and .), blade at the
// playhead, ripple delete In to Out. Every change goes into the working edit list through the store (undo with Ctrl+Z) and plays at once
// around the join. The maths and the word checks are in edl-trim.js; the list itself in edl-edit.js.
import { joinsOf, joinNear, moveEdge, limits, checkEdge, snapPoints, snapTo, bladeAt, rippleChecks } from './edl-trim.js';
import { setTrim, editRangeStrikes } from './edl-edit.js';
import { timeToX } from './zoom.js';
import { recipeOf, isLocked } from '../shell/stages.js';

const C = { sel: '#e8c547', trim: '#e8c547', clip: '#c44d3a', tight: '#d98a2b', ghost: 'rgba(232,197,71,0.85)' };
const GRAB = 7; // pixels from a join that grab it
// once the talk is locked (its gate approved) the edit list no longer changes the video: these tools say so instead
const lockedNow = () => { const p = window.presence?.project?.(); return !!p && isLocked(p, recipeOf(p)); };
const LOCKED = 'The talk is locked: trims, blades and ripple deletes no longer change the video. Send it back with a note instead.';

export function createTrimmer(store, ui, tl) {
  const S = store.S;
  let sel = null;    // { src, at, side }: the picked side of a join, found again by where its edge is
  let drag = null;   // { k, side, x0, moved, to, check }
  let warns = [];    // [{ t, level, text }] joins you moved whose new edge the words do not like
  let playTimer = 0, pauseTimer = 0;
  const fps = () => S.fps || 30;
  const wordsOf = (src) => S.words[src] || [];
  const srcLen = (src) => { const p = S.peaks[src]; return p ? p.peaks.length / p.rate : null; };

  // the join and side of the selection in the pieces as they are now
  function selected() {
    if (!sel) return null;
    for (const j of joinsOf(S.ps)) { const e = j[sel.side]; if (e && e.src === sel.src && Math.abs(e.at - sel.at) < 0.002) return { j, side: sel.side }; }
    return null;
  }

  function rebuild() {
    warns = [];
    for (const j of joinsOf(S.ps)) {
      const R = S.ps[j.k];
      if (!(R.cut?.trimmed || R.cut?.by === 'you')) continue;
      for (const side of ['out', 'in']) {
        const e = j[side];
        if (!e) continue;
        const c = checkEdge(wordsOf(e.src), e.at, side);
        if (c.level) warns.push({ t: j.t, level: c.level, text: `${side === 'out' ? 'The end before this join' : 'The start after this join'} ${c.text}` });
      }
    }
    if (sel && !selected()) sel = null;
  }

  // pointer: a press near a join on V1 picks its side (left half: the end of the piece before; right half: the start of the next);
  // dragging moves that edge. Returns true when it took the press.
  function down(e, x, y, rect) {
    const top = tl.top('v1');
    if (y < top || y > top + 54) return false;
    const t = tl.xToTime(x);
    const j = joinNear(S.ps, t, GRAB / tl.view().pps);
    if (!j) return false;
    let side = x < timeToX(j.t, tl.view()) ? 'out' : 'in';
    if (!j[side]) side = side === 'out' ? 'in' : 'out';
    if (!j[side]) return false;
    sel = { ...j[side], side };
    drag = { k: j.k, side, x0: x, moved: false, to: null, check: null, t: j.t };
    const move = (ev) => {
      const xx = ev.clientX - rect().left;
      if (!drag.moved && Math.abs(xx - drag.x0) < 3) return;
      if (!drag.moved && lockedNow()) { drag.locked = true; return; }
      drag.moved = true;
      const dt = (xx - drag.x0) / tl.view().pps;
      let m = moveEdge(S.ps, drag.k, side, dt, fps(), srcLen(sel.src));
      if (m && ui.snap && !ev.shiftKey) {
        const [lo, hi] = limits(S.ps, drag.k, side, srcLen(sel.src));
        const s = snapTo(m.to, snapPoints(wordsOf(m.src), side, lo, hi), 8 / tl.view().pps);
        if (s.snapped) m = { ...m, to: Math.round(s.t * 1000) / 1000 };
      }
      drag.to = m; drag.check = m ? checkEdge(wordsOf(m.src), m.to, side) : null;
      tl.draw();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const d = drag; drag = null;
      if (d.locked) ui.toast?.(LOCKED, 'warn');
      else if (d.moved && d.to && Math.abs(d.to.to - d.to.at) > 1e-4) apply(d.to);
      else if (!d.moved) { // a click: the cut under it is picked too, as before
        const c = S.cuts.find((cc) => Math.abs((tl.cutTime(cc) ?? -9) - d.t) < 0.02);
        if (c) ui.selectCut(c.id, { seek: true }); else ui.seek(Math.max(0, d.t - 1));
        ui.toast?.(`Picked the ${side === 'out' ? 'end of the piece before' : 'start of the piece after'} this join: , and . move it a frame, or drag it.`);
      }
      tl.draw();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
    tl.draw();
    return true;
  }

  function apply(m) {
    store.editWorking((s) => { s.trims = setTrim(s.trims, m); });
    sel = { src: m.src, at: m.to, side: m.side };
    const c = checkEdge(wordsOf(m.src), m.to, m.side);
    const n = Math.round((m.to - m.at) * fps());
    const what = `${m.side === 'out' ? 'End' : 'Start'} moved ${n > 0 ? '+' : ''}${n} frame${Math.abs(n) === 1 ? '' : 's'}`;
    ui.toast?.(c.level ? `${what}: careful, it ${c.text}.` : `${what}${m.clamped ? ' (as far as it goes)' : ''}. Ctrl+Z undoes.`, c.level === 'clip' ? 'error' : c.level ? 'warn' : undefined);
    playAround();
  }

  // play a second either side of the picked join, once the keys stop
  function playAround() {
    clearTimeout(playTimer); clearTimeout(pauseTimer);
    playTimer = setTimeout(() => {
      const s = selected();
      if (!s) return;
      ui.seek(Math.max(0, s.j.t - 1.2), { play: true });
      pauseTimer = setTimeout(() => ui.act('pause'), 2400);
    }, 250);
  }

  function nudge(dir) {
    if (lockedNow()) { ui.toast?.(LOCKED, 'warn'); return; }
    let s = selected();
    if (!s) {
      const j = joinNear(S.ps, ui.time(), 2);
      if (!j) { ui.toast?.('Click a join on V1 first (left of it: the end before; right of it: the start after), or put the playhead near one.'); return; }
      const side = j.out ? 'out' : 'in';
      sel = { ...j[side], side };
      s = selected();
    }
    const m = moveEdge(S.ps, s.j.k, s.side, dir / fps(), fps(), srcLen(sel.src));
    if (!m || Math.abs(m.to - m.at) < 1e-4) { ui.toast?.('That edge cannot go further this way.'); return; }
    apply(m);
  }

  function blade() {
    if (lockedNow()) { ui.toast?.(LOCKED, 'warn'); return false; }
    const b = bladeAt(S.ps, ui.time());
    if (b.why) { ui.toast?.(`No blade here: ${b.why}.`); return false; }
    store.editWorking((s) => { s.blades = [...s.blades, [b.src, b.t]]; });
    ui.toast?.('Split here: drag or nudge either side of the new join. Ctrl+Z undoes.');
    return true;
  }

  function ripple() {
    if (lockedNow()) { ui.toast?.(LOCKED, 'warn'); return false; }
    const { in: a, out: b } = ui.marks;
    if (a == null || b == null || Math.abs(b - a) < 0.05) { ui.toast?.('Mark In (I) and Out (O) first: the ripple delete takes that stretch out and closes the gap.'); return false; }
    const r = editRangeStrikes(S.ps, a, b);
    if (!r.length) { ui.toast?.('Nothing to take out between In and Out (waits and stills are not cut this way).'); return false; }
    const warn = rippleChecks(S.ps, a, b, wordsOf);
    store.strike(r);
    ui.marks.in = null; ui.marks.out = null; tl.paintIO();
    ui.toast?.(warn.length ? `Taken out, but the new join ${warn.map((w) => w.text).join('; and ')}.` : 'Taken out from In to Out. Ctrl+Z undoes.', warn.some((w) => w.level === 'clip') ? 'error' : warn.length ? 'warn' : undefined);
    ui.seek(Math.max(0, Math.min(a, b) - 1.2), { play: true });
    clearTimeout(pauseTimer); pauseTimer = setTimeout(() => ui.act('pause'), 2400);
    return true;
  }

  function paint(g, X, y1, h1) {
    for (const w of warns) {
      const x = Math.round(X(w.t));
      g.fillStyle = w.level === 'clip' ? C.clip : C.tight;
      g.beginPath(); g.arc(x, y1 + h1 - 7, 4, 0, Math.PI * 2); g.fill();
    }
    const s = selected();
    if (s) {
      const x = Math.round(X(s.j.t)), d = s.side === 'out' ? -1 : 1;
      g.fillStyle = C.sel;
      g.fillRect(x - (d < 0 ? 3 : 0), y1 - 3, 3, h1 + 6);
      g.fillRect(x + (d < 0 ? -9 : 0), y1 - 3, 9, 3); g.fillRect(x + (d < 0 ? -9 : 0), y1 + h1, 9, 3);
    }
    if (drag?.moved && drag.to) {
      const dx = (drag.to.to - drag.to.at) * tl.view().pps, x = Math.round(X(drag.t) + dx);
      g.fillStyle = drag.check?.level === 'clip' ? C.clip : C.ghost;
      g.fillRect(x - 1, y1 - 6, 2, h1 + 12);
      const n = Math.round((drag.to.to - drag.to.at) * fps());
      const label = `${n > 0 ? '+' : ''}${n} f${drag.check?.level ? ' · ' + (drag.check.level === 'clip' ? 'clips a word' : 'tight') : ''}`;
      g.font = '12px system-ui, sans-serif'; g.fillStyle = '#f5efe0'; g.fillText(label, x + 5, y1 + 12);
    }
  }

  // a tooltip for a join under x on V1
  function tip(x) {
    const t = tl.xToTime(x);
    const w = warns.find((ww) => Math.abs(X(ww.t) - x) <= GRAB);
    if (w) return w.text;
    const j = joinNear(S.ps, t, GRAB / tl.view().pps);
    if (!j) return '';
    return 'Drag to trim this join: left of it moves the end of the piece before, right of it the start of the next (ripple). , and . move the picked side a frame. Shift: no snapping.';
  }
  const X = (t) => timeToX(t, tl.view());

  return { rebuild, down, paint, tip, nudge, blade, ripple, get dragging() { return !!drag; }, clear() { sel = null; } };
}
