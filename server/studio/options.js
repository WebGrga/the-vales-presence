// Title and thumbnail options, pure: read the agent's file, apply the user's pick, edit, star, note or hide.
// studio/titles.json        { options: [{ id, title, family?, why?, by?, original?, hidden? }], picked, shortlist: [ids], notes: {id: text} }
// studio/thumbs/options.json { options: [{ id, file, how: code|ai|mixed, title?, model?, prompt?, spec?, why?, hidden? }], picked, shortlist, notes }
// The agent writes options; the user's choices (picked, shortlist, notes, edits, hidden) survive the agent adding more.

const str = (v, n = 300) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '');
const HOW = ['code', 'ai', 'mixed'];
const safeFile = (f) => { const s = str(f, 200).replace(/\\/g, '/'); return s && !s.split('/').some((p) => p === '..' || p === '') && !/^[a-z]:/i.test(s) ? s : ''; };

function cleanOption(x, kind, i) {
  if (!x || typeof x !== 'object') return null;
  const id = str(x.id, 40) || `${kind === 'titles' ? 't' : 'th'}${i + 1}`;
  const o = { id };
  if (kind === 'titles') {
    o.title = str(x.title, 200);
    if (!o.title) return null;
    for (const k of ['family', 'why', 'by', 'original', 'premise', 'promise']) if (str(x[k])) o[k] = str(x[k], 1000);
    if (Number.isFinite(Number(x.score)) && x.score !== null && x.score !== '') o.score = Math.round(Number(x.score) * 10) / 10;
  } else {
    o.file = safeFile(x.file);
    if (!o.file) return null;
    o.how = HOW.includes(x.how) ? x.how : 'code';
    for (const k of ['title', 'model', 'prompt', 'spec', 'why', 'text', 'promise', 'sheet160', 'clarity']) if (str(x[k])) o[k] = str(x[k], 2000);
  }
  if (x.hidden === true) o.hidden = true;
  return o;
}

// the premise + title lines the Titles stage judged as text: [{ premise, title, score, clear, failed }]
export function cleanLines(list) {
  return (Array.isArray(list) ? list : []).slice(0, 80).map((l) => {
    if (!l || typeof l !== 'object' || !str(l.title, 200)) return null;
    const o = { title: str(l.title, 200), premise: str(l.premise, 300) };
    if (l.score !== undefined && l.score !== null && l.score !== '' && Number.isFinite(Number(l.score))) o.score = Math.round(Number(l.score) * 10) / 10;
    if (l.clear === false) o.clear = false;
    if (str(l.failed, 300)) o.failed = str(l.failed, 300);
    return o;
  }).filter(Boolean);
}

export function parseOptions(obj, kind) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const list = Array.isArray(src) ? src : Array.isArray(src.options) ? src.options : [];
  const seen = new Set(), options = [];
  list.forEach((x, i) => { const o = cleanOption(x, kind, i); if (o && !seen.has(o.id)) { seen.add(o.id); options.push(o); } });
  const ids = new Set(options.map((o) => o.id));
  const picked = ids.has(src.picked) ? src.picked : null;
  const shortlist = (Array.isArray(src.shortlist) ? src.shortlist : []).filter((id) => ids.has(id));
  const notes = {};
  if (src.notes && typeof src.notes === 'object') for (const [k, v] of Object.entries(src.notes)) if (ids.has(k) && str(v)) notes[k] = str(v, 4000);
  const out = { options, picked, shortlist: [...new Set(shortlist)], notes };
  for (const k of ['about', 'brief']) if (str(src[k])) out[k] = str(src[k], 4000);
  if (kind === 'titles') {
    if (src.gate !== undefined && src.gate !== null && src.gate !== '' && Number.isFinite(Number(src.gate))) out.gate = Math.round(Number(src.gate) * 10) / 10;
    out.lines = cleanLines(src.lines);
  }
  return out;
}

const nextId = (options, prefix) => { let n = 1; const ids = new Set(options.map((o) => o.id)); while (ids.has(prefix + n)) n++; return prefix + n; };

