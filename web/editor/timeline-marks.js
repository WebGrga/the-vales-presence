// Markers on the timeline's ruler (pure, no DOM; tested in timeline-marks.test.js): the review items the stages write for you
// (GET /api/projects/:id/review-items, server/review-items.js: the agent's "listen to this", Inspect's "for you", with your done
// marks; else video/out/review-items.json itself) and the flagged cuts. A click on one seeks to it.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const first = (...xs) => xs.find((x) => typeof x === 'string' && x.trim()) || '';

// review-items.json in any of the shapes it may take -> [{ id, at, end, text, kind }] in rough seconds
export function readItems(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
  const out = [];
  list.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const at = num(x.at ?? x.t ?? x.time ?? x.start);
    if (at == null) return;
    const end = num(x.end ?? x.to);
    const title = first(x.title, x.label);
    const body = first(x.text, x.note, x.what, x.why, x.ask);
    out.push({ id: String(x.id ?? `r${i + 1}`), at, end: end != null && end > at ? end : null, text: [title, body].filter(Boolean).join(': ') || 'Look here', kind: first(x.kind) || 'review', source: first(x.source, x.from, x.stage), done: x.done === true || x.resolved === true || x.mark?.done === true });
  });
  return out.sort((a, b) => a.at - b.at);
}

// every marker on the working timeline: review items (mapped by `move`, rough -> working time) and flagged cuts (at their mark)
// cutAt(cut) -> the working time of a cut's mark, or null
export function markers(items, cuts, move, cutAt) {
  const out = [];
  for (const it of items || []) {
    const t = move(it.at);
    if (t == null) continue;
    const e = it.end != null ? move(it.end) : null;
    out.push({ id: it.id, t, end: e != null && e > t ? e : null, kind: it.done ? 'done' : it.kind === 'private' ? 'private' : 'review', text: it.text, from: [it.kind !== 'review' ? it.kind : '', it.source].filter(Boolean).join(' · ') });
  }
  for (const c of cuts || []) {
    if (c.flag !== true) continue;
    const t = cutAt(c);
    if (t == null) continue;
    out.push({ id: c.id, t, end: null, kind: 'flag', text: `${c.id} · flagged ${c.kind || 'cut'}: ${first(c.ask, c.why) || 'a judgment call for you'}`, from: 'cuts', cut: c.id });
  }
  return out.sort((a, b) => a.t - b.t);
}

// the marker under x (pixels) on the ruler, within tol pixels; X(t) -> pixels
export function markerAt(list, x, X, tol = 6) {
  let best = null, d = tol;
  for (const m of list) { const dx = Math.abs(X(m.t) - x); if (dx <= d) { best = m; d = dx; } }
  return best;
}

// the tooltip of a marker
export const tipOf = (m, fmt) => `${fmt(m.t)}${m.end != null ? `–${fmt(m.end)}` : ''} · ${m.text}${m.from && m.kind !== 'flag' ? ` (${m.from}${m.kind === 'done' ? ', done' : ''})` : ''}`;
