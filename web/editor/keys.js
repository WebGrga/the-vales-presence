// Keys as data (pure, no DOM; tested in keys.test.js): a key event becomes a name like "ctrl+shift+z", and the name
// becomes an action through web/editor/keys.json, the active panel's scope first, then 'editor'.

const NAMES = { ' ': 'space', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', escape: 'esc', spacebar: 'space' };

// { key, ctrlKey, metaKey, shiftKey, altKey } -> "ctrl+shift+z"
export function comboOf(e) {
  let k = String(e.key || '').toLowerCase();
  k = NAMES[k] || k;
  if (!k || k === 'control' || k === 'shift' || k === 'alt' || k === 'meta') return '';
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  // shift is part of a printed symbol ("+", "?") but a modifier for letters, arrows and the rest
  if (e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k))) mods.push('shift');
  if (e.altKey) mods.push('alt');
  return [...mods, k].join('+');
}

// the action for a combo: the active scope first, then 'editor'; null when none
export function actionFor(keys, combo, scope) {
  const scopes = keys?.scopes || {};
  if (scope && scope !== 'editor' && scopes[scope]?.[combo]) return scopes[scope][combo];
  return scopes.editor?.[combo] || null;
}

// does this event target keep its own keys? (a text box, a select, something editable)
export function ownsKeys(target) {
  if (!target || !target.tagName) return false;
  const tag = String(target.tagName).toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !['button', 'checkbox', 'radio', 'range', 'submit'].includes(String(target.type || 'text').toLowerCase());
  return !!target.isContentEditable;
}

// a key name as the screen shows it: "ctrl+shift+z" -> "Ctrl+Shift+Z", "left" -> "←"
const SHOW = { space: 'Space', left: '←', right: '→', up: '↑', down: '↓', esc: 'Esc', enter: 'Enter', delete: 'Delete', backspace: 'Backspace', home: 'Home', end: 'End', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };
export const keyLabel = (combo) => String(combo || '').split('+').filter(Boolean).map((p) => SHOW[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+') || (String(combo).includes('+') ? '+' : '');

// every key of an action, over every scope ('app' first, then 'editor', then the panels)
export function keysOf(keys, action) {
  const out = [];
  const scopes = keys?.scopes || {};
  for (const s of ['app', 'editor', ...Object.keys(scopes).filter((x) => x !== 'app' && x !== 'editor')]) {
    for (const [combo, a] of Object.entries(scopes[s] || {})) if (a === action && !out.includes(combo)) out.push(combo);
  }
  return out;
}

// the ? overlay: the groups of keys.json with each action's keys and words; actions with no key are left out
export function keyList(keys) {
  const labels = keys?.labels || {};
  return (keys?.groups || []).map((g) => ({
    title: g.title,
    rows: (g.actions || []).map((a) => ({ action: a, keys: keysOf(keys, a).map(keyLabel), label: labels[a] || a })).filter((r) => r.keys.length),
  })).filter((g) => g.rows.length);
}

// the hint in the Cuts list's head, from the keys themselves: "↑↓ move · C keep cut · R restore words"
export function cutsHint(keys) {
  const k = (a) => keysOf(keys, a).map(keyLabel)[0];
  return [k('prevCut') && k('nextCut') ? `${k('prevCut')}${k('nextCut')} move` : '', k('keep') ? `${k('keep')} keep cut` : '', k('restore') ? `${k('restore')} restore words` : ''].filter(Boolean).join(' · ');
}

// keys that mean two things: a panel's key that the editor scope gives another action -> [{ combo, scope, a, b }]
export function clashes(keys) {
  const scopes = keys?.scopes || {}, ed = scopes.editor || {}, out = [];
  for (const [s, map] of Object.entries(scopes)) {
    if (s === 'editor') continue;
    for (const [combo, a] of Object.entries(map)) if (ed[combo] && ed[combo] !== a) out.push({ combo, scope: s, a: ed[combo], b: a });
  }
  return out;
}
