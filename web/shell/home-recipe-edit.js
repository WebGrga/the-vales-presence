// Your own recipes: copy a recipe, rename it, drop, reorder or rename its stages, save it. The server says what the
// runner would refuse (POST /api/recipes/check, the same rules as saving) and the box says it in plain words as you go.
//   editRecipe(app, card) -> Promise<saved card | null>
// card: a recipe card (GET /api/recipes). A shipped recipe is copied; one of yours is changed in place (when no project uses it).
import { h } from './dom.js';
import { ask } from './home-dialog.js';
import { stageBar } from './home-recipes.js';

export async function editRecipe(app, card) {
  const editing = card.mine && !card.usedBy;
  const pool = card.mine ? card.pool || card.stages : card.stages;
  const state = {
    name: editing ? card.name : card.mine ? `${card.name} (copy)` : `${card.name} (my version)`,
    stages: card.stages.map((s) => ({ id: s.id, title: s.title })),
  };
  const body = () => ({ id: editing ? card.id : undefined, from: card.mine ? card.from || card.id : card.id, name: state.name, stages: state.stages });
  for (;;) {
    let problems = [];
    const name = h('input', { type: 'text', value: state.name, maxlength: 60, 'aria-label': 'Recipe name' });
    const rows = h('div.re-rows');
    const bar = h('div.re-preview');
    const bad = h('div.re-bad', { role: 'status' });
    const addSel = h('select', { 'aria-label': 'Add a stage back' });
    let t = null;
    const check = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try { problems = (await app.api('/api/recipes/check', body())).errors || []; } catch { problems = []; }
        bad.replaceChildren(...problems.map((p) => h('p', p)));
        bad.classList.toggle('on', !!problems.length);
      }, 150);
    };
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= state.stages.length) return; [state.stages[i], state.stages[j]] = [state.stages[j], state.stages[i]]; draw(); };
    function draw() {
      const kind = (id) => pool.find((s) => s.id === id) || {};
      rows.replaceChildren(...state.stages.map((s, i) => {
        const who = kind(s.id).who || 'you';
        const title = h('input', { type: 'text', value: s.title, maxlength: 60, 'aria-label': `Name of stage ${i + 1}` });
        title.addEventListener('input', () => { s.title = title.value; check(); });
        return h('div.re-row', h('span.re-n', `${i + 1}`), h('span.re-who.' + (who === 'agent' ? 're-a' : 're-y'), who === 'agent' ? 'agent' : 'you'), title,
          h('button.calm.small.icon-only', { type: 'button', title: 'Move up', 'aria-label': `Move ${s.title} up`, disabled: i === 0, on: { click: () => move(i, -1) } }, '↑'),
          h('button.calm.small.icon-only', { type: 'button', title: 'Move down', 'aria-label': `Move ${s.title} down`, disabled: i === state.stages.length - 1, on: { click: () => move(i, 1) } }, '↓'),
          h('button.calm.small.icon-only', { type: 'button', title: 'Drop this stage', 'aria-label': `Drop ${s.title}`, on: { click: () => { state.stages.splice(i, 1); draw(); } } }, '✕'));
      }));
      const out = pool.filter((s) => !state.stages.some((x) => x.id === s.id));
      addSel.replaceChildren(h('option', { value: '' }, out.length ? 'Add a stage back…' : 'Every stage is in'), ...out.map((s) => h('option', { value: s.id }, `${s.title} (${s.who === 'agent' ? 'agent' : 'you'})`)));
      addSel.disabled = !out.length;
      bar.replaceChildren(stageBar(state.stages.map((s) => ({ title: s.title, who: kind(s.id).who || 'you' }))));
      check();
    }
    addSel.addEventListener('change', () => { const s = pool.find((x) => x.id === addSel.value); if (s) { state.stages.push({ id: s.id, title: s.title }); draw(); } });
    name.addEventListener('input', () => { state.name = name.value; check(); });
    draw();
    const ok = await ask({
      title: editing ? `Change “${card.name}”` : card.mine ? `Copy “${card.name}”` : `Your own version of “${card.name}”`,
      body: [h('p.muted', editing ? 'Rename it, drop stages, or put them in another order. Projects you make from it follow this list.' : 'This makes a copy under a name of your own. The recipe it came from stays as it is.'),
        h('label.re-field', h('span', 'Name'), name), rows, h('div.re-add', addSel), bar, bad],
      ok: editing ? 'Save' : 'Save as my recipe', focus: name, check: () => (problems[0] ? 'Fix what is marked in red first.' : null),
    });
    if (!ok) return null;
    try { const r = await app.api('/api/recipes', body()); app.toast(`“${r.recipe.name}” is saved. It is in the recipe cards.`, 'ok'); return r.recipe; }
    catch (e) { app.toast('Could not save it: ' + e.message, 'error'); }
  }
}
