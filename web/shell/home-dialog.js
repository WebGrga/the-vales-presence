// A small modal for the Projects home (rename, duplicate, free space, empty the Bin, export). One at a time.
// ask({ title, body: [nodes], ok: 'Rename', danger?, focus?: element, check?: () => string|null }) -> Promise<true|false>
// Escape and a click outside answer false; Enter in a text box answers true. A check that returns a words string keeps the box open.
import { h } from './dom.js';

export function ask({ title, body = [], ok = 'OK', danger = false, focus = null, check = null, cancel = 'Cancel' }) {
  return new Promise((done) => {
    const layer = h('div.home-dialog-layer', { role: 'presentation' });
    const err = h('p.home-dialog-err', { role: 'alert', hidden: true });
    const yes = h('button' + (danger ? '.warn' : '.go'), { type: 'button' }, ok);
    const no = h('button.calm', { type: 'button' }, cancel);
    const box = h('div.home-dialog.px-frame', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h3', title), ...body, err, h('div.pop-btns', no, yes));
    layer.append(box);
    const end = (v) => { removeEventListener('keydown', key, true); layer.classList.remove('in'); setTimeout(() => layer.remove(), 250); done(v); };
    const submit = () => { const bad = check?.(); if (bad) { err.textContent = bad; err.hidden = false; return; } end(true); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
      else if (e.key === 'Enter' && e.target?.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); submit(); }
    };
    addEventListener('keydown', key, true);
    yes.addEventListener('click', submit); no.addEventListener('click', () => end(false));
    layer.addEventListener('pointerdown', (e) => { if (e.target === layer) end(false); });
    document.body.append(layer);
    requestAnimationFrame(() => { layer.classList.add('in'); (focus || (danger ? no : yes)).focus?.(); focus?.select?.(); });
  });
}
