// The Context tab's List view: every skill in a searchable list with the stages that read it, next to the map.
import { h, icon } from '../shell/dom.js';
import { stateBadge, words } from './view.js';

// pure: the skills that match a search (name, description or a stage that reads it), in name order
export function filterSkills(map, q) {
  const needle = String(q || '').trim().toLowerCase();
  const title = (id) => map.columns.find((c) => c.id === id)?.title || id;
  return map.library.map((id) => map.nodes[id]).filter((n) => !needle || [n.label, n.description, ...n.readers.map(title)].join(' ').toLowerCase().includes(needle));
}

export function listView({ panel, getMap }) {
  const q = h('input.cx-search', { type: 'search', placeholder: 'Search skills or stages', autocomplete: 'off' });
  const body = h('div.cx-list-rows');
  const el = h('section.cx-list-view', { hidden: true }, h('div.cx-list-top', q), body);
  function draw() {
    const m = getMap();
    if (!m) return;
    const rows = filterSkills(m, q.value);
    const title = (id) => m.columns.find((c) => c.id === id)?.title || id;
    body.replaceChildren(...(rows.length ? rows.map((n) => {
      const [badge, bcls] = stateBadge(n);
      return h('div.cx-list-row', { 'data-id': n.id },
        h('button.cx-list-name', { type: 'button', title: 'Open it', on: { click: () => panel.open(n.id) } }, icon('sparkle', true), h('span.cx-name', n.label), h('span.cx-dot.' + bcls, { title: badge })),
        h('span.cx-words', words(n.words)),
        h('div.cx-list-stages', ...(n.readers.length ? n.readers.map((id) => h('button.cx-chip', { type: 'button', title: `What ${title(id)} reads`, on: { click: () => panel.stage(id) } }, title(id))) : [h('span.dim', 'off everywhere')])),
        n.description ? h('p.cx-list-desc.dim', n.description) : null);
    }) : [h('p.dim', 'No skill matches that.')]));
  }
  q.addEventListener('input', draw);
  return { el, draw };
}
