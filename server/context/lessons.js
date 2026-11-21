// The Lessons of the house rules book, pure (lessons.test.js). A lesson is one top-level list item under "## Lessons"
// ending with its meta in italics:  - The rule. _(2026-11-20; evidence: what happened; kept 1, against 0)_
// parseLessons reads them, bump adds one to kept or against, toReview lists the ones judged wrong more than kept.

const META = /\s*_\(([^)]*)\)_\s*$/;
const ITEM = /^( ?)(?:[-*+]|\d+[.)])\s+(.*)$/;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

// [start, end) of the lines inside the "## Lessons" section
function section(lines) {
  const a = lines.findIndex((l) => /^##\s+lessons\b/i.test(l.trim()));
  if (a < 0) return null;
  let z = lines.findIndex((l, i) => i > a && /^#{1,2}\s/.test(l.trim()));
  if (z < 0) z = lines.length;
  return [a + 1, z];
}

const num = (meta, word) => Number((meta.match(new RegExp(word + '\\s*:?\\s*(\\d+)', 'i')) || [])[1] || 0);
const clean = (t) => t.replace(META, '').replace(/\*\*/g, '').trim();

export function parseLessons(md) {
  const lines = String(md ?? '').split(/\r?\n/), sec = section(lines);
  if (!sec) return [];
  const out = [];
  for (let i = sec[0]; i < sec[1]; i++) {
    const m = lines[i].match(ITEM);
    if (!m) continue;
    const meta = (m[2].match(META) || [])[1] || '';
    const parts = meta.split(';').map((p) => p.trim()).filter(Boolean);
    const evidence = (parts.find((p) => /^evidence\s*:/i.test(p)) || '').replace(/^evidence\s*:\s*/i, '');
    out.push({
      id: 'L' + (out.length + 1), line: i, text: clean(m[2]),
      date: (meta.match(DATE) || [])[1] || '', evidence,
      kept: num(meta, 'kept'), against: num(meta, 'against'),
    });
  }
  for (const l of out) l.review = needsReview(l);
  return out;
}

export const needsReview = (l) => l.against >= 2 && l.against > l.kept;
export const toReview = (list) => list.filter(needsReview);

// add one to `field` (kept|against) of the lesson with this id; the rest of the file is left byte for byte
export function bump(md, id, field) {
  if (!['kept', 'against'].includes(field)) return { error: 'a lesson is counted as kept or against' };
  const text = String(md ?? ''), eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/), l = parseLessons(text).find((x) => x.id === id);
  if (!l) return { error: 'that lesson is not in the book any more: reload' };
  const c = { kept: l.kept, against: l.against };
  c[field]++;
  const raw = lines[l.line], meta = (raw.match(META) || [])[1];
  const keep = String(meta || '').split(';').map((p) => p.trim()).filter((p) => p && !/^(kept|against)\b/i.test(p));
  if (!meta && !l.date) keep.unshift(new Date().toISOString().slice(0, 10));
  lines[l.line] = raw.replace(META, '').replace(/\s+$/, '') + ` _(${[...keep, `kept ${c.kept}, against ${c.against}`].join('; ')})_`;
  return { md: lines.join(eol), lesson: { ...l, ...c, review: needsReview(c) } };
}

// the lessons as one block of text (for a stage prompt that wants them apart from the book)
export function lessonsText(list) {
  return list.map((l) => `- ${l.id}: ${l.text}${l.date ? ` (${l.date})` : ''} [kept ${l.kept}, against ${l.against}]`).join('\n');
}
