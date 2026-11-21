// The edit list as the viewer and the timeline see it (pure, no DOM; tested in edl-map.test.js).
// An edit list (engine/README.md, "edl.json") is { fps, total, sources: { r1: { file, words } }, items: [...] } where an
// item is a stretch of a source (src, src_in, src_out), a sped wait (kind "W": pic_src, pic_in, pic_out, speed), a held
// still (pic_src + pic_in) or a blank card (color). A piece is one item in the words of playback:
//   { i, at, len, end, type: 'play'|'wait'|'hold'|'card', media (the source key whose file is shown), in (where it
//     starts in that file), rate (file seconds per edit second: 1, a wait's speed, 0 for a still), muted, cut }
// where cut is the item's cut_before (the cut between this piece and the one before it), if any.

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function pieceOf(it, i, at) {
  const len = Math.max(0, num(it.len, it.src ? num(it.src_out) - num(it.src_in) : 0));
  let type = 'card', media = null, start = 0, rate = 0;
  if (it.src) { type = 'play'; media = it.src; start = num(it.src_in); rate = 1; }
  else if (it.pic_src && it.pic_out != null && num(it.speed, 1) > 0) {
    type = 'wait'; media = it.pic_src; start = num(it.pic_in); rate = num(it.speed, 1);
  } else if (it.pic_src) { type = 'hold'; media = it.pic_src; start = num(it.pic_in); rate = 0; }
  return { i, at, len, end: at + len, type, media, in: start, rate, muted: type !== 'play', color: it.color || null, cut: it.cut_before || null };
}

// the pieces back to back from 0 (the items' own `at` are trusted only for order: a working list is re-timed here)
export function pieces(edl) {
  const out = []; let at = 0;
  for (const [i, it] of (edl?.items || []).entries()) { const p = pieceOf(it || {}, i, at); out.push(p); at = p.end; }
  return out;
}

export const total = (ps) => (ps.length ? ps[ps.length - 1].end : 0);

// the index of the piece that plays at edit time t (the last one at or past the end; -1 when there are none)
export function pieceAt(ps, t) {
  if (!ps.length) return -1;
  let lo = 0, hi = ps.length - 1;
  if (t >= ps[hi].at) return hi;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid].at <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

// edit time -> { i, media, time } (time in the media file)
export function toSource(ps, t) {
  const i = pieceAt(ps, t);
  if (i < 0) return null;
  const p = ps[i], dt = Math.min(Math.max(0, t - p.at), p.len);
  return { i, media: p.media, time: p.in + dt * p.rate, type: p.type };
}

// a source time -> the edit time that plays it, or null when the edit leaves it out
export function toEdit(ps, media, s) {
  for (const p of ps) {
    if (p.media !== media || p.rate <= 0) continue;
    const end = p.in + p.len * p.rate;
    if (s >= p.in - 1e-6 && s < end + 1e-6) return p.at + (Math.min(s, end) - p.in) / p.rate;
  }
  return null;
}

// the places where one piece ends and the next begins: { at, i (the piece after it), cut (its cut_before or null) }
export function edges(ps) {
  return ps.slice(1).map((p) => ({ at: p.at, i: p.i, cut: p.cut }));
}

// the edge nearest after (dir 1) or before (dir -1) t, by more than eps; null when there is none
export function nextEdge(times, t, dir, eps = 0.01) {
  const list = times.slice().sort((a, b) => a - b);
  if (dir > 0) return list.find((x) => x > t + eps) ?? null;
  for (let k = list.length - 1; k >= 0; k--) if (list[k] < t - eps) return list[k];
  return null;
}

// the file of a source key, relative to the project folder (edl paths are relative to video/)
export function sourceFile(edl, key) {
  const f = edl?.sources?.[key]?.file;
  return f ? 'video/' + String(f).replace(/\\/g, '/').replace(/^\.?\//, '') : null;
}
export function wordsFile(edl, key) {
  const f = edl?.sources?.[key]?.words;
  return f ? 'video/' + String(f).replace(/\\/g, '/').replace(/^\.?\//, '') : null;
}
