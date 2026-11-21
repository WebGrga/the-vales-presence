// Review markers on the ruler: the stages' review items (video/out/review-items.json) and the flagged cuts, each a little flag with
// its words as a tooltip; a click seeks to it (a flagged cut is picked in the Cuts list too). The list itself is timeline-marks.js.
import { markers, markerAt, tipOf } from './timeline-marks.js';
import { baseToWorking } from './edl-overlays.js';
import { toEdit } from './edl-map.js';
import { fmtTime } from './zoom.js';

const COL = { review: '#6fa3e0', flag: '#d98a2b', private: '#e07a5a', done: '#7d7d8c' };

export function createRuler(store, ui, tl) {
  const S = store.S;
  let list = [];

  const cutAt = (c) => toEdit(S.ps, c.src, Number(c.to)) ?? null;
  function rebuild() { list = markers(S.reviewItems, S.cuts, (t) => baseToWorking(S.basePs, S.ps, t), cutAt); }

  function paint(g, X, width, rulerH) {
    for (const m of list) {
      const x = Math.round(X(m.t));
      if (x < -10 || x > width + 10) continue;
      g.fillStyle = COL[m.kind] || COL.review;
      if (m.end != null) { g.globalAlpha = 0.35; g.fillRect(x, rulerH - 5, Math.max(2, X(m.end) - x), 5); g.globalAlpha = 1; }
      g.fillRect(x, 2, 2, rulerH - 2);                       // the staff
      g.beginPath(); g.moveTo(x + 2, 2); g.lineTo(x + 11, 6); g.lineTo(x + 2, 10); g.closePath(); g.fill(); // the flag
    }
  }

  const X = (t) => tl.timeToX(t);
  const at = (x) => markerAt(list, x, X, 8);

  // a press on the ruler: on a marker, seek to it (true when it took the press)
  function down(x, y) {
    if (y > tl.top('v2')) return false;
    const m = at(x);
    if (!m) return false;
    if (m.cut) ui.selectCut(m.cut, { seek: true, lead: 1 });
    else ui.seek(Math.max(0, m.t - 0.5));
    return true;
  }

  const tip = (x, y) => { if (y > tl.top('v2')) return ''; const m = at(x); return m ? tipOf(m, fmtTime) + '\n(click to go there)' : ''; };

  return { rebuild, paint, down, tip, get list() { return list; } };
}
