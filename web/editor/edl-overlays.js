// The overlays as the editor shows and edits them (pure, no DOM; tested in edl-overlays.test.js). The visuals stage writes
// video/out/events.json; your changes sit beside it and the engine applies them on every render (engine/user_edits.py, the same rules):
//   video/out/event-edits.json  { version: 1, edits: { <id>: { at?, end?, text?, props?, hide? } } }   the overlay inspector
//   video/out/redactions.json   { version: 1, boxes: [{ id, at, end, x, y, w, h, mode }] }           blur boxes drawn in the viewer
// Times there are seconds of the rough (edl.json); the timeline shows the working list, so times go through the base pieces.
import { toSource, toEdit } from './edl-map.js';

export const PAD = 0.5, MERGE_GAP = 1.0, CHUNK = 15;
const r3 = (x) => Math.round(x * 1000) / 1000;

// events.json's events with your edits on top (hidden ones left out); each edited one says so in `edited`
export function applyEdits(events, edits) {
  const table = edits?.edits && typeof edits.edits === 'object' ? edits.edits : {};
  const out = [];
  for (const e of events || []) {
    const ed = table[e.id];
    if (!ed) { out.push(e); continue; }
    if (ed.hide === true) continue;
    const x = { ...e, edited: true };
    if (Number.isFinite(ed.at)) x.at = ed.at;
    if (Number.isFinite(ed.end)) x.end = ed.end;
    if (typeof ed.text === 'string') x.text = ed.text;
    if (ed.props && typeof ed.props === 'object') x.props = { ...(e.props || {}), ...ed.props };
    out.push(x);
  }
  return out;
}

// redactions.json's boxes as blur events (the ids the engine gives them)
export const boxEvents = (red) => (Array.isArray(red?.boxes) ? red.boxes : [])
  .map((b) => ({ id: `user-${b.id}`, box: b.id, kind: 'blur', at: b.at, end: b.end, mode: b.mode || 'blur', what: b.note || 'your blur box', mine: true }));

// who draws an event (engine/events.py drawn_by)
export function drawnBy(e) {
  if (e.render === false) return null;
  if (e.kind === 'zoom' || e.kind === 'blur') return 'ffmpeg';
  if (e.kind === 'caption') return 'ass';
  return e.comp ? 'remotion' : null;
}

// the Remotion windows (engine/windows.py plan): [{ start, end, ids }]
export function windowsOf(events, duration = Infinity) {
  const evs = (events || []).filter((e) => drawnBy(e) === 'remotion').sort((a, b) => a.at - b.at);
  const groups = [];
  for (const e of evs) {
    const g = groups[groups.length - 1];
    if (g && e.at - g.end < MERGE_GAP) { g.end = Math.max(g.end, e.end); g.ids.push(e.id); } else groups.push({ start: e.at, end: e.end, ids: [e.id] });
  }
  return groups.map((g) => ({ start: r3(Math.max(0, g.start - PAD)), end: r3(Math.min(duration, g.end + PAD)), ids: g.ids }));
}

// what a change to this event makes the engine do again, in words
export function reRenderNote(events, id, duration = Infinity) {
  const e = (events || []).find((x) => x.id === id);
  if (!e) return '';
  const by = drawnBy(e);
  const chunks = (a, b) => Math.max(1, Math.floor((b - 1e-6) / CHUNK) - Math.floor(a / CHUNK) + 1);
  const fmt = (x) => x.toFixed(1);
  if (by === 'remotion') {
    const ws = windowsOf(events, duration);
    const w = ws.find((x) => x.ids.includes(id));
    if (!w) return '';
    const n = chunks(w.start, w.end);
    return `Only this window is drawn again: ${fmt(w.start)}–${fmt(w.end)} s (1 of ${ws.length}${w.ids.length > 1 ? `, with ${w.ids.filter((x) => x !== id).join(', ')}` : ''}), and about ${n} chunk${n > 1 ? 's' : ''} of the final.`;
  }
  if (by === 'ffmpeg' || by === 'ass') {
    const n = chunks(e.at, e.end);
    return `Nothing is drawn by Remotion: ffmpeg puts it on in the compose pass, so only about ${n} chunk${n > 1 ? 's' : ''} of the final (${fmt(e.at)}–${fmt(e.end)} s) are encoded again.`;
  }
  return 'This one is not drawn by the engine (it is in the rough already).';
}

// rough (base) time -> working time, and back; null when the working list leaves that moment out
export function baseToWorking(basePs, ps, t) {
  const s = toSource(basePs, t);
  return s && s.media ? toEdit(ps, s.media, s.time) : null;
}
export function workingToBase(basePs, ps, t) {
  const s = toSource(ps, t);
  return s && s.media ? toEdit(basePs, s.media, s.time) : null;
}

// the text an inspector edits: props.text when the component has one, else the event's own text
export const textOf = (e) => (typeof e?.props?.text === 'string' ? e.props.text : typeof e?.text === 'string' ? e.text : '');

// one event's edit from the inspector's fields, against the event as events.json has it -> the entry for event-edits.json (null: no change)
export function editFor(orig, fields) {
  const ed = {};
  if (Number.isFinite(fields.at) && Math.abs(fields.at - orig.at) > 0.0005) ed.at = r3(fields.at);
  if (Number.isFinite(fields.end) && Math.abs(fields.end - orig.end) > 0.0005) ed.end = r3(fields.end);
  const props = {};
  for (const [k, v] of Object.entries(fields.props || {})) if ((orig.props || {})[k] !== v) props[k] = v;
  if (typeof fields.text === 'string' && fields.text !== textOf(orig)) {
    if (typeof orig.props?.text === 'string') props.text = fields.text;
    ed.text = fields.text;
  }
  if (Object.keys(props).length) ed.props = props;
  if (fields.hide) ed.hide = true;
  return Object.keys(ed).length ? ed : null;
}

// event-edits.json with one event's edit set (or removed with null)
export function setEdit(edits, id, ed) {
  const table = { ...(edits?.edits || {}) };
  if (ed) table[id] = ed; else delete table[id];
  return { version: 1, edits: table };
}
