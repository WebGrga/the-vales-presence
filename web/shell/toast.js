// Toasts: short notes in the bottom right corner, above the footer line (no header, tab or button sits there), that fade
// in and out (gentle, never a flash). A toast stays while the pointer is on it; the same words twice show once; notes that
// arrive together (within a second) are one toast with a line each, so they never pile up over each other; errors and
// "the agent is waiting for you" stay longer. A click closes one.
import { h } from './dom.js';

const KINDS = ['ok', 'warn', 'error', 'info', 'ask'];
const RANK = { info: 0, ok: 1, warn: 2, ask: 3, error: 4 }; // a merged toast takes the most serious kind
const TOGETHER_MS = 1000;
let box = null;
const shown = new Map(); // text -> the toast still on screen that holds it
let last = null;         // the newest toast: { el, at, kind, words, life, timer, restart }

export function toast(text, kind = 'info', ms = 4200, opts = {}) {
  if (!text) return;
  const words = String(text);
  if (shown.has(words)) return;
  if (!box) { box = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(box); }
  const k = KINDS.includes(kind) ? kind : 'info';
  const lifeOf = (kind2) => (kind2 === 'error' ? Math.max(ms * 2.5, 10000) : kind2 === 'ask' ? Math.max(ms, 9000) : ms);

  // together with the one just shown: one more line in it
  const action = opts?.action;
  if (!action && last && last.el.isConnected && Date.now() - last.at < TOGETHER_MS) {
    last.el.append(h('div', words));
    shown.set(words, last);
    last.words.push(words);
    if ((RANK[k] ?? 0) > (RANK[last.kind] ?? 0)) { last.el.classList.remove(last.kind); last.el.classList.add(k); last.kind = k; last.el.setAttribute('role', k === 'error' || k === 'ask' ? 'alert' : 'status'); }
    last.life = Math.max(last.life, lifeOf(k));
    last.restart(last.life);
    return;
  }

  const t = { el: h('div.toast.' + k, { role: k === 'error' || k === 'ask' ? 'alert' : 'status', title: 'Click to close' }, h('div', words), action ? h('button.small.go.toast-act', { type: 'button', on: { click: (e) => { e.stopPropagation(); go(); try { action.fn(); } catch {} } } }, action.label) : null), at: Date.now(), kind: k, words: [words], life: lifeOf(k), timer: 0, restart: null };
  box.append(t.el);
  shown.set(words, t);
  if (!action) last = t;
  requestAnimationFrame(() => t.el.classList.add('in'));
  const go = () => { clearTimeout(t.timer); for (const w of t.words) shown.delete(w); t.el.classList.remove('in'); setTimeout(() => t.el.remove(), 350); };
  t.restart = (m) => { clearTimeout(t.timer); t.timer = setTimeout(go, m); };
  t.restart(t.life);
  t.el.addEventListener('pointerenter', () => clearTimeout(t.timer));
  t.el.addEventListener('pointerleave', () => t.restart(2500));
  t.el.addEventListener('click', go);
}
