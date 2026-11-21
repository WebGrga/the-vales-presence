// A small dialog in the style of the Keys sheet (same layer and frame), for the media bin: a title, some text or fields, and buttons.
// dialog({ title, body: [nodes], ok: 'Remove', danger, onOk: async () => ..., cancel: 'Cancel' }) -> { close }. Esc and a click outside close it;
// onOk may throw: the message shows in the dialog and it stays open (what you typed is still there).
import { h, button } from '../shell/dom.js';

export function dialog({ title, body = [], ok = 'OK', danger = false, onOk, cancel = 'Cancel' }) {
  const err = h('p.bin-err', { hidden: true });
  let layer;
  const close = () => { if (!layer) return; const l = layer; layer = null; document.removeEventListener('keydown', onKey, true); l.classList.remove('in'); setTimeout(() => l.remove(), 300); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const go = button(null, ok, '', async () => {
    go.disabled = true; err.hidden = true;
    try { await onOk?.(); close(); } catch (e) { err.textContent = e.message || String(e); err.hidden = false; go.disabled = false; }
  }, danger ? 'calm small danger' : 'go small');
  const no = button(null, cancel, 'Close (Esc)', close, 'calm small');
  const box = h('div.keys-box.bin-dialog.px-frame', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2.display', title), ...body, err, h('div.bin-dialog-btns', go, no));
  layer = h('div.keys-layer', box);
  layer.addEventListener('pointerdown', (e) => { if (e.target === layer) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(layer);
  requestAnimationFrame(() => layer?.classList.add('in'));
  (box.querySelector('input') || go).focus();
  return { close };
}
