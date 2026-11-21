// The Context tab's skill-set row: which set this project uses (a switcher), how many projects use it, the menu
// (new, duplicate, rename, delete, make default, export, import, what differs) and the Map / List toggle.
import { h, icon } from '../shell/dom.js';
import { nameForm, differsView, importView, download } from './set-panels.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const slugFile = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'set';

export function setsBar({ app, host, ctx, onView }) {
  let view = 'map';
  const sel = h('select.cx-set', { title: 'Which skill set the open project uses', on: { change: () => pick(sel.value) } });
  const info = h('span.cx-set-info.muted');
  const menu = h('div.cx-menu', { hidden: true });
  const more = h('button.small.calm', { type: 'button', title: 'New, duplicate, rename, delete, export, import', on: { click: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } } }, icon('gear', true), h('span', 'Sets'));
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  const mapBtn = h('button.small', { type: 'button', on: { click: () => setView('map') } }, 'Map');
  const listBtn = h('button.small', { type: 'button', on: { click: () => setView('list') } }, 'List');
  const toggle = h('div.cx-toggle', mapBtn, listBtn);
  function setView(v) { view = v; mapBtn.classList.toggle('on', v === 'map'); listBtn.classList.toggle('on', v === 'list'); onView(v); }

  const done = (text) => app.toast(text, 'ok');
  const fail = (e) => app.toast(e.message, 'error');
  const act = (label, fn, cls = '') => h('button.cx-menu-item' + cls, { type: 'button', on: { click: () => { menu.hidden = true; fn(); } } }, label);

  async function pick(v) {
    const p = app.project();
    try {
      if (p) await ctx.post('/api/context/set-use', { project: p.id, set: v || null });
      else await ctx.post('/api/context/set-default', { set: v });
      done(p ? (v ? 'This project uses that set now.' : 'This project follows your default set.') : 'That is your default set now.');
    } catch (e) { fail(e); host.reload(); }
  }
  // a set just made: the project (or the default) moves to it, so what the user does next lands in it
  async function usingNew(id) {
    const p = app.project();
    if (p) await ctx.post('/api/context/set-use', { project: p.id, set: id }); else await ctx.post('/api/context/set-default', { set: id });
    ctx.empty(); done('Set made, and in use.');
  }

  function draw(m) {
    const cur = m.skillSet, p = m.project, dflt = m.sets.find((x) => x.isDefault);
    sel.replaceChildren(
      ...(p ? [h('option', { value: '', selected: !cur.own }, `Your default set (${dflt?.name || 'Default'})`)] : []),
      ...m.sets.map((x) => h('option', { value: x.id, selected: p ? cur.own && x.id === cur.id : x.id === cur.id }, x.name + (x.builtin ? ' (shipped)' : '') + (x.isDefault ? ' (your default)' : ''))));
    const n = cur.projects;
    info.textContent = `${n ? plural(n, 'project') + (n === 1 ? ' uses' : ' use') : 'No project uses'} this set${cur.isDefault ? ', your default' : ''}${p && !cur.own ? '; this project follows your default' : ''}.`;
    const nameGo = (from) => async (name) => { if (!name) throw new Error('give the set a name'); const r = await ctx.post('/api/context/set-new', { name, from }); await usingNew(r.set); };
    menu.replaceChildren(
      act('New set from this one', () => nameForm(ctx, { title: 'New skill set', label: 'Name', verb: 'Make the set', intro: `It starts as a copy of “${cur.name}”. Then you change it without touching any other set.`, go: nameGo(cur.id) })),
      act('Duplicate this set', () => nameForm(ctx, { title: 'Duplicate set', label: 'Name', value: cur.name + ' copy', verb: 'Duplicate', go: nameGo(cur.id) })),
      ...(cur.builtin ? [] : [
        act('Rename this set', () => nameForm(ctx, { title: 'Rename set', label: 'Name', value: cur.name, verb: 'Rename', icon: 'keep', go: async (name) => { await ctx.post('/api/context/set-rename', { set: cur.id, name }); ctx.empty(); done('Renamed.'); } })),
        act('Delete this set', async () => {
          if (!confirm(`Delete the set “${cur.name}”?\n\n${n ? plural(n, 'project') + ' use it and will go back to your default set. ' : ''}A backup of it is kept.`)) return;
          try { await ctx.post('/api/context/set-delete', { set: cur.id }); done('Set deleted.'); } catch (e) { fail(e); }
        }, '.danger')]),
      ...(cur.isDefault ? [] : [act('Make this my default set', async () => { try { await ctx.post('/api/context/set-default', { set: cur.id }); done('That is your default set now.'); } catch (e) { fail(e); } })]),
      act('What differs from shipped', () => differsView(ctx, cur.id)),
      act('Export this set as a file', async () => { try { const r = await app.api(`/api/context/export?kind=set&id=${encodeURIComponent(cur.id)}&${host.query()}`); download(`${slugFile(r.name)}.presence-set.json`, r.bundle); done('Set exported.'); } catch (e) { fail(e); } }),
      act('Import a skill or set', () => importView(ctx)));
  }
  const el = h('div.cx-sets', h('label.cx-for', h('span.muted', 'Skill set'), sel), info, h('div.cx-menu-wrap', more, menu), h('div.grow'), toggle);
  setView('map');
  return { el, draw, get view() { return view; }, setView };
}
