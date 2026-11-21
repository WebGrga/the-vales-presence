// Trimming joins on the timeline (pure, no DOM; tested in edl-trim.test.js). A join is where one piece ends and the next begins; each side
// can be trimmed: 'out' moves where the piece before it ends, 'in' moves where the piece after it starts (a ripple trim: everything after
// moves with it). The checks are the engine's join rules (engine/joins.py), measured here on the words only: an edge inside a word clips it,
// and the engine wants 0.2 s of room after the last kept word and 0.05 s before the next one. The engine measures the sound again when it builds.

const MIN_PIECE = 0.04;
export const ROOM_AFTER = 0.2, ROOM_BEFORE = 0.05;
const r3 = (x) => Math.round(x * 1000) / 1000;

// a piece (edl-map.js) whose sound is a stretch of its source at speed 1 can be trimmed
export const trimmable = (p) => !!p && p.type === 'play' && (p.rate || 1) === 1;

// the joins of the pieces: [{ k (index of the piece after it), t (edit time), out: { src, at } | null, in: { src, at } | null }]
export function joinsOf(ps) {
  const out = [];
  for (let k = 1; k < ps.length; k++) {
    const L = ps[k - 1], R = ps[k];
    out.push({ k, t: R.at, out: trimmable(L) ? { src: L.media, at: r3(L.in + L.len) } : null, in: trimmable(R) ? { src: R.media, at: r3(R.in) } : null });
  }
  return out;
}

// the join nearest to edit time t within tol seconds, or null
export function joinNear(ps, t, tol) {
  let best = null;
  for (const j of joinsOf(ps)) if (Math.abs(j.t - t) <= tol && (!best || Math.abs(j.t - t) < Math.abs(best.t - t))) best = j;
  return best;
}

// where the edge of this side may go, in source seconds: [min, max]. srcLen = how long that source is (null when not known).
// An edge may not run into the piece on the other side when both play the same source in order (that would play it twice).
export function limits(ps, k, side, srcLen = null) {
  const L = ps[k - 1], R = ps[k];
  if (side === 'out') {
    const lo = L.in + MIN_PIECE;
    let hi = srcLen ?? Infinity;
    if (R && R.media === L.media && trimmable(R) && R.in >= L.in + L.len - 1e-6) hi = Math.min(hi, R.in);
    return [r3(lo), hi === Infinity ? hi : r3(hi)];
  }
  const hi = R.in + R.len - MIN_PIECE;
  let lo = 0;
  if (L && L.media === R.media && trimmable(L) && L.in + L.len <= R.in + 1e-6) lo = L.in + L.len;
  return [r3(lo), r3(hi)];
}

// a source time on a whole frame of the edit
export const onFrame = (t, fps) => Math.round(t * fps) / fps;

// what the words say about an edge at source time t on this side -> { level: 'clip'|'tight'|null, text, word }
// words = one source's [{ s, e, w }] in order
export function checkEdge(words, t, side) {
  const list = words || [];
  const inside = list.find((w) => t > w.s + 0.01 && t < w.e - 0.01);
  if (inside) return { level: 'clip', word: inside.w, text: `cuts into “${inside.w}”: that word would be clipped` };
  if (side === 'out') {
    let last = null;
    for (const w of list) { if (w.e <= t + 0.01) last = w; else break; }
    if (last && t - last.e < ROOM_AFTER) return { level: 'tight', word: last.w, text: `only ${Math.round((t - last.e) * 1000)} ms after “${last.w}” (the engine wants ${ROOM_AFTER * 1000})` };
  } else {
    const next = list.find((w) => w.s >= t - 0.01);
    if (next && next.s - t < ROOM_BEFORE) return { level: 'tight', word: next.w, text: `only ${Math.max(0, Math.round((next.s - t) * 1000))} ms before “${next.w}” (the engine wants ${ROOM_BEFORE * 1000})` };
  }
  return { level: null, text: '', word: null };
}

// good places for an edge of this side between lo and hi: just after a word with its room ('out'), just before one ('in'), and the middle of every pause
export function snapPoints(words, side, lo, hi) {
  const pts = [];
  const list = words || [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i], next = list[i + 1];
    if (side === 'out') pts.push(w.e + ROOM_AFTER); else pts.push(w.s - ROOM_BEFORE);
    if (next && next.s - w.e > 0.15) pts.push((w.e + next.s) / 2);
  }
  return pts.filter((x) => x >= lo && x <= hi).map(r3);
}

// t snapped to the nearest point within tol seconds -> { t, snapped }
export function snapTo(t, points, tol) {
  let best = null, d = tol;
  for (const p of points) { const x = Math.abs(p - t); if (x <= d) { best = p; d = x; } }
  return best == null ? { t, snapped: false } : { t: best, snapped: true };
}

// a trim of one side moved by `dt` source seconds, kept inside its limits and on a frame -> { src, at, side, to, clamped }
export function moveEdge(ps, k, side, dt, fps, srcLen = null) {
  const j = joinsOf(ps).find((x) => x.k === k);
  const e = j?.[side];
  if (!e) return null;
  const [lo, hi] = limits(ps, k, side, srcLen);
  const want = onFrame(e.at + dt, fps);
  const to = r3(Math.min(hi, Math.max(lo, want)));
  return { src: e.src, at: e.at, side, to, clamped: Math.abs(to - r3(want)) > 1e-6 };
}

// the blade at edit time t: the source and time of the cut, or { why } when it cannot go there
export function bladeAt(ps, t) {
  const p = ps.find((x) => t >= x.at && t < x.end);
  if (!p) return { why: 'the playhead is past the end' };
  if (!trimmable(p)) return { why: 'the blade cuts pieces of talk; this is a wait, a still or a card' };
  if (t - p.at < MIN_PIECE || p.end - t < MIN_PIECE) return { why: 'the playhead is on a join already' };
  return { src: p.media, t: r3(p.in + (t - p.at)) };
}

// the words check of a ripple delete from edit time a to b: the two new edges -> [{ level, text }] with something to say
export function rippleChecks(ps, a, b, wordsOf) {
  const lo = Math.min(a, b), hi = Math.max(a, b), out = [];
  const at = (t) => { const p = ps.find((x) => t >= x.at - 1e-6 && t <= x.end + 1e-6 && trimmable(x)); return p ? { src: p.media, s: p.in + (t - p.at) } : null; };
  const L = at(lo), R = at(hi);
  if (L) { const c = checkEdge(wordsOf(L.src), L.s, 'out'); if (c.level) out.push(c); }
  if (R) { const c = checkEdge(wordsOf(R.src), R.s, 'in'); if (c.level) out.push(c); }
  return out;
}
