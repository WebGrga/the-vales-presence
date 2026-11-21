// Toasts: short notes at the top in the middle, under the stage bar (never over the timeline), that fade in and out (gentle,
// never a flash). A toast stays while the pointer is on it; the same words twice in a row show once; errors and
// "the agent is waiting for you" stay longer. A click closes one.
import { h } from './dom.js';

const KINDS = ['ok', 'warn', 'error', 'info', 'ask'];
let box = null;
const shown = new Map(); // text -> element still on screen

export function toast(text, kind = 'info', ms = 4200) {
  if (!text) return;
  const words = String(text);
  if (shown.has(words)) return;
  if (!box) { box = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(box); }
  const k = KINDS.includes(kind) ? kind : 'info';
  const el = h('div.toast.' + k, { role: k === 'error' || k === 'ask' ? 'alert' : 'status', title: 'Click to close' }, words);
  box.append(el);
  shown.set(words, el);
  requestAnimationFrame(() => el.classList.add('in'));
  const go = () => { clearTimeout(t); shown.delete(words); el.classList.remove('in'); setTimeout(() => el.remove(), 350); };
  const life = k === 'error' ? Math.max(ms * 2.5, 10000) : k === 'ask' ? Math.max(ms, 9000) : ms;
  let t = setTimeout(go, life);
  el.addEventListener('pointerenter', () => clearTimeout(t));
  el.addEventListener('pointerleave', () => { clearTimeout(t); t = setTimeout(go, 2500); });
  el.addEventListener('click', go);
}
