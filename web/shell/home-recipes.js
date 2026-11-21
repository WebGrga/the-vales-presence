// The recipe cards of the New project box (they replace the dropdown): what you bring, what you do, what the agent does,
// the stages as a small bar (agent in blue, you in orange), and a rough time and cost taken from the projects that
// really ran (server/recipe-card.js: the words say "about", and name the stages nobody has measured yet).
// recipeCards({ recipes, value, onPick(id), onCustomize(card), onDelete(card) }) -> { el, set(value), update(recipes) }
import { h, icon } from './dom.js';

// the stages as a bar of small segments: blue = the agent, orange = you; hover or focus names each one
export function stageBar(stages) {
  return h('div.rc-bar', { role: 'img', 'aria-label': 'Stages: ' + stages.map((s) => `${s.title} (${s.who === 'agent' ? 'agent' : 'you'})`).join(', ') },
    ...stages.map((s) => h('span.rc-seg.' + s.who + (s.heavy ? '.heavy' : ''), { title: `${s.title}: ${s.who === 'agent' ? 'the agent' : 'you'}` })));
}


function costLine(c) {
  const e = c.estimate;
  if (!e.measured) return h('p.rc-est.dim', 'Time and cost: not measured yet. Nothing has run in this recipe on this computer.');
  return h('p.rc-est', h('b', e.time), ' of the agent’s time, ', h('b', e.cost),
    h('span.dim', e.missing.length ? ` (measured on ${e.measured} of ${e.total} agent stages in your projects; not yet: ${e.missing.join(', ')})` : ` (what the same stages took in your projects)`));
}

export function recipeCards({ recipes, value, onPick, onCustomize, onDelete }) {
  const el = h('div.rc-grid', { role: 'radiogroup', 'aria-label': 'Recipe' });
  let list = recipes, cur = value;

  function draw() {
    el.replaceChildren(...list.map((c) => {
      const on = c.id === cur;
      const tools = h('div.rc-tools',
        c.mine
          ? [h('button.calm.small', { type: 'button', title: c.usedBy ? 'Projects use it: make a copy to change it' : 'Change the stages of this recipe', on: { click: (e) => { e.stopPropagation(); onCustomize(c); } } }, c.usedBy ? 'Copy…' : 'Edit…'),
            c.usedBy ? null : h('button.calm.small', { type: 'button', on: { click: (e) => { e.stopPropagation(); onDelete(c); } } }, 'Delete')]
          : h('button.calm.small', { type: 'button', title: 'Copy this recipe, then drop or reorder its stages', on: { click: (e) => { e.stopPropagation(); onCustomize(c); } } }, 'Make my own…'));
      const card = h('div.rc' + (on ? '.on' : ''), { role: 'radio', tabindex: on || (!cur && c === list[0]) ? '0' : '-1', 'aria-checked': String(on), 'data-recipe': c.id, title: c.about || null },
        h('div.rc-head', icon(c.icon, true), h('b', c.name), c.mine ? h('span.rc-mine', 'Yours') : null, on ? icon('keep', true) : null),
        ...c.lines.map((l) => h('p.rc-line', h('b', l.label), ' ', l.text)),
        stageBar(c.stages), costLine(c), tools);
      card.addEventListener('click', () => pick(c.id));
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(c.id); }
        else if (/^Arrow(Right|Down|Left|Up)$/.test(e.key)) {
          e.preventDefault();
          const i = list.findIndex((x) => x.id === c.id), n = list.length;
          const next = list[(i + (/Right|Down/.test(e.key) ? 1 : n - 1)) % n];
          pick(next.id); el.querySelector(`[data-recipe="${CSS.escape(next.id)}"]`)?.focus();
        }
      });
      return card;
    }));
  }
  function pick(id) { if (id === cur) return; cur = id; draw(); onPick(id); }
  draw();
  return { el, set(v) { cur = v; draw(); }, update(next) { list = next; if (!list.some((x) => x.id === cur)) cur = list[0]?.id; draw(); }, value: () => cur };
}
