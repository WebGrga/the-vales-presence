// Undo for what you pick, type or switch in the Studio and the Context tab. Before such a POST the files it can change
// are read into memory; when the POST has answered and a file really differs, the old contents wait on a short stack
// (per project for the Studio, one for the Context). POST /api/undo puts them back. Nothing in the routes needs to
// know: this wraps them (server/index.js). The rules (which request, which files, which words) are pure and tested.
import fs from 'node:fs';
import path from 'node:path';

export const MAX_STACK = 30;
export const MAX_BYTES = 6 * 1024 * 1024; // more than this under the folders and no undo is kept
const TEXT = /\.(json|md|txt|html)$/i;

// pure: does this request get an undo, and what for? -> { scope, what, root: 'studio' | 'craft' } | null
export function ruleFor(method, pathname) {
  if (method !== 'POST') return null;
  let m = /^\/api\/studio\/([a-z0-9][a-z0-9_-]*)\/(text|options|feed|upload-fields|marks|bet)$/i.exec(pathname);
  if (m) return { scope: m[1], what: m[2], root: 'studio' };
  m = /^\/api\/context\/(save|reset|skill|toggle|stage-reset|set-new|set-duplicate|set-rename|set-delete|set-default|set-use|set-reset|skill-duplicate|import)$/.exec(pathname);
  if (m) return { scope: 'context', what: m[1], root: 'craft' };
  return null;
}

const OPS = { pick: 'Picked', unpick: 'Cleared the pick of', add: 'Added', remove: 'Removed', edit: 'Edited', rename: 'Renamed', reorder: 'Reordered', regenerate: 'Regenerated' };
const CONTEXT = {
  save: 'Edited a skill or file', reset: 'Went back to the shipped version', skill: 'Made a new skill', toggle: 'Switched a skill', 'stage-reset': 'Reset the skills of a stage', 'set-new': 'Made a skill set', 'set-duplicate': 'Duplicated a skill set',
  'set-rename': 'Renamed a skill set', 'set-delete': 'Deleted a skill set', 'set-default': 'Changed the default skill set', 'set-use': 'Changed the skill set', 'set-reset': 'Put a skill set back to shipped', 'skill-duplicate': 'Duplicated a skill', import: 'Imported skills',
};
// pure: the words for the Undo button, from the rule and the body the route read: what you just did, in the past tense
export function labelFor(rule, body) {
  const b = body && typeof body === 'object' ? body : {};
  switch (rule.what) {
    case 'text': return b.name ? `Edited ${String(b.name).replace(/\.[a-z]+$/i, '').slice(0, 40)}` : 'Edited the notes';
    case 'options': { const kind = b.kind === 'thumbs' ? 'thumbnail' : 'title'; return `${OPS[b.op] || 'Changed'} a ${kind}`; }
    case 'feed': return b.picked !== undefined ? 'Picked in the feed' : 'Changed the feed';
    case 'upload-fields': return 'Changed the upload fields';
    case 'marks': return 'Changed the marks';
    case 'bet': return 'Changed your bet';
    default: return CONTEXT[rule.what] || 'Changed the context';
  }
}

// reads every text file under dir (up to the byte limit) -> Map(rel -> string) | null when there is too much
export function readTree(dir, limit = MAX_BYTES) {
  const out = new Map();
  let bytes = 0, over = false;
  const walk = (d, rel, depth) => {
    if (over || depth > 6) return;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r, depth + 1);
      else if (e.isFile() && TEXT.test(e.name)) {
        try {
          const st = fs.statSync(path.join(d, e.name));
          bytes += st.size;
          if (bytes > limit) { over = true; return; }
          out.set(r, fs.readFileSync(path.join(d, e.name), 'utf8'));
        } catch {}
      }
    }
  };
  walk(dir, '', 0);
  return over ? null : out;
}

// pure: which files differ between two readings -> { changed, created, removed } (relative names)
export function diffTrees(before, after) {
  const changed = [], created = [], removed = [];
  for (const [k, v] of after) { if (!before.has(k)) created.push(k); else if (before.get(k) !== v) changed.push(k); }
  for (const k of before.keys()) if (!after.has(k)) removed.push(k);
  return { changed, created, removed };
}

export function createUndo({ dataDir, projectDir, broadcast, now = () => Date.now() }) {
  const stacks = new Map(); // scope -> [{ label, at, dir, files: Map, diff }]
  const rootOf = (rule) => (rule.root === 'studio' ? path.join(projectDir(rule.scope), 'studio') : path.join(dataDir, 'craft'));
  const stackOf = (scope) => { if (!stacks.has(scope)) stacks.set(scope, []); return stacks.get(scope); };

  // before the handler: read what it may change -> { finish(body, status) } for after, or null
  function begin(method, pathname) {
    let rule = null;
    try { rule = ruleFor(method, pathname); } catch { rule = null; }
    if (!rule) return null;
    let dir, before;
    try { dir = rootOf(rule); before = readTree(dir); } catch { return null; }
    if (!before) return null;
    return {
      // after the answer: { scope, label, at } of the entry made, or null when nothing changed
      finish(body, status) {
        if (status >= 400) return null;
        const after = readTree(dir);
        if (!after) return null;
        const diff = diffTrees(before, after);
        if (!diff.changed.length && !diff.created.length && !diff.removed.length) return null;
        const entry = { label: labelFor(rule, body), at: now(), dir, files: before, diff, scope: rule.scope };
        const st = stackOf(rule.scope);
        st.push(entry);
        while (st.length > MAX_STACK) st.shift();
        return { scope: rule.scope, label: entry.label, at: entry.at };
      },
    };
  }

  const list = (scope) => stackOf(scope).map((e) => ({ label: e.label, at: e.at })).reverse();

  // put the last change back: the old contents written, files it made removed, files it removed made again
  function undo(scope) {
    const st = stackOf(scope);
    const e = st.pop();
    if (!e) return { error: 'nothing to undo' };
    const paths = [];
    for (const rel of [...e.diff.changed, ...e.diff.removed]) {
      const f = path.join(e.dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, e.files.get(rel));
      paths.push(rel);
    }
    for (const rel of e.diff.created) { try { fs.rmSync(path.join(e.dir, ...rel.split('/')), { force: true }); paths.push(rel); } catch {} }
    if (scope === 'context') broadcast?.({ type: 'context' });
    else broadcast?.({ type: 'studio', project: scope, paths });
    return { ok: true, label: e.label, files: paths.length };
  }

  return { begin, list, undo };
}
