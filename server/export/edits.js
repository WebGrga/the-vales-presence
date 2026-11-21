// Your edits of the visuals, kept beside the agent's events.json and applied by the engine on every render (engine/user_edits.py):
//   video/out/redactions.json   { version: 1, boxes: [{ id, at, end, x, y, w, h, mode, note? }] }   blur boxes drawn in the viewer
//   video/out/event-edits.json  { version: 1, edits: { <event id>: { at?, end?, text?, props?, hide? } } } the overlay inspector
// Times are seconds of the rough, boxes are the rough's pixels. The cleaners are pure (tested in edits.test.js); readEdits / saveEdits touch the files.
import fs from 'node:fs';
import path from 'node:path';

export const FILES = { redactions: 'redactions.json', 'event-edits': 'event-edits.json' };
const MODES = ['blur', 'pixelate', 'fill'];
const r3 = (x) => Math.round(Number(x) * 1000) / 1000;
const fin = (x) => typeof x === 'number' && Number.isFinite(x);

// frame = { width, height, duration } of the rough (null fields are not checked)
export function cleanRedactions(data, frame = {}) {
  const list = Array.isArray(data?.boxes) ? data.boxes : Array.isArray(data) ? data : null;
  if (!list) return { error: 'send { boxes: [...] }' };
  if (list.length > 500) return { error: 'too many boxes' };
  const W = frame.width || Infinity, H = frame.height || Infinity, D = frame.duration || Infinity;
  const out = [], ids = new Set();
  for (const b of list) {
    if (!b || typeof b !== 'object') return { error: 'every box is an object' };
    const id = String(b.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) return { error: `a box needs a short id (letters, digits, - and _): "${id}"` };
    if (ids.has(id)) return { error: `the id ${id} is used twice` };
    ids.add(id);
    for (const k of ['at', 'end', 'x', 'y', 'w', 'h']) if (!fin(b[k])) return { error: `${id}: ${k} must be a number` };
    let x = Math.max(0, b.x), y = Math.max(0, b.y);
    const w = Math.min(W, b.x + b.w) - x, h = Math.min(H, b.y + b.h) - y;
    if (w < 2 || h < 2) return { error: `${id}: the box is outside the frame or too small` };
    const at = Math.max(0, b.at), end = Math.min(D, b.end);
    if (end - at < 0.04) return { error: `${id}: it ends before it starts` };
    const e = { id, at: r3(at), end: r3(end), x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), mode: MODES.includes(b.mode) ? b.mode : 'blur' };
    if (typeof b.note === 'string' && b.note.trim()) e.note = b.note.trim().slice(0, 200);
    if (fin(b.strength) && b.strength > 0) e.strength = Math.round(b.strength);
    if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) e.color = b.color;
    out.push(e);
  }
  out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return { data: { version: 1, boxes: out } };
}

// ids = the events that exist (null: not checked); an edit with nothing in it is dropped
export function cleanEventEdits(data, ids = null, duration = null) {
  const table = data?.edits && typeof data.edits === 'object' && !Array.isArray(data.edits) ? data.edits : null;
  if (!table) return { error: 'send { edits: { <event id>: {...} } }' };
  const out = {};
  for (const [id, ed] of Object.entries(table)) {
    if (ids && !ids.includes(id)) return { error: `there is no event ${id}` };
    if (!ed || typeof ed !== 'object') continue;
    const e = {};
    if (fin(ed.at)) e.at = r3(Math.max(0, ed.at));
    if (fin(ed.end)) e.end = r3(duration ? Math.min(duration, ed.end) : ed.end);
    if (e.at != null && e.end != null && e.end - e.at < 0.1) return { error: `${id}: it must last at least 0.1 s` };
    if (typeof ed.text === 'string') e.text = ed.text.slice(0, 500);
    if (ed.props && typeof ed.props === 'object' && !Array.isArray(ed.props)) {
      const s = JSON.stringify(ed.props);
      if (s.length > 20000) return { error: `${id}: props are too big` };
      e.props = JSON.parse(s);
    }
    if (ed.hide === true) e.hide = true;
    if (Object.keys(e).length) out[id] = e;
  }
  return { data: { version: 1, edits: out } };
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const outDir = (dir) => path.join(dir, 'video', 'out');

export function readEdits(dir) {
  return { redactions: readJson(path.join(outDir(dir), FILES.redactions)), eventEdits: readJson(path.join(outDir(dir), FILES['event-edits'])) };
}

// -> { file (relative to the project), data } | throws with .status
export function saveEdits(dir, which, data) {
  const name = FILES[which];
  if (!name) throw Object.assign(new Error(`file must be one of ${Object.keys(FILES).join(', ')}`), { status: 400 });
  const out = outDir(dir);
  const rough = readJson(path.join(out, 'rough.json')) || {};
  const events = readJson(path.join(out, 'events.json'));
  const r = which === 'redactions'
    ? cleanRedactions(data, { width: rough.width, height: rough.height, duration: rough.duration })
    : cleanEventEdits(data, Array.isArray(events?.events) ? events.events.map((e) => e.id) : null, rough.duration || null);
  if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
  const file = path.join(out, name);
  fs.mkdirSync(out, { recursive: true });
  const empty = which === 'redactions' ? !r.data.boxes.length : !Object.keys(r.data.edits).length;
  if (empty) fs.rmSync(file, { force: true });
  else { const tmp = file + '.part'; fs.writeFileSync(tmp, JSON.stringify(r.data, null, 1) + '\n'); fs.renameSync(tmp, file); }
  return { file: `video/out/${name}`, data: empty ? null : r.data };
}
