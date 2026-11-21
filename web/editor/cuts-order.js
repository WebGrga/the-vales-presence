// The Cuts list's decisions (pure, no DOM; tested in cuts-order.test.js): the order and groups of the cuts, the count
// line, and the plain words that go into the notes when the rough is sent back.
// review = { c3: { keep: true|false, note } }: keep true = Keep (stays cut), false = Restore (comes back), none = undecided.

export const byTime = (a, b) => (Number(a.at) || 0) - (Number(b.at) || 0);

// the flagged ones first ("For you"), then the others; the small unflagged pauses in a group of their own; each in time order
export function groupCuts(cuts) {
  const all = (Array.isArray(cuts) ? cuts : []).filter((c) => c && c.id).slice().sort(byTime);
  return {
    flagged: all.filter((c) => c.flag),
    others: all.filter((c) => !c.flag && c.kind !== 'pause'),
    pauses: all.filter((c) => !c.flag && c.kind === 'pause'),
  };
}

// every cut in the order the list shows them (what ↑/↓ walk through)
export const listOrder = (g) => [...g.flagged, ...g.others, ...g.pauses];

// the next or previous cut in list order from the current id (the first one when nothing is current)
export function stepCut(order, curId, dir) {
  if (!order.length) return null;
  const i = order.findIndex((c) => c.id === curId);
  if (i < 0) return order[dir < 0 ? order.length - 1 : 0];
  return order[Math.max(0, Math.min(order.length - 1, i + dir))];
}

export const restoredIds = (cuts, review) => (cuts || []).filter((c) => review?.[c.id]?.keep === false).sort(byTime).map((c) => c.id);

// "34 cuts · 3 flagged · 2 kept · 1 to restore · 1 noted"
export function countLine(cuts, review) {
  const list = cuts || [], n = list.length, parts = [`${n} cut${n === 1 ? '' : 's'}`];
  const count = (f) => list.filter(f).length;
  const flagged = count((c) => c.flag), kept = count((c) => review?.[c.id]?.keep === true);
  const back = count((c) => review?.[c.id]?.keep === false), noted = count((c) => String(review?.[c.id]?.note || '').trim());
  if (flagged) parts.push(`${flagged} flagged`);
  if (kept) parts.push(`${kept} kept`);
  if (back) parts.push(`${back} to restore`);
  if (noted) parts.push(`${noted} noted`);
  return parts.join(' · ');
}

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// the user's choices in plain words: Restore c3 ("so the thing is"); c7: keep the pause here
export function choicesText(cuts, review) {
  const lines = [];
  for (const c of (cuts || []).slice().sort(byTime)) {
    const r = review?.[c.id]; if (!r) continue;
    const note = oneLine(r.note), words = oneLine(c.removed);
    if (r.keep === false) lines.push(`Restore ${c.id}${words ? ` ("${clip(words)}")` : ''}${note ? `: ${note}` : ''}`);
    else if (note) lines.push(`${c.id}: ${note}`);
  }
  return lines.join('; ');
}

// what was typed, then the choices on the cuts and the struck words; nothing added when there are none
export function notesWithChoices(typed, cuts, review, strikes) {
  const t = String(typed || '').trim(), parts = [];
  const c = choicesText(cuts, review);
  if (c) parts.push(`On the cuts: ${c}.`);
  const n = (strikes || []).length;
  if (n) parts.push(`I struck ${n} more stretch${n === 1 ? '' : 'es'} in the transcript (in video/out/edl.working.json).`);
  return [t, ...parts].filter(Boolean).join('\n\n');
}

// the cut that holds a source time (the one whose removed stretch covers it), or null
export function cutAtSource(cuts, src, s) {
  return (cuts || []).find((c) => !c.jump && c.src === src && s >= Number(c.from) && s <= Number(c.to)) || null;
}
