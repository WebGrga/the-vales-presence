// The Context tab's words and geometry, pure (view.test.js): what each state, writer and reader is called on screen,
// the lines from a column to the shared things, and which skills a column can still switch on. No DOM here.

export const KIND = {
  claude: { icon: 'text', name: 'CLAUDE.md' },
  home: { icon: 'gear', name: 'Your Claude Code' },
  rules: { icon: 'book', name: 'House rules' },
  brief: { icon: 'note', name: 'The brief' },
  stage: { icon: 'agent', name: 'Stage instructions' },
  skill: { icon: 'sparkle', name: 'Skill' },
};

// the badge of an item: [words, class]
export function stateBadge(n) {
  if (!n) return ['', ''];
  switch (n.state) {
    case 'changed': return ['your version', 'mine'];
    case 'yours': return [n.kind === 'skill' ? 'your skill' : 'yours', 'mine'];
    case 'project': return ['this project', 'agent'];
    case 'outside': return ['outside the app', 'outside'];
    case 'missing': return [n.kind === 'brief' ? 'not written yet' : 'missing', 'missing'];
    default: return ['shipped', 'shipped'];
  }
}

const WHO = { you: 'you', agent: 'the agent', shipped: 'shipped with the app' };
export const andList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

// "Written by" in words
export function writersWords(n) {
  if (!n) return '';
  if (n.kind === 'brief') return 'the agent, at the ask stage; you can change it';
  if (n.kind === 'rules') return n.state === 'shipped' ? 'shipped as a starter; the agent adds lessons, you add your taste' : 'the agent (lessons) and you';
  if (n.kind === 'home') return 'you, in your own Claude Code setup';
  if (n.kind === 'stage') return 'shipped with the app (the stage kind and the recipe)';
  if (n.state === 'changed') return 'you (changed from the shipped version)';
  return andList((n.writers || []).map((w) => WHO[w] || w));
}

// "Read by" in words: stage titles in recipe order
export function readersWords(n, columns) {
  if (!n) return '';
  const title = (id) => columns.find((c) => c.id === id)?.title || id;
  const order = (ids) => columns.map((c) => c.id).filter((id) => ids.includes(id));
  const r = order(n.readers || []), w = order(n.writes || []);
  const parts = [];
  if (w.length) parts.push(`written at ${andList(w.map(title))}`);
  if (r.length) parts.push(r.length === columns.filter((c) => c.agent).length && r.length > 1 ? 'every agent stage' : andList(r.map(title)));
  return parts.join('; read by ') || (n.kind === 'skill' ? 'no stage of this recipe (switched off everywhere)' : 'no stage of this recipe');
}

export const words = (n) => (n === 1 ? '1 word' : `${Number(n || 0).toLocaleString('en')} words`);

// the skills a column can still switch on, by name
export function addable(column, library, nodes) {
  const on = new Set(column.skills.map((s) => s.id));
  return library.filter((id) => !on.has(id)).map((id) => ({ id, name: nodes[id]?.label || id.replace(/^skill:/, ''), description: nodes[id]?.description || '' }));
}

// a soft curve from the bottom middle of `a` to the top middle of `b` (rects relative to the canvas)
export function linePath(a, b) {
  const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
  const dy = Math.max(30, (y2 - y1) / 2);
  const r = (v) => Math.round(v * 10) / 10;
  return `M${r(x1)},${r(y1)} C${r(x1)},${r(y1 + dy)} ${r(x2)},${r(y2 - dy)} ${r(x2)},${r(y2)}`;
}

// the lines of the map: one per (column, shared thing it reads or writes)
export function lines(columns, shared) {
  const out = [];
  for (const c of columns) for (const l of c.links || []) if (shared.includes(l.to)) out.push({ from: c.id, to: l.to, how: l.how });
  return out;
}

// the text to show in the editor: the user's unsaved draft wins over the file when it is newer than this read
export function startText(node, serverDraft, localDraft) {
  const cands = [serverDraft, localDraft].filter((d) => d && typeof d.text === 'string' && d.text !== node.text);
  if (!cands.length) return { text: node.text || '', restored: false };
  const best = cands.sort((x, y) => (y.at || 0) - (x.at || 0))[0];
  return { text: best.text, restored: true, stale: best.baseMtime != null && node.mtime != null && best.baseMtime !== node.mtime };
}

// a lesson's counts in words
export function lessonCounts(l) {
  const k = `held up ${l.kept}×`, a = `went against ${l.against}×`;
  return l.review ? `${k}, ${a}: up for review` : `${k}, ${a}`;
}
