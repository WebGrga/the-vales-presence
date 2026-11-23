// Your own recipes (pure): copy a shipped recipe, rename it, drop or reorder its stages, and check that the runner would
// accept the result. The rules mirror what server/stages.js does with a recipe: a gate or a pick needs an agent stage
// before it (its send-back goes there), a gate may only lock files an earlier stage makes (approving hashes them), ids
// are unique and every kind exists. Saved by routes/recipes.js in the user's data folder (data/craft/recipes/<id>.json).
import { isAgent, isUser } from './stages.js';

const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
export const MAX_STAGES = 30;

// pure: a recipe id from a name, not in `taken`
export function recipeId(name, taken = []) {
  const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'my-recipe';
  const t = new Set(taken);
  if (!t.has(base)) return base;
  for (let n = 2; ; n++) if (!t.has(`${base}-${n}`)) return `${base}-${n}`;
}

// pure: a step you write yourself. kind: 'make' (an agent step) or 'gate' (you check it); anything else becomes 'make'.
// `focus` is what the agent is told to do (the runner puts it in the stage prompt under "This stage"), `out` the files it
// must leave (one per line or an array). -> { id, kind, title, focus, out?, custom: true }
export const CUSTOM_KINDS = ['make', 'gate'];
export const MAX_FOCUS = 4000;
export function customStage(want, taken = []) {
  const title = String(want?.title || '').trim().slice(0, 60);
  const kind = CUSTOM_KINDS.includes(want?.kind) ? want.kind : 'make';
  const focus = String(want?.focus || '').trim().slice(0, MAX_FOCUS);
  const files = (Array.isArray(want?.out) ? want.out : String(want?.out || '').split(/[\r\n,]+/)).map((f) => String(f).trim().replace(/\\/g, '/')).filter(Boolean).slice(0, 12);
  // a step you saved before keeps its id (unless a shipped stage or another step of the list has it now)
  const keep = ID.test(String(want?.id || '')) && !taken.includes(want.id);
  const s = { id: keep ? want.id : recipeId(title || 'my step', taken).replace(/^my-recipe$/, 'my-step'), kind, title, focus, custom: true };
  if (kind === 'make' && files.length) s.out = files;
  return s;
}

// pure: the stages of a new recipe from a list of { id, title? }, taking each stage's definition from `pool` (the
// stages of the recipe it was copied from). A `back` that no longer points at an earlier stage is dropped (the send-back
// then goes to the nearest agent stage before it, as stages.js does). Unknown ids are reported by validate().
// An entry with `custom: true` is a step you wrote ({ title, kind, focus, out }): it gets an id from its title that no
// other stage of the list, the pool or `reserved` (every shipped stage id) uses. A gate you wrote has no lock.
export function buildStages(list, pool, reserved = []) {
  const defs = new Map((pool || []).map((s) => [s.id, s]));
  const wanted = Array.isArray(list) ? list : [];
  const fixed = new Set([...reserved, ...wanted.filter((w) => !w?.custom).map((w) => String(w?.id || ''))]);
  const out = [];
  for (const want of wanted) {
    if (want?.custom) {
      // a step saved before keeps its id; a new one takes one that nothing else uses (nor the pool, nor a saved step later in the list)
      const blocked = new Set([...fixed, ...out.map((o) => o.id)]);
      if (!want.id) for (const k of [...defs.keys(), ...wanted.filter((w) => w?.custom && w.id).map((w) => w.id)]) blocked.add(k);
      out.push(customStage(want, [...blocked]));
      continue;
    }
    const id = String(want?.id || '');
    const def = defs.get(id);
    const s = def ? JSON.parse(JSON.stringify(def)) : { id, kind: String(want?.kind || '') };
    const title = String(want?.title || '').trim().slice(0, 60);
    if (title) s.title = title;
    out.push(s);
  }
  const at = new Map(out.map((s, i) => [s.id, i]));
  out.forEach((s, i) => { if (s.back && !(at.has(s.back) && at.get(s.back) < i)) delete s.back; });
  return out;
}

// pure: what is wrong with a recipe? -> [ plain sentences ] (empty = the runner accepts it). kinds: the stage kinds.
export function validate(recipe, kinds, { taken = [], editing = null } = {}) {
  const bad = [];
  const name = String(recipe?.name || '').trim();
  if (!name) bad.push('Give the recipe a name.');
  else if (name.length > 60) bad.push('The name is longer than 60 letters.');
  if (editing == null && recipe?.id && taken.includes(recipe.id)) bad.push('A recipe with that id already exists.');
  const stages = Array.isArray(recipe?.stages) ? recipe.stages : [];
  if (!stages.length) { bad.push('A recipe needs at least one stage.'); return bad; }
  if (stages.length > MAX_STAGES) bad.push(`A recipe may have at most ${MAX_STAGES} stages.`);
  const seen = new Set(), made = new Set();
  stages.forEach((s, i) => {
    const label = `"${s.title || s.id}"`;
    if (!ID.test(String(s.id || ''))) { bad.push(`Stage ${i + 1} has no usable id.`); return; }
    if (seen.has(s.id)) bad.push(`The stage ${label} is in the recipe twice.`);
    seen.add(s.id);
    if (s.custom) {
      if (!String(s.title || '').trim()) bad.push(`Step ${i + 1} needs a title.`);
      if (!String(s.focus || '').trim()) bad.push(`The step ${label} needs words for the agent: what it should do.`);
    }
    if (!kinds?.[s.kind]) { bad.push(`The stage ${label} has an unknown kind (${s.kind || 'none'}).`); return; }
    const before = stages.slice(0, i);
    if ((s.kind === 'gate' || s.kind === 'options') && !before.some((b) => isAgent(b.kind))) {
      bad.push(`${label} reviews work, so a stage of the agent has to come before it (a send-back goes there).`);
    }
    const loose = (Array.isArray(s.lock) ? s.lock : []).filter((f) => !made.has(f));
    if (loose.length) bad.push(`${label} locks ${loose.join(' and ')}, but no stage before it makes ${loose.length === 1 ? 'that file' : 'those files'}. Put the stage that makes ${loose.length === 1 ? 'it' : 'them'} before this review, or drop this review too.`);
    for (const f of Array.isArray(s.out) ? s.out : []) made.add(f);
  });
  return bad;
}

// pure: what the stages are for you and for the agent, as short title lists (for a card without hand-written text)
export function whoDoes(recipe) {
  const list = recipe?.stages || [];
  return {
    you: list.filter((s) => isUser(s.kind)).map((s) => s.title || s.id),
    agent: list.filter((s) => isAgent(s.kind)).map((s) => s.title || s.id),
  };
}

// pure: the file a saved recipe is written as (the shipped recipe's own fields, with the new name, id and stages)
export function savedRecipe({ id, name, about, from, base, stages }) {
  const out = { id, name: String(name).trim(), about: String(about ?? base?.about ?? '').trim().slice(0, 400), format: base?.format, stages, mine: true, from: from || base?.from || base?.id };
  // the hand-written "you do / the agent does" lines describe the whole recipe: a changed list gets them from its own stages
  if (base?.card) { const { icon, bring, start } = base.card; out.card = { icon, bring, start }; }
  if (base?.needs) out.needs = base.needs;
  if (!out.format) delete out.format;
  if (Array.isArray(base?.formats)) out.formats = base.formats; // a recipe that can be a long video or a Short stays so
  return out;
}
