// The project name in the top bar: it shows the open project and opens the Projects home (web/shell/home.js), which is
// the place to switch, start, rename and tidy projects. update(p) is called whenever the open project changes.
import { h, icon } from './dom.js';

export function mountPicker(el, app) {
  const btn = h('button.calm.picker-btn', { type: 'button', title: 'Projects', 'aria-label': 'Projects' }, icon('folder', true), h('span.picker-name', 'No project'), h('span.caret', '▾'));
  el.append(btn);
  btn.addEventListener('click', () => app.home.open());
  return {
    update(p) { const n = btn.querySelector('.picker-name'); n.textContent = p ? (p.title || p.id) : 'No project'; btn.title = p ? `Project: ${p.title || p.id} (click for all projects)` : 'Projects'; },
    open: () => app.home.open(),
  };
}