// op: { op: 'pick'|'unpick'|'star'|'note'|'edit'|'add'|'hide'|'show', id?, text? } -> { doc } | { error }
export function applyOp(doc, op, kind) {
  const d = parseOptions(doc, kind);
  const o = d.options.find((x) => x.id === op?.id);
  const need = () => (o ? null : { error: `No option "${str(op?.id, 40)}".` });
  switch (op?.op) {
    case 'pick': { const e = need(); if (e) return e; d.picked = o.id; delete o.hidden; if (!d.shortlist.includes(o.id)) d.shortlist.push(o.id); return { doc: d }; }
    case 'unpick': d.picked = null; return { doc: d };
    case 'star': {
      const e = need(); if (e) return e;
      d.shortlist = d.shortlist.includes(o.id) ? d.shortlist.filter((x) => x !== o.id) : [...d.shortlist, o.id];
      return { doc: d };
    }
    case 'note': { const e = need(); if (e) return e; const t = str(op.text, 4000); if (t) d.notes[o.id] = t; else delete d.notes[o.id]; return { doc: d }; }
    case 'hide': { const e = need(); if (e) return e; o.hidden = true; if (d.picked === o.id) d.picked = null; d.shortlist = d.shortlist.filter((x) => x !== o.id); return { doc: d }; }
    case 'show': { const e = need(); if (e) return e; delete o.hidden; return { doc: d }; }
    case 'edit': {
      if (kind !== 'titles') return { error: 'Only titles are edited as text.' };
      const e = need(); if (e) return e;
      const t = str(op.text, 200);
      if (!t) return { error: 'A title cannot be empty.' };
      if (t !== o.title) { if (!o.original) o.original = o.title; o.title = t; if (o.original === t) delete o.original; }
      return { doc: d };
    }
    case 'add': {
      if (kind !== 'titles') return { error: 'Thumbnails are added by the agent or as files.' };
      const t = str(op.text, 200);
      if (!t) return { error: 'A title cannot be empty.' };
      const id = nextId(d.options, 'u');
      d.options.push({ id, title: t, by: 'you' });
      return { doc: d, id };
    }
    default: return { error: `Unknown change "${str(op?.op, 20)}".` };
  }
}

// The user's side of a file, kept apart in studio/choices.json so an agent rewriting titles.json loses none of it.
export function choicesOf(doc, kind) {
  const d = parseOptions(doc, kind);
  const edits = {};
  for (const o of d.options) if (o.original) edits[o.id] = { title: o.title, original: o.original };
  return {
    picked: d.picked, shortlist: d.shortlist, notes: d.notes, edits,
    hidden: d.options.filter((o) => o.hidden).map((o) => o.id),
    added: d.options.filter((o) => o.by === 'you'),
  };
}

// the agent's file with the user's choices laid over it: the user's words and picks always win
export function withChoices(doc, ch, kind) {
  const d = parseOptions(doc, kind);
  if (!ch || typeof ch !== 'object') return d;
  for (const a of Array.isArray(ch.added) ? ch.added : []) {
    const o = cleanOption(a, kind, 0);
    if (o && !d.options.some((x) => x.id === o.id)) d.options.push({ ...o, by: 'you' });
  }
  const ids = new Set(d.options.map((o) => o.id));
  for (const o of d.options) {
    const e = ch.edits?.[o.id];
    if (kind === 'titles' && e && str(e.title) && o.by !== 'you') { if (o.title !== e.title) { o.original = o.original || str(e.original, 200) || o.title; o.title = str(e.title, 200); } }
    if ((ch.hidden || []).includes(o.id)) o.hidden = true;
  }
  if (ids.has(ch.picked)) d.picked = ch.picked;
  d.shortlist = [...new Set([...(ch.shortlist || []).filter((id) => ids.has(id)), ...d.shortlist])];
  for (const [k, v] of Object.entries(ch.notes || {})) if (ids.has(k) && str(v)) d.notes[k] = str(v, 4000);
  return d;
}

export const visible = (d) => d.options.filter((o) => !o.hidden);
