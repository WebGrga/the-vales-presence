// The agent's questions answered as one set (pure, no DOM; tested in agent-ask.test.js). Every question gets its
// picks (one, or several where the question allows it) and an own answer, and one Send sends them all:
// { [question text]: "Label, Other label, own words" }, the shape the agent's AskUserQuestion takes.

export const NO_ANSWER = 'No answer from me: use your judgment.';

// a stable key for one set of questions (drafts of the picks are kept under it)
export function questionKey(questions) {
  const s = (questions || []).map((q) => String(q?.question || '')).join('\n');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const labelOf = (o) => String(o?.label ?? o ?? '');
export const isMulti = (q) => !!(q?.multiSelect ?? q?.multi_select ?? q?.multiple);

// a click on an option: multi-select questions toggle it; single ones take it (a second click clears it)
export function toggle(state, qi, label, multi) {
  const picks = { ...(state?.picks || {}) };
  const now = picks[qi] || [];
  if (multi) picks[qi] = now.includes(label) ? now.filter((x) => x !== label) : [...now, label];
  else picks[qi] = now.length === 1 && now[0] === label ? [] : [label];
  return { ...state, picks };
}
export const setOwn = (state, qi, text) => ({ ...state, own: { ...(state?.own || {}), [qi]: String(text ?? '') } });

// is question qi answered (a pick or own words)?
export const answered = (state, qi) => (state?.picks?.[qi] || []).length > 0 || !!String(state?.own?.[qi] || '').trim();

export function progress(questions, state) {
  const n = (questions || []).length;
  const done = (questions || []).filter((_, i) => answered(state, i)).length;
  return { n, done, all: n > 0 && done === n, any: done > 0 };
}

// the answers the agent gets: picks in the order the options were offered, then the own words
export function answersOf(questions, state) {
  const out = {};
  (questions || []).forEach((q, i) => {
    const order = (q.options || []).map(labelOf);
    const picks = [...(state?.picks?.[i] || [])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const own = String(state?.own?.[i] || '').trim();
    const parts = [...picks, own].filter(Boolean);
    out[String(q.question || `Question ${i + 1}`)] = parts.length ? parts.join(', ') : NO_ANSWER;
  });
  return out;
}

// the Send button's words
export function sendLabel(questions, state) {
  const p = progress(questions, state);
  if (p.n <= 1) return 'Send answer';
  return p.all ? 'Send answers' : `Send answers (${p.done} of ${p.n})`;
}
