// The transcript's model (pure, no DOM; tested in words.test.js). Words come from each source's word file
// (`start<TAB>end<TAB>word` per line, engine/README.md) and, when a source has none, from rough-words.json
// ({ words: [[at, end, word, src, srcTime], ...] }, only the words the rough kept).
// Every word gets a state against the working edit list:
//   'in'     it plays (t = its edit time)            'struck' the user struck it (comes back with Unstrike)
//   'cut'    a cut of the rough removed it (cut = id; comes back with Restore)
//   'out'    the edit never used it (before the first piece, a retake left out, ...)
import { toEdit } from './edl-map.js';
import { strikeRange } from './edl-edit.js';
import { cutAtSource } from './cuts-order.js';

export function parseTsv(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const [a, b, ...w] = line.split('\t');
    const s = Number(a), e = Number(b), word = w.join(' ').trim();
    if (Number.isFinite(s) && Number.isFinite(e) && word) out.push({ s, e, w: word });
  }
  return out;
}

// source words rebuilt from rough-words.json for a source with no word file
export function fromRoughWords(rough, src) {
  const list = Array.isArray(rough?.words) ? rough.words : Array.isArray(rough) ? rough : [];
  return list.filter((x) => Array.isArray(x) && x[3] === src && Number.isFinite(Number(x[4])))
    .map(([at, end, w, , st]) => ({ s: Number(st), e: Number(st) + Math.max(0.01, Number(end) - Number(at)), w: String(w) }))
    .sort((a, b) => a.s - b.s);
}

const inStrikes = (strikes, src, t) => (strikes || []).some(([s, a, b]) => s === src && t >= a && t <= b);

// one source's words with their states: [{ k, src, s, e, w, state, t, cut }]
export function tokens(src, words, ps, cuts, strikes) {
  return (words || []).map((x, k) => {
    const mid = (x.s + x.e) / 2, te = toEdit(ps, src, mid), t = te == null ? null : Math.max(0, te - (mid - x.s)); // when the word starts
    let state = 'out', cut = null;
    if (t != null) state = 'in';
    else if (inStrikes(strikes, src, mid)) state = 'struck';
    else { const c = cutAtSource(cuts, src, mid); if (c) { state = 'cut'; cut = c.id; } }
    return { k, src, s: x.s, e: x.e, w: x.w, state, t: t == null ? null : Math.round(t * 1000) / 1000, cut };
  });
}

// the tokens in blocks for the page: long runs the edit never used fold into one line; a pause of `gap` seconds or more
// starts a new paragraph
export function blocks(toks, { foldOver = 30, gap = 1.6 } = {}) {
  const out = []; let run = [];
  const flushOut = () => {
    if (!run.length) return;
    if (run.length > foldOver) out.push({ type: 'fold', tokens: run, from: run[0].s, to: run[run.length - 1].e });
    else pushWords(run);
    run = [];
  };
  const pushWords = (list) => {
    for (const tk of list) {
      const last = out[out.length - 1];
      const prev = last?.type === 'para' ? last.tokens[last.tokens.length - 1] : null;
      if (!prev || tk.s - prev.e >= gap) out.push({ type: 'para', tokens: [tk] });
      else last.tokens.push(tk);
    }
  };
  for (const tk of toks) {
    if (tk.state === 'out') { run.push(tk); continue; }
    flushOut(); pushWords([tk]);
  }
  flushOut();
  return out;
}

// what a selection of tokens (one source, by index k) asks for:
//   strike: [[src, from, to]] for each run of playing words; unstrike: the same for struck words; restore: cut ids
export function selectionActions(toks, words, ks) {
  const sel = [...new Set(ks)].sort((a, b) => a - b).map((k) => toks[k]).filter(Boolean);
  const out = { strike: [], unstrike: [], restore: [] };
  const runs = (state) => {
    const list = sel.filter((t) => t.state === state), res = [];
    for (const t of list) { const last = res[res.length - 1]; if (last && t.k === last[1] + 1) last[1] = t.k; else res.push([t.k, t.k]); }
    return res;
  };
  for (const [a, b] of runs('in')) out.strike.push([toks[a].src, ...strikeRange(words, a, b)]);
  for (const [a, b] of runs('struck')) out.unstrike.push([toks[a].src, ...strikeRange(words, a, b)]);
  out.restore = [...new Set(sel.filter((t) => t.state === 'cut').map((t) => t.cut))];
  return out;
}

// the token playing at edit time t (the last one that started at or before it), or -1
export function tokenAt(toks, t) {
  let best = -1;
  for (const tk of toks) if (tk.t != null && tk.t <= t + 0.02) { if (best < 0 || tk.t >= toks[best].t) best = tk.k; }
  return best;
}
