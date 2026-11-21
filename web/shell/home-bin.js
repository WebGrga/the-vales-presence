// The Bin section of the Projects home: binned projects with Restore, and Empty (asks first, says how much it frees).
// binSection(app, { onChange(restoredId?) }) -> { el, refresh() }
import { h, icon } from './dom.js';
import { ask } from './home-dialog.js';
import { ago } from './home-logic.js';
import { bytesWords } from './home-actions.js';

export function binSection(app, { onChange }) {
  const body = h('div.home-bin-body');
  const head = h('summary', icon('cross', true), h('span', 'Bin'), h('span.home-count', '0'));
  const el = h('details.home-bin', { hidden: true }, head, body);
  let items = [];

  async function refresh() {
    try { items = (await app.api('/api/bin')).items || []; } catch { items = []; }
    el.hidden = !items.length;
    head.querySelector('.home-count').textContent = String(items.length);
    const total = items.reduce((a, x) => a + x.bytes, 0);
    const empty = h('button.warn.small', { type: 'button', on: { click: emptyAll } }, `Empty the Bin (${bytesWords(total)})`);
    body.replaceChildren(h('p.muted', 'Projects here are not deleted yet. Restore one to get it back exactly as it was.'),
      h('div.home-bin-list', ...items.map((x) => h('div.home-bin-row',
        h('div', h('b', x.title), h('div.dim', `${bytesWords(x.bytes)} · put in the Bin ${ago(x.binned)}`)),
        h('div.home-bin-btns',
          h('button.calm.small', { type: 'button', on: { click: () => restore(x) } }, icon('restore', true), h('span', 'Restore')),
          h('button.calm.small', { type: 'button', on: { click: () => emptyOne(x) } }, 'Delete for good'))))),
      h('div.pop-btns', empty));
  }
  async function restore(x) {
    try { const r = await app.api('/api/bin/restore', { name: x.name }); app.toast(r.renamed ? `Restored “${x.title}” (its folder name was taken, so it has a new one).` : `Restored “${x.title}”.`, 'ok'); await refresh(); onChange(r.id); } catch (e) { app.toast('Could not restore it: ' + e.message, 'error'); }
  }
  async function wipe(list, title, lead) {
    const bytes = list.reduce((a, x) => a + x.bytes, 0);
    const yes = await ask({ title, ok: `Delete for good (${bytesWords(bytes)})`, danger: true,
      body: [h('p', lead), h('ul', ...list.slice(0, 8).map((x) => h('li', x.title, h('span.dim', ` · ${bytesWords(x.bytes)}`)))), list.length > 8 ? h('p.dim', `and ${list.length - 8} more`) : null, h('p.muted', `This frees ${bytesWords(bytes)} and cannot be undone.`)] });
    if (!yes) return;
    try { const r = await app.api('/api/bin/empty', { names: list.map((x) => x.name), confirm: true }); app.toast(`Deleted ${r.deleted}, freed ${bytesWords(r.bytes)}.`, 'ok'); await refresh(); onChange(); } catch (e) { app.toast('Could not delete: ' + e.message, 'error'); }
  }
  const emptyAll = () => wipe(items, 'Empty the Bin?', `${items.length} project${items.length === 1 ? '' : 's'} will be deleted for good, with their footage:`);
  const emptyOne = (x) => wipe([x], `Delete “${x.title}” for good?`, 'This project will be deleted for good, with its footage:');
  return { el, refresh, count: () => items.length };
}
