// The Settings tab's pure parts: what each setting says about itself, the form's values, and what has changed.
// No DOM here, so web/settings/form.test.js can run it in node.
export const FIELDS = [
  { key: 'model', label: 'Model', kind: 'select',
    help: 'The Claude model every agent stage and chat uses. Takes effect the next time an open session is given work.' },
  { key: 'effort', label: 'Effort', kind: 'select',
    help: 'How hard the model thinks. Higher is slower and uses more of your subscription. Takes effect the next time an open session is given work.' },
  { key: 'permissionMode', label: 'Permission mode', kind: 'select',
    help: 'How the unattended agent may use tools. Auto lets Claude Code decide what is safe; accept edits allows only Bash, Read, Write, Edit, Glob, Grep, WebSearch and WebFetch. Either way a tool that would need your click is refused with a reason. Takes effect when a new session starts: after about 55 minutes without a turn, or a fresh conversation.' },
  { key: 'chain', label: 'Run stages on by themselves', kind: 'toggle',
    help: 'On: agent stages follow one another until a stage needs you. Off: you press Go on every agent stage. Takes effect at once.' },
  { key: 'heavy', label: 'Renders at once', kind: 'number', min: 1, max: 8, unit: 'renders',
    help: 'How many render stages (the rough cut, the visuals, cutting Shorts) run at the same time across all projects. The others wait in line. A whole number from 1 to 8. Takes effect at once.' },
  { key: 'quietMinutes', label: 'Report a quiet stage after', kind: 'number', min: 0, max: 240, unit: 'minutes',
    help: 'A stage with no output for this long is reported to you once as possibly stuck, and keeps running. 0 never reports. A whole number from 0 to 240. Takes effect at once.' },
];
export const MODE_NAMES = { auto: 'Auto (Claude Code decides what is safe)', acceptEdits: 'Accept edits (a fixed list of tools)' };
export const EFFORT_NAMES = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

// the choices of a select field from what GET /api/agent/settings sent; a value kept in the file that is not in the list stays choosable
export function optionsFor(key, meta, current) {
  let list = [];
  if (key === 'model') list = (meta.models || []).map((m) => ({ value: m.value, label: `${m.name}: ${m.about}` }));
  else if (key === 'effort') list = (meta.efforts || []).map((v) => ({ value: v, label: EFFORT_NAMES[v] || v }));
  else if (key === 'permissionMode') list = (meta.modes || []).map((v) => ({ value: v, label: MODE_NAMES[v] || v }));
  if (current != null && !list.some((o) => o.value === current)) list.push({ value: current, label: `${current} (your own)` });
  return list;
}

// form values (strings and booleans as the controls hold them) -> the patch for POST /api/agent/settings, only what differs from saved
export function patchFrom(values, saved) {
  const patch = {};
  for (const f of FIELDS) {
    const v = values[f.key];
    if (v === undefined) continue;
    const out = f.kind === 'number' ? (String(v).trim() === '' ? NaN : Number(v)) : v;
    if (out !== saved[f.key]) patch[f.key] = out;
  }
  return patch;
}
// the saved settings as form values
export const valuesOf = (s) => Object.fromEntries(FIELDS.map((f) => [f.key, f.kind === 'number' ? String(s[f.key] ?? '') : s[f.key]]));
// which fields the typed values change
export const changedKeys = (values, saved) => Object.keys(patchFrom(values, saved));
