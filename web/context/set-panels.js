// Side-panel views of the Context tab for skill sets and files: a name form (new, duplicate, rename), "what differs
// from shipped" with Back to defaults, and Import (a skill or a set as one JSON file; it never overwrites unasked).
import { h, icon } from '../shell/dom.js';

const head = (ctx, ic, title, badge) => h('header.cx-p-head', icon(ic), h('div', h('h3', title), badge ? h('span.cx-badge.mine', badge) : null),
  h('button.icon-only.cx-close', { type: 'button', title: 'Close', on: { click: ctx.empty } }, icon('cross', true)));
const showNote = (note, text, kind = 'error') => { note.hidden = !text; note.className = 'cx-note ' + kind; note.textContent = text || ''; };

// one name, one button: { title, label, value, verb, intro, go(name) -> promise }. Enter does it; an empty or taken name is said in words.
export function nameForm(ctx, { title, label, value = '', verb, intro, go, icon: ic = 'plus' }) {
  const input = h('input', { type: 'text', maxLength: 64, autocomplete: 'off', value });
  const note = h('div.cx-note', { hidden: true });
  const btn = h('button.go', { type: 'button' }, icon(ic, true), h('span', verb));
  const run = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await go(input.value.trim()); } catch (e) { btn.disabled = false; showNote(note, e.message); input.focus(); }
  };
  btn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  ctx.set({ form: true, id: 'set-form' });
  ctx.host.opened(null);
  ctx.side.replaceChildren(h('div.cx-panel', head(ctx, ic, title), intro ? h('p.cx-desc', intro) : null, h('label.cx-field', h('span', label), input), h('div.cx-acts', btn), note));
  input.focus(); input.select();
}

// every change against the shipped craft, for one set
export async function differsView(ctx, setId) {
  const { app, host } = ctx;
  let r;
  try { r = await app.api(`/api/context/differs?set=${encodeURIComponent(setId || '')}&${host.query()}`); } catch (e) { app.toast(e.message, 'error'); return; }
  const lists = r.lists.map((d) => h('li', h('b', d.key), ' ',
    d.added.length ? h('span.cx-diff.add', 'on: ' + d.added.join(', ')) : null, d.added.length && d.removed.length ? ' ' : null,
    d.removed.length ? h('span.cx-diff.rm', 'off: ' + d.removed.join(', ')) : null,
    !d.added.length && !d.removed.length ? h('span.dim', 'a different order') : null));
  const items = r.items.map((i) => h('li', h('button.cx-node.cx-flat', { type: 'button', on: { click: () => ctx.open(i.id) } }, icon(i.kind === 'skill' ? 'sparkle' : 'book', true), h('span.cx-name', i.label), h('span.cx-words', i.state === 'yours' ? 'your skill' : 'your version'))));
  const back = !r.set.builtin && r.lists.length ? h('button.small.warn', { type: 'button', title: 'Take every skill switch of this set back to the shipped ones' }, icon('restore', true), h('span', 'Back to defaults')) : null;
  if (back) back.addEventListener('click', async () => {
    if (!confirm(`Put every skill switch of “${r.set.name}” back to the shipped ones?\n\nYour own skills and edited texts stay. A backup of the set is kept.`)) return;
    try { await ctx.post('/api/context/set-reset', { set: r.set.id }); app.toast(`${r.set.name}: back to the shipped skills.`, 'ok'); } catch (e) { app.toast(e.message, 'error'); }
  });
  ctx.set({ form: true, id: 'differs' });
  host.opened(null);
  ctx.side.replaceChildren(h('div.cx-panel', head(ctx, 'eye', 'What differs from shipped', r.set.name),
    h('p.cx-desc', r.set.builtin ? 'The Default set is the shipped one: nothing differs. Change a skill and a set of your own is made.' : 'Every change in this set against what the app ships.'),
    h('div.cx-label', 'Skills switched on or off'),
    lists.length ? h('ul.cx-reads.cx-diffs', ...lists) : h('p.cx-why.dim', 'No skill switch differs.'),
    h('div.cx-label', 'Skills and files you wrote or changed'),
    items.length ? h('ul.cx-reads', ...items) : h('p.cx-why.dim', 'None.'),
    back ? h('div.cx-acts', back) : null));
}

// import: pick a file, send it; a clash shows what would be replaced and asks
export function importView(ctx) {
  const { app } = ctx;
  const note = h('div.cx-note', { hidden: true }), area = h('div.cx-acts');
  const file = h('input', { type: 'file', accept: '.json,application/json' });
  let bundle = null;
  const send = async (mode) => {
    try {
      const r = await ctx.post('/api/context/import', { bundle, mode });
      if (r.conflict) return clash(r);
      const what = r.kind === 'set' ? `Set imported${r.skills ? ` with ${r.skills} skill${r.skills === 1 ? '' : 's'}` : ''}.` : r.skills ? 'Skill imported.' : 'That skill is already here, unchanged.';
      app.toast(what, 'ok'); ctx.empty();
    } catch (e) { showNote(note, e.message); }
  };
  function clash(r) {
    const parts = [r.skills?.length ? `the skill${r.skills.length === 1 ? '' : 's'} ${r.skills.join(', ')} ${r.skills.length === 1 ? 'is' : 'are'} here already with other text` : '', r.set ? `a set called “${r.set}” is here already` : ''].filter(Boolean);
    showNote(note, `Nothing is imported yet: ${parts.join(' and ')}.`, 'warn');
    area.replaceChildren(
      h('button.small.warn', { type: 'button', title: 'Overwrite what is here (a backup is kept)', on: { click: () => send('replace') } }, 'Replace'),
      h('button.small.go', { type: 'button', title: 'Import under other names; what is here stays', on: { click: () => send('keep') } }, 'Keep both'),
      h('button.small.calm', { type: 'button', on: { click: ctx.empty } }, 'Cancel'));
  }
  file.addEventListener('change', async () => {
    area.replaceChildren(); showNote(note, '');
    const f = file.files[0];
    if (!f) return;
    if (f.size > 4_000_000) return showNote(note, 'That file is too big to be a skill or a set.');
    try { bundle = JSON.parse(await f.text()); } catch { bundle = null; return showNote(note, 'That file is not a skills file (it is not JSON).'); }
    send();
  });
  ctx.set({ form: true, id: 'import' });
  ctx.host.opened(null);
  ctx.side.replaceChildren(h('div.cx-panel', head(ctx, 'upload', 'Import'),
    h('p.cx-desc', 'Pick a skill or a skill set file that was exported from this app. Nothing is overwritten without asking.'),
    h('label.cx-field', h('span', 'File'), file), note, area));
}

// an object as a downloaded JSON file
export function download(name, obj) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
