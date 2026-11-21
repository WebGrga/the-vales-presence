// The working edit list (pure, no DOM; tested in edl-edit.test.js). The engine's edl.json stays as the rough cut stage
// wrote it; the user's changes are kept as lists and the working copy is always made again from them, in this order:
//   restored: cut ids (cuts.json) put back = the two pieces around that cut joined into one
//   strikes:  [[src, from, to], ...] source stretches the user struck in the transcript (or rippled out from In to Out)
//   blades:   [[src, t], ...] source times where a piece is split in two (the blade: nothing is removed)
//   trims:    [{ src, at, side, to }, ...] a join moved on the timeline: the piece whose 'out' (end) or 'in' (start) is at source
//             time `at` now ends or starts at `to` (edl-trim.js checks it against the words)
// The result is a full edit list (same format) plus `working: { base, restored, strikes, blades?, trims? }`, so the editor can
// read its own choices back after a reload. The engine builds the real rough from it only when asked.

const EPS = 0.02;      // seconds: how close a cut's times must be to an item's edges to be that cut
const MIN_PIECE = 0.04; // a stretch shorter than this left over by a strike is dropped
const r3 = (x) => Math.round(x * 1000) / 1000;

const isPlain = (it) => it && it.src && (it.speed == null || Number(it.speed) === 1) && it.kind !== 'W';

// the index of the item that starts right after this cut (the cut sits between it and the one before), or -1
export function boundaryOf(items, cut) {
  if (!cut || cut.jump) return -1;
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1], b = items[i];
    if (!isPlain(a) || !isPlain(b) || a.src !== cut.src || b.src !== cut.src) continue;
    if (Math.abs(Number(a.src_out) - Number(cut.from)) < EPS && Math.abs(Number(b.src_in) - Number(cut.to)) < EPS) return i;
  }
  return -1;
}

// can this cut be put back by joining its two pieces?
export const restorable = (items, cut) => boundaryOf(items, cut) > 0;

// the items with these cuts put back: each one joins the item before it with the one after it
export function restoreCuts(items, cuts, ids) {
  const want = new Set(ids || []), join = new Set();
  for (const c of cuts || []) if (want.has(c.id)) { const i = boundaryOf(items, c); if (i > 0) join.add(i); }
  const out = [];
  for (const [i, it] of items.entries()) {
    if (join.has(i) && out.length) {
      const prev = out[out.length - 1];
      out[out.length - 1] = { ...prev, src_out: it.src_out, len: r3(Number(it.src_out) - Number(prev.src_in)) };
    } else out.push({ ...it });
  }
  return out;
}

// the items with [from, to] of source src cut out of every plain piece that plays it
export function strikeItems(items, src, from, to) {
  const out = [];
  for (const it of items) {
    if (!isPlain(it) || it.src !== src || Number(it.src_out) <= from || Number(it.src_in) >= to) { out.push(it); continue; }
    const a = Number(it.src_in), b = Number(it.src_out);
    if (from - a >= MIN_PIECE) out.push({ ...it, src_out: r3(from), len: r3(from - a) });
    if (b - to >= MIN_PIECE) {
      const right = { ...it, src_in: r3(to), len: r3(b - to), cut_before: { kind: 'other', why: 'struck in the transcript', flag: false, ask: '', by: 'you' } };
      if (it.pic_in != null) right.pic_in = r3(Number(it.pic_in) + (to - a));
      out.push(right);
    }
  }
  return out;
}

// every item's `at` from 0, back to back, and the total
export function retime(items) {
  let at = 0;
  const out = items.map((it) => { const len = Number(it.len) || 0; const x = { ...it, at: r3(at) }; at += len; return x; });
  return { items: out, total: r3(at) };
}

// the base list's own mark, so a working copy made from another rough is noticed
export const baseMark = (base) => `${base?.total ?? ''}:${(base?.items || []).length}`;

// the working edit list from the base edl.json, the cuts and the user's choices
export function workingEdl(base, cuts, choices) {
  const restored = [...new Set(choices?.restored || [])].filter((id) => (cuts || []).some((c) => c.id === id));
  const strikes = cleanStrikes(choices?.strikes);
  const blades = cleanBlades(choices?.blades), trims = cleanTrims(choices?.trims);
  let items = restoreCuts(base?.items || [], cuts, restored);
  for (const [src, from, to] of strikes) items = strikeItems(items, src, from, to);
  for (const [src, t] of blades) items = bladeItems(items, src, t);
  for (const tr of trims) items = trimItems(items, tr);
  const t = retime(items);
  const working = { base: baseMark(base), restored, strikes };
  if (blades.length) working.blades = blades;
  if (trims.length) working.trims = trims;
  return { ...base, items: t.items, total: t.total, working };
}

// ------------------------------------------------------------------ blades and trims

