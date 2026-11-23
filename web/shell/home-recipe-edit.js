// Your own recipes: copy a recipe, rename it, drop, reorder or rename its stages, write steps of your own, save it. The
// server says what the runner would refuse (POST /api/recipes/check, the same rules as saving) and the box says it in
// plain words as you go.
//   editRecipe(app, card) -> Promise<saved card | null>
// card: a recipe card (GET /api/recipes). A shipped recipe is copied; one of yours is changed in place (when no project uses it).
// "+ New step" opens a small form (title, who does it, what the agent should do, files it must leave, where it goes).
// A step you wrote is { id, title, kind: make|gate, focus, out, custom: true }; the others are { id, title }.
// Typed text is kept in this browser (the list, and the step being written) until you save, so closing the box loses nothing.
import { h } from './dom.js';
import { ask } from './home-dialog.js';
import { stageBar } from './home-recipes.js';
import { createDraft } from './drafts.js';

const BLANK = { title: '', kind: 'make', focus: '', out: '', at: '' };
const wire = (s) => (s.custom ? { id: s.id, title: s.title, kind: s.kind, focus: s.focus, out: s.out, custom: true } : { id: s.id, title: s.title });

export async function editRecipe(app, card) {
  const editing = card.mine && !card.usedBy;
  const pool = card.mine ? card.pool || card.stages : card.stages;
  const state = {
    name: editing ? card.name : card.mine ? `${card.name} (copy)` : `${card.name} (my version)`,
    stages: card.stages.map((s) => (s.custom ? { id: s.id, title: s.title, kind: s.kind, focus: s.focus || '', out: (s.out || []).join('\n'), custom: true } : { id: s.id, title: s.title })),
  };
  const keep = createDraft(null, `recipe-edit.${card.id}`), stepKeep = createDraft(null, `new-step.${card.id}`);
  try {
    const was = JSON.parse(keep.get() || 'null');
    if (was && typeof was.name === 'string' && Array.isArray(was.stages) && was.stages.length) { state.name = was.name; state.stages = was.stages; }
  } catch {}
  const save = () => keep.set(JSON.stringify({ name: state.name, stages: state.stages }));
  const body = () => ({ id: editing ? card.id : undefined, from: card.mine ? card.from || card.id : card.id, name: state.name, stages: state.stages.map(wire) });
  for (;;) {
    let problems = [];
    const name = h('input', { type: 'text', value: state.name, maxlength: 60, 'aria-label': 'Recipe name' });
    const rows = h('div.re-rows');
    const bar = h('div.re-preview');
    const bad = h('div.re-bad', { role: 'status' });
    const addSel = h('select', { 'aria-label': 'Add a stage back' });
    const stepBox = h('div.re-step', { hidden: true, 'data-no-enter': '' });
    let editAt = -1;
    let form = { ...BLANK };
    try { form = { ...form, ...JSON.parse(stepKeep.get() || 'null') }; } catch {}
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
    const openStep = (i) => {
      editAt = i;
      if (i >= 0) { const s = state.stages[i]; form = { title: s.title, kind: s.kind || 'make', focus: s.focus || '', out: s.out || '', at: String(i) }; }
      else { try { form = { ...BLANK, ...JSON.parse(stepKeep.get() || 'null') }; } catch { form = { ...BLANK }; } }
      drawStep(); stepBox.hidden = false; stepBox.querySelector('input')?.focus();
    };
    function drawStep() {
      const field = (k, el) => { el.value = form[k] ?? ''; el.addEventListener('input', () => { form[k] = el.value; if (editAt < 0) stepKeep.set(JSON.stringify(form)); }); return el; };
      const title = field('title', h('input', { type: 'text', maxlength: 60, placeholder: 'For example: Cut the sponsor read', 'aria-label': 'Step title' }));
      const kind = field('kind', h('select', { 'aria-label': 'Who does this step' }, h('option', { value: 'make' }, 'The agent does it'), h('option', { value: 'gate' }, 'You check it (after an agent step)')));
      const focus = field('focus', h('textarea', { rows: 4, maxlength: 4000, placeholder: 'What should the agent do? Write it as you would tell an editor.', 'aria-label': 'What the agent should do' }));
      const out = field('out', h('textarea', { rows: 2, placeholder: 'Files it must leave, one per line (optional). For example: studio/sponsor-notes.md', 'aria-label': 'Files the step must leave' }));
      const at = h('select', { 'aria-label': 'Where it goes' }, ...state.stages.map((s, i) => h('option', { value: String(i) }, `Before ${i + 1}. ${s.title}`)), h('option', { value: String(state.stages.length) }, 'At the end'));
      at.value = form.at !== '' && Number(form.at) <= state.stages.length ? form.at : String(state.stages.length);
      at.addEventListener('change', () => { form.at = at.value; if (editAt < 0) stepKeep.set(JSON.stringify(form)); });
      const msg = h('p.re-step-msg', { role: 'status' });
      const done = () => {
        const s = { id: editAt >= 0 ? state.stages[editAt].id : '', title: form.title.trim(), kind: form.kind, focus: form.focus.trim(), out: form.kind === 'make' ? form.out : '', custom: true };
        if (!s.title || !s.focus) { msg.textContent = !s.title ? 'Give the step a title.' : 'Say what the agent should do.'; return; }
        if (editAt >= 0) state.stages[editAt] = s; else state.stages.splice(Math.min(Number(at.value), state.stages.length), 0, s);
        stepKeep.clear(); form = { ...BLANK }; editAt = -1; stepBox.hidden = true; draw();
      };
      kind.addEventListener('change', () => { out.disabled = kind.value === 'gate'; });
      out.disabled = form.kind === 'gate';
      stepBox.replaceChildren(
        h('label.re-field', h('span', editAt >= 0 ? 'Change this step' : 'A new step'), title),
        h('label.re-field', h('span', 'Who does it'), kind),
        h('label.re-field', h('span', 'What the agent should do'), focus),
        h('label.re-field', h('span', 'Files it must leave (optional)'), out),
        editAt < 0 ? h('label.re-field', h('span', 'Where it goes'), at) : null,
        msg,
        h('div.re-step-btns', h('button.calm.small', { type: 'button', on: { click: () => { stepBox.hidden = true; } } }, 'Close'),
          h('button.go.small', { type: 'button', on: { click: done } }, editAt >= 0 ? 'Update step' : 'Add step')));
    }
    function draw() {
      save();
      const whoOf = (s) => (s.custom ? (s.kind === 'gate' ? 'you' : 'agent') : (pool.find((x) => x.id === s.id) || {}).who || 'you');
      rows.replaceChildren(...state.stages.map((s, i) => {
        const who = whoOf(s);
        const title = h('input', { type: 'text', value: s.title, maxlength: 60, 'aria-label': `Name of stage ${i + 1}` });
        title.addEventListener('input', () => { s.title = title.value; save(); check(); });
        const edit = s.custom ? h('button.calm.small.icon-only', { type: 'button', title: 'Change this step', 'aria-label': `Change ${s.title}`, on: { click: () => openStep(i) } }, '✎') : null;
        return h('div.re-row', h('span.re-n', `${i + 1}`), h('span.re-who.' + (who === 'agent' ? 're-a' : 're-y'), who === 'agent' ? 'agent' : 'you'), title, edit,
          h('button.calm.small.icon-only', { type: 'button', title: 'Move up', 'aria-label': `Move ${s.title} up`, disabled: i === 0, on: { click: () => move(i, -1) } }, '↑'),
          h('button.calm.small.icon-only', { type: 'button', title: 'Move down', 'aria-label': `Move ${s.title} down`, disabled: i === state.stages.length - 1, on: { click: () => move(i, 1) } }, '↓'),
          h('button.calm.small.icon-only', { type: 'button', title: s.custom ? 'Remove this step' : 'Drop this stage', 'aria-label': `Drop ${s.title}`, on: { click: () => { state.stages.splice(i, 1); editAt = -1; stepBox.hidden = true; draw(); } } }, '✕'));
      }));
      const out = pool.filter((s) => !state.stages.some((x) => x.id === s.id));
      addSel.replaceChildren(h('option', { value: '' }, out.length ? 'Add a stage back…' : 'Every stage is in'), ...out.map((s) => h('option', { value: s.id }, `${s.title} (${s.who === 'agent' ? 'agent' : 'you'})`)));
      addSel.disabled = !out.length;
      bar.replaceChildren(stageBar(state.stages.map((s) => ({ title: s.title, who: whoOf(s) }))));
      check();
    }
    addSel.addEventListener('change', () => { const s = pool.find((x) => x.id === addSel.value); if (s) { state.stages.push({ id: s.id, title: s.title }); draw(); } });
    name.addEventListener('input', () => { state.name = name.value; save(); check(); });
    const newBtn = h('button.calm.small', { type: 'button', on: { click: () => openStep(-1) } }, '+ New step');
    drawStep();
    stepBox.hidden = !(form.title || form.focus); // a step you were writing when the box closed is still there
    draw();
    const ok = await ask({
      title: editing ? `Change “${card.name}”` : card.mine ? `Copy “${card.name}”` : `Your own version of “${card.name}”`,
      body: [h('p.muted', editing ? 'Rename it, drop stages, put them in another order, or write a step of your own. Projects you make from it follow this list.' : 'This makes a copy under a name of your own, and you can write steps of your own into it. The recipe it came from stays as it is.'),
        h('label.re-field', h('span', 'Name'), name), rows, h('div.re-add', addSel, newBtn), stepBox, bar, bad],
      ok: editing ? 'Save' : 'Save as my recipe', focus: name, check: () => (problems[0] ? 'Fix what is marked in red first.' : null),
    });
    if (!ok) { stepKeep.flush(); keep.flush(); return null; }
    try { const r = await app.api('/api/recipes', body()); keep.clear(); stepKeep.clear(); app.toast(`“${r.recipe.name}” is saved. It is in the recipe cards.`, 'ok'); return r.recipe; }
    catch (e) { app.toast('Could not save it: ' + e.message, 'error'); }
  }
}
