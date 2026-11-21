// The keyboard overlay ("?" or the ? button in the top bar): every key of web/editor/keys.json in its group, with the
// words keys.json gives it. Esc, ?, a click outside or Close shut it. The list itself is pure (keyList in keys.js).
import { h, button } from './dom.js';
import { keyList } from '../editor/keys.js';

let keysData = null, layer = null;

async function load() {
  if (keysData) return keysData;
  try { keysData = await fetch('/editor/keys.json', { cache: 'no-cache' }).then((r) => r.json()); } catch { keysData = { scopes: {} }; }
  return keysData;
}

export async function toggleKeys() {
  if (layer) { closeKeys(); return; }
  const keys = await load();
  const groups = keyList(keys);
  const close = button(null, 'Close', 'Close (Esc)', () => closeKeys(), 'calm small');
  const box = h('div.keys-box.px-frame', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard keys' },
    h('div.keys-head', h('h2.display', 'Keys'), h('span.dim', 'In the Edit tab. A text box you are typing in keeps its own keys.'), h('div.grow'), close),
    h('div.keys-grid', ...groups.map((g) => h('section.keys-group', h('h3', g.title),
      h('dl', ...g.rows.flatMap((r) => [h('dt', ...r.keys.flatMap((k, i) => [i ? h('span.dim', ' or ') : null, h('kbd.kbd', k)]).filter(Boolean)), h('dd', r.label)]))))));
  layer = h('div.keys-layer', box);
  layer.addEventListener('pointerdown', (e) => { if (e.target === layer) closeKeys(); });
  document.body.append(layer);
  requestAnimationFrame(() => layer?.classList.add('in'));
  close.focus();
}

export function closeKeys() {
  if (!layer) return;
  const l = layer; layer = null;
  l.classList.remove('in');
  setTimeout(() => l.remove(), 300);
}

export const keysOpen = () => !!layer;
