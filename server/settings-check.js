// Checking a settings change before it is kept (POST /api/agent/settings). Pure: data in, data out.
// checkSettings(patch) -> { patch } with only the known keys, in their proper types | { error } saying plainly what is wrong.
// Nothing is dropped silently: a value that cannot be kept is an error and nothing at all is saved.
import { MODES, EFFORTS } from './agent-util.js';

export const KEYS = ['model', 'effort', 'permissionMode', 'chain', 'heavy', 'quietMinutes'];
export const HEAVY_MAX = 8;
export const QUIET_MAX = 240;
const MODEL_RE = /^[a-z0-9.\-[\]]{2,60}$/i;

const list = (a) => a.map((x) => `"${x}"`).join(', ');
// a number that came from a form may be text ("2"); anything but a plain number is refused
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);

export function checkSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the settings as an object, for example {"effort":"high"}.' };
  const unknown = Object.keys(input).filter((k) => !KEYS.includes(k));
  if (unknown.length) return { error: `Unknown setting: ${unknown.join(', ')}. The settings are ${KEYS.join(', ')}.` };
  const patch = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'model') {
      if (typeof v !== 'string' || !MODEL_RE.test(v.trim())) return { error: 'model must be a model id of 2 to 60 letters, digits, ".", "-", "[" and "]", for example claude-opus-5-5.' };
      patch.model = v.trim();
    } else if (k === 'effort') {
      if (!EFFORTS.includes(v)) return { error: `effort must be one of ${list(EFFORTS)}.` };
      patch.effort = v;
    } else if (k === 'permissionMode') {
      if (!MODES.includes(v)) return { error: `permissionMode must be one of ${list(MODES)}.` };
      patch.permissionMode = v;
    } else if (k === 'chain') {
      if (typeof v !== 'boolean') return { error: 'chain must be true or false.' };
      patch.chain = v;
    } else if (k === 'heavy') {
      const n = num(v);
      if (!Number.isInteger(n) || n < 1 || n > HEAVY_MAX) return { error: `heavy must be a whole number from 1 to ${HEAVY_MAX}.` };
      patch.heavy = n;
    } else if (k === 'quietMinutes') {
      const n = num(v);
      if (!Number.isInteger(n) || n < 0 || n > QUIET_MAX) return { error: `quietMinutes must be a whole number from 0 to ${QUIET_MAX}.` };
      patch.quietMinutes = n;
    }
  }
  return { patch };
}