export const cleanBlades = (list) => [...new Map((list || [])
  .filter((b) => Array.isArray(b) && b.length === 2 && typeof b[0] === 'string' && Number.isFinite(+b[1]))
  .map(([s, t]) => [`${s}@${r3(+t)}`, [s, r3(+t)]])).values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

export const cleanTrims = (list) => (list || [])
  .filter((x) => x && typeof x.src === 'string' && (x.side === 'in' || x.side === 'out') && Number.isFinite(+x.at) && Number.isFinite(+x.to))
  .map((x) => ({ src: x.src, at: r3(+x.at), side: x.side, to: r3(+x.to) }));

// split the plain piece that plays source time t of src into two (nothing removed); the right one carries a cut marked yours
export function bladeItems(items, src, t) {
  const out = [];
  for (const it of items) {
    const a = Number(it.src_in), b = Number(it.src_out);
    if (!isPlain(it) || it.src !== src || t - a < MIN_PIECE || b - t < MIN_PIECE) { out.push(it); continue; }
    out.push({ ...it, src_out: r3(t), len: r3(t - a) });
    const right = { ...it, src_in: r3(t), len: r3(b - t), cut_before: { kind: 'other', why: 'blade', flag: false, ask: '', by: 'you' } };
    if (it.pic_in != null) right.pic_in = r3(Number(it.pic_in) + (t - a));
    out.push(right);
  }
  return out;
}

// move the out (end) or in (start) of the plain piece whose edge is at source time `at` to `to`; a piece left under MIN_PIECE stays as it was
export function trimItems(items, { src, at, side, to }) {
  const i = items.findIndex((it) => isPlain(it) && it.src === src && Math.abs(Number(side === 'out' ? it.src_out : it.src_in) - at) < EPS);
  if (i < 0) return items;
  const it = items[i], a = Number(it.src_in), b = Number(it.src_out);
  const na = side === 'in' ? to : a, nb = side === 'out' ? to : b;
  if (nb - na < MIN_PIECE) return items;
  const x = { ...it, src_in: r3(na), src_out: r3(nb), len: r3(nb - na) };
  if (side === 'in' && it.pic_in != null) x.pic_in = r3(Number(it.pic_in) + (na - a));
  if (side === 'in' && i > 0) x.cut_before = { ...(it.cut_before || { kind: 'other', why: '', flag: false, ask: '' }), trimmed: true };
  if (side === 'out' && items[i + 1]) items = items.map((y, k) => (k === i + 1 ? { ...y, cut_before: { ...(y.cut_before || { kind: 'other', why: '', flag: false, ask: '' }), trimmed: true } } : y));
  return items.map((y, k) => (k === i ? x : y));
}

// a trim set in the list: moving an edge again updates its trim (found by where the edge is now), back to where it began removes it
export function setTrim(trims, { src, at, side, to }) {
  const list = cleanTrims(trims);
  const k = list.findIndex((x) => x.src === src && x.side === side && Math.abs(x.to - at) < EPS);
  const from = k >= 0 ? list[k].at : r3(at);
  const rest = list.filter((_, j) => j !== k);
  return Math.abs(from - to) < 0.0005 ? rest : [...rest, { src, at: from, side, to: r3(to) }];
}

// strikes kept sorted, merged where they touch, and only well formed ones
export function cleanStrikes(list) {
  const ok = (list || []).filter((s) => Array.isArray(s) && s.length === 3 && typeof s[0] === 'string' && Number.isFinite(+s[1]) && Number.isFinite(+s[2]) && +s[2] > +s[1])
    .map(([s, a, b]) => [s, r3(+a), r3(+b)])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]));
  const out = [];
  for (const s of ok) {
    const last = out[out.length - 1];
    if (last && last[0] === s[0] && s[1] <= last[2] + 1e-6) last[2] = Math.max(last[2], s[2]);
    else out.push([...s]);
  }
  return out;
}

// take [from, to] of src out of the strikes again (the words come back)
export function unstrike(strikes, src, from, to) {
  const out = [];
  for (const [s, a, b] of cleanStrikes(strikes)) {
    if (s !== src || b <= from || a >= to) { out.push([s, a, b]); continue; }
    if (from - a >= MIN_PIECE) out.push([s, a, r3(from)]);
    if (b - to >= MIN_PIECE) out.push([s, r3(to), b]);
  }
  return out;
}

// the source stretch to cut for a run of struck words (words = one source's [{s, e}], first..last the run):
// from a hair before the first word to a hair before the next word, so the pause after the run goes with it
export function strikeRange(words, first, last) {
  const a = words[first], b = words[last], prev = words[first - 1], next = words[last + 1];
  const lead = prev ? Math.min(0.03, Math.max(0, (a.s - prev.e) / 2)) : 0.03;
  const from = Math.max(0, a.s - lead);
  const to = next ? next.s - Math.min(0.06, Math.max(0, (next.s - b.e) / 2)) : b.e + 0.05;
  return [r3(from), r3(Math.max(to, b.e))];
}

// the source stretches that play between edit times a and b (In to Out on the timeline), as strikes
// ps = pieces (edl-map.js); only plain played pieces count (a wait or a still is not struck this way)
export function editRangeStrikes(ps, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b), out = [];
  for (const p of ps) {
    if (p.type !== 'play' || p.end <= lo || p.at >= hi) continue;
    const from = p.in + (Math.max(lo, p.at) - p.at), to = p.in + (Math.min(hi, p.end) - p.at);
    if (to - from >= MIN_PIECE) out.push([p.media, r3(from), r3(to)]);
  }
  return out;
}
