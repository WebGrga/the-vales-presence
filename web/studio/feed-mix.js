// The feed preview, pure: which of our title + thumbnail pairs to show, and where they sit among the real videos.
// Same inputs and seed, same feed (so a reload shows the same thing); a new seed shuffles.

export function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const shown = (o) => o && !o.hidden;

// titles, thumbs: parsed option docs ({ options, picked, shortlist }) -> [{ key, title: option, thumb: option }]
export function ourPairs(titles, thumbs, max = 6) {
  const tAll = (titles?.options || []).filter(shown), hAll = (thumbs?.options || []).filter(shown);
  if (!tAll.length || !hAll.length) return [];
  const pick = (doc, all, n) => {
    const s = (doc.shortlist || []).map((id) => all.find((o) => o.id === id)).filter(Boolean);
    if (s.length) return s;
    const p = all.find((o) => o.id === doc.picked);
    return p ? [p] : all.slice(0, n);
  };
  const T = pick(titles, tAll, 2), H = pick(thumbs, hAll, 4);
  const out = [], seen = new Set();
  const add = (t, h) => { const key = `${t.id}+${h.id}`; if (!seen.has(key) && out.length < max) { seen.add(key); out.push({ key, title: t, thumb: h }); } };
  // a thumbnail made for one title goes with that title
  for (const h of H) { const t = tAll.find((x) => x.id === h.title); if (t) add(t, h); }
  for (const t of T) for (const h of H) if (!tAll.some((x) => x.id === h.title)) add(t, h);
  if (!out.length) for (const t of T) for (const h of H) add(t, h);
  return out;
}

// spread k of ours over n slots: one per equal segment, never two side by side, the first slot left to a real video
export function slotsFor(n, k, seed) {
  if (k <= 0) return [];
  if (k >= n) return [...Array(n).keys()];
  const r = rng(seed), seg = n / k, out = [];
  for (let i = 0; i < k; i++) {
    const lo = Math.max(i === 0 ? 1 : 0, Math.ceil(i * seg)), hi = Math.max(lo, Math.ceil((i + 1) * seg) - 1);
    let s = lo + Math.floor(r() * (hi - lo + 1));
    if (out.length && s <= out[out.length - 1] + 1) s = Math.min(hi, out[out.length - 1] + 2);
    out.push(Math.min(s, n - 1));
  }
  return [...new Set(out)];
}

// real: research videos; ours: ourPairs(); -> [{ kind: 'real'|'ours', ... }] of `total` tiles
export function mixFeed(real, ours, { total = 12, seed = 1 } = {}) {
  const withPic = (real || []).filter((v) => v.thumb);
  const nReal = Math.max(0, Math.min(withPic.length, total - ours.length));
  // the strongest real videos first (the competition a viewer really sees), then a seeded shuffle of the rest
  const r = rng(`${seed}:real`);
  const sorted = [...withPic].sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0) || (b.views ?? 0) - (a.views ?? 0));
  const chosen = sorted.slice(0, nReal);
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  const n = chosen.length + ours.length;
  const slots = new Set(slotsFor(n, ours.length, seed));
  const out = [];
  let ri = 0, oi = 0;
  for (let i = 0; i < n; i++) {
    if (slots.has(i) && oi < ours.length) out.push({ kind: 'ours', ...ours[oi++] });
    else if (ri < chosen.length) out.push({ kind: 'real', video: chosen[ri++] });
    else out.push({ kind: 'ours', ...ours[oi++] });
  }
  return out;
}
