// Blur boxes on the viewer (pure, no DOM; tested in viewer-boxes.test.js). A box is in the rough's pixels (edl width x height),
// times in rough seconds: { id, at, end, x, y, w, h, mode: 'blur'|'pixelate'|'fill', note? } (video/out/redactions.json).
// The picture sits in the screen element as object-fit: contain does it; these turn screen points into frame pixels and back.

export const MIN = 8;          // the smallest box side, frame pixels
export const HANDLE = 9;       // how near a corner grabs it, screen pixels
export const MODES = ['blur', 'pixelate', 'fill'];

// where a W x H picture sits in an elW x elH element: { x, y, w, h, k } (k = screen pixels per frame pixel)
export function fitRect(elW, elH, W, H) {
  const k = Math.min(elW / W, elH / H) || 1;
  const w = W * k, h = H * k;
  return { x: (elW - w) / 2, y: (elH - h) / 2, w, h, k };
}

export const toFrame = (px, py, fit) => ({ x: (px - fit.x) / fit.k, y: (py - fit.y) / fit.k });
export const toScreen = (b, fit) => ({ x: fit.x + b.x * fit.k, y: fit.y + b.y * fit.k, w: b.w * fit.k, h: b.h * fit.k });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// a box from two frame points, inside the frame; null when it is too small
export function boxFrom(a, b, W, H) {
  const x0 = clamp(Math.min(a.x, b.x), 0, W), y0 = clamp(Math.min(a.y, b.y), 0, H);
  const x1 = clamp(Math.max(a.x, b.x), 0, W), y1 = clamp(Math.max(a.y, b.y), 0, H);
  if (x1 - x0 < MIN || y1 - y0 < MIN) return null;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

// which part of which box is under a screen point: { id, part: 'move'|'nw'|'ne'|'sw'|'se' } or null (the last drawn box wins)
export function hit(boxes, px, py, fit) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const s = toScreen(boxes[i], fit);
    const near = (cx, cy) => Math.abs(px - cx) <= HANDLE && Math.abs(py - cy) <= HANDLE;
    if (near(s.x, s.y)) return { id: boxes[i].id, part: 'nw' };
    if (near(s.x + s.w, s.y)) return { id: boxes[i].id, part: 'ne' };
    if (near(s.x, s.y + s.h)) return { id: boxes[i].id, part: 'sw' };
    if (near(s.x + s.w, s.y + s.h)) return { id: boxes[i].id, part: 'se' };
    if (px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h) return { id: boxes[i].id, part: 'move' };
  }
  return null;
}

// a box dragged by (dx, dy) frame pixels on one part, kept inside the W x H frame and at least MIN on a side
export function drag(b, part, dx, dy, W, H) {
  if (part === 'move') return { ...b, x: Math.round(clamp(b.x + dx, 0, W - b.w)), y: Math.round(clamp(b.y + dy, 0, H - b.h)) };
  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  if (part.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, W);
  if (part.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN); else y1 = clamp(y1 + dy, y0 + MIN, H);
  return { ...b, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

// the boxes on screen at rough time t
export const activeAt = (boxes, t) => (boxes || []).filter((b) => t >= b.at && t < b.end);

// the next free id: R1, R2, ...
export function nextId(boxes) {
  let n = 0;
  for (const b of boxes || []) { const m = /^R(\d+)$/.exec(b.id); if (m) n = Math.max(n, Number(m[1])); }
  return `R${n + 1}`;
}

// the times of a new box: In to Out when both are marked around it, else from t for `len` seconds -> { at, end }
export function timesFor(t, marks, duration, len = 3) {
  const a = marks?.in, b = marks?.out;
  if (a != null && b != null && Math.abs(b - a) >= 0.1) return { at: round3(Math.min(a, b)), end: round3(Math.min(duration, Math.max(a, b))) };
  const at = a != null ? a : t;
  return { at: round3(at), end: round3(Math.min(duration, at + len)) };
}
const round3 = (x) => Math.round(x * 1000) / 1000;

// set one box's in or out, keeping it at least 0.1 s long
export function setTime(b, which, t, duration) {
  if (which === 'in') return { ...b, at: round3(clamp(t, 0, b.end - 0.1)) };
  return { ...b, end: round3(clamp(t, b.at + 0.1, duration)) };
}

// the boxes with one replaced (by id), added, or removed (box null)
export function put(boxes, id, box) {
  const list = (boxes || []).filter((b) => b.id !== id);
  if (box) list.push(box);
  return list.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}
