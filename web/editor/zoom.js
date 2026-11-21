// Timeline maths (pure, no DOM; tested in zoom.test.js). A view is { start (seconds at the left edge), pps (pixels per
// second) } over a timeline `width` pixels wide and `total` seconds long.

export const MIN_PPS = 0.5, MAX_PPS = 1200;

export const clampPps = (pps) => Math.min(MAX_PPS, Math.max(MIN_PPS, pps));
export const timeToX = (t, v) => (t - v.start) * v.pps;
export const xToTime = (x, v) => v.start + x / v.pps;

// the view that shows the whole timeline (a little room at the end)
export function fitView(total, width) {
  return { start: 0, pps: clampPps(width / Math.max(1, total * 1.02)) };
}

// keep the start inside [0, total - what fits] (never scroll past the end when it all fits)
export function clampView(v, total, width) {
  const span = width / v.pps;
  const max = Math.max(0, total - span * 0.9);
  return { start: Math.min(Math.max(0, v.start), max), pps: v.pps };
}

// zoom by factor around a pixel x (the time under it stays under it)
export function zoomAround(v, factor, x, total, width) {
  const t = xToTime(x, v), pps = clampPps(v.pps * factor);
  return clampView({ start: t - x / pps, pps }, total, width);
}

// scroll so t is in view (with a margin), else leave the view alone
export function follow(v, t, width, margin = 0.1) {
  const span = width / v.pps;
  if (t < v.start || t > v.start + span * (1 - margin)) return { start: Math.max(0, t - span * margin), pps: v.pps };
  return v;
}

// snap t to the nearest mark within tolPx pixels; returns { t, snapped }
export function snapTime(t, marks, pps, tolPx = 8) {
  let best = null, bestD = tolPx / pps;
  for (const m of marks) { const d = Math.abs(m - t); if (d <= bestD) { best = m; bestD = d; } }
  return best == null ? { t, snapped: false } : { t: best, snapped: true };
}

const STEPS = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

// seconds between labelled ruler ticks: the smallest step at least minPx apart
export function tickStep(pps, minPx = 90) {
  return STEPS.find((s) => s * pps >= minPx) ?? STEPS[STEPS.length - 1];
}

// the labelled ticks in view: [t, ...]
export function ticks(v, width, minPx = 90) {
  const step = tickStep(v.pps, minPx), out = [];
  const first = Math.ceil(v.start / step - 1e-9) * step, end = v.start + width / v.pps;
  for (let t = first; t <= end + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

// m:ss (or h:mm:ss)
export function fmtTime(s) {
  const t = Math.max(0, Math.floor(Number(s) || 0)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

// a timecode hh:mm:ss:ff at fps
export function fmtTC(s, fps = 30) {
  const f = Math.max(0, Math.round((Number(s) || 0) * fps)), fr = f % fps, secs = Math.floor(f / fps);
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), x = secs % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(x)}:${p(fr)}`;
}

// a ruler label for a tick at this step: frames only when the step is under a second
export function tickLabel(t, step, fps = 30) {
  return step < 1 ? fmtTC(t, fps) : fmtTime(t);
}
