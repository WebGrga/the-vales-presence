// The one-line "Next: ..." under the stage bar, shown after a project is made (and only then). It goes away when you act:
// the project moves (a stage starts, ends or asks), you open another project, or you press the x. app.hint(text) shows it.
import { h } from './dom.js';

// pure: what changes when the project moves on: the stage it stands on and that stage's status
export const signature = (p) => (p ? `${p.id}|${p.at}|${p.stages?.[p.at]?.status || ''}|${p.done ? 'done' : ''}` : '');

export function mountHint(host, app) {
  const text = h('span');
  const el = h('div.next-hint', { hidden: true, role: 'status' }, text, h('button.calm.small.icon-only', { type: 'button', title: 'Hide this', 'aria-label': 'Hide this hint', on: { click: () => hide() } }, '✕'));
  host.append(el);
  let sig = '';
  const hide = () => { el.hidden = true; sig = ''; };
  const show = (line) => {
    if (!line) return hide();
    text.textContent = line;
    sig = signature(app.project());
    el.hidden = false;
  };
  const check = () => { if (!el.hidden && signature(app.project()) !== sig) hide(); };
  app.on('project', () => setTimeout(check, 0));
  app.on('project-view', () => setTimeout(check, 0));
  return show;
}
