// Undo and redo over snapshots of the user's choices (pure; tested in history.test.js). A snapshot is any plain value
// (the editor keeps { review, strikes }). push() is called with the state BEFORE a change.

export const emptyHistory = () => ({ past: [], future: [] });

export function push(h, before, limit = 200) {
  const past = [...h.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

// -> { h, state } with state the snapshot to go back to, or null when there is nothing to undo
export function undo(h, current) {
  if (!h.past.length) return { h, state: null };
  return { h: { past: h.past.slice(0, -1), future: [current, ...h.future] }, state: h.past[h.past.length - 1] };
}

export function redo(h, current) {
  if (!h.future.length) return { h, state: null };
  return { h: { past: [...h.past, current], future: h.future.slice(1) }, state: h.future[0] };
}
