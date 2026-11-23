// Recipes: the cards of the New project box and your own recipes.
//   GET  /api/recipes               -> { recipes: [card], kinds }  (shipped and yours, with the stage bar, who does what, a rough time and cost)
//   POST /api/recipes/check         { name, from, stages: [{ id, title? }], id? } -> { errors: [sentence] }  (what the runner would refuse)
//   POST /api/recipes               the same body: saves it as yours in data/craft/recipes/<id>.json -> { recipe } | 400 { errors }
//   POST /api/recipes/delete        { id }  (yours only, and only when no project uses it)
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../projects.js';
import { stageStats, estimate, roughTime, roughCost } from '../recipe-card.js';
import { recipeId, buildStages, validate, whoDoes, savedRecipe } from '../recipe-edit.js';
import { isAgent } from '../stages.js';

const need = (ctx) => { if (!ctx.projects) throw Object.assign(new Error('projects are not available'), { status: 503 }); return ctx.projects; };
const mineDir = (ctx) => path.join(ctx.dataDir, 'craft', 'recipes');
const isMine = (ctx, id) => fs.existsSync(path.join(mineDir(ctx), `${id}.json`));
const ICON = { long: 'scissors', short: 'phone' };

// pure: one recipe as the card needs it
export function cardOf(r, { stats, mine, usedBy, root }) {
  const est = estimate(r, stats);
  const who = whoDoes(r);
  const c = r.card || {};
  return {
    id: r.id, name: r.name, about: r.about || '', format: r.format || '', formats: Array.isArray(r.formats) ? r.formats : undefined, mine, from: r.from || null, usedBy,
    icon: c.icon || ICON[r.format] || 'film',
    stages: r.stages.map((s) => ({ id: s.id, title: s.title || s.id, kind: s.kind, who: isAgent(s.kind) ? 'agent' : 'you', heavy: !!s.heavy, lock: !!(s.lock && s.lock.length), ...(s.custom ? { custom: true, focus: s.focus || '', out: s.out || [] } : {}) })),
    // the lines of the card: hand-written for a shipped recipe, else the stage titles of the changed list
    lines: [
      c.bring ? { label: 'You bring', text: c.bring } : null,
      c.you ? { label: 'You do', text: c.you } : who.you.length ? { label: 'Your stages', text: who.you.join(', ') + '.' } : null,
      c.agent ? { label: 'The agent', text: c.agent } : who.agent.length ? { label: 'Agent stages', text: who.agent.join(', ') + '.' } : null,
    ].filter(Boolean),
    pool: mine && root ? root.stages.map((s) => ({ id: s.id, title: s.title || s.id, kind: s.kind, who: isAgent(s.kind) ? 'agent' : 'you' })) : null,
    topic: r.needs?.topic || null, start: c.start || null,
    estimate: est.measured ? { time: roughTime(est.ms), cost: roughCost(est.cost), measured: est.measured, total: est.total, missing: est.missing } : { time: '', cost: '', measured: 0, total: est.total, missing: est.missing },
  };
}

// the recipe a request describes, checked: { recipe, errors }
function build(ctx, b) {
  const craft = need(ctx).craft, all = craft.recipes();
  const editing = b.id && isMine(ctx, b.id) ? b.id : null;
  const src = all[b.from] || (editing && all[editing]);
  if (!src) return { errors: ['Pick the recipe to copy.'] };
  const root = src.from && all[src.from] ? all[src.from] : src;
  const pool = [...root.stages, ...src.stages.filter((s) => !root.stages.some((x) => x.id === s.id))];
  const id = editing || recipeId(b.name, Object.keys(all));
  const stages = buildStages(b.stages, pool, Object.values(all).filter((r) => !isMine(ctx, r.id)).flatMap((r) => r.stages.map((s) => s.id)));
  const recipe = savedRecipe({ id, name: b.name, about: `Your own version of "${root.name}", with ${stages.length} stage${stages.length === 1 ? '' : 's'}.`, from: root.id, base: root, stages });
  const errors = validate(recipe, craft.kinds(), { taken: Object.keys(all), editing });
  return { recipe, errors, editing };
}
const using = (ctx, id) => need(ctx).list().filter((p) => p.recipe === id);

export default [
  { method: 'GET', path: '/api/recipes', handler: async (req, res, ctx) => {
    const pr = need(ctx), stats = stageStats(pr.list()), all = pr.recipes();
    const list = pr.list();
    const recipes = Object.values(pr.recipes()).map((r) => cardOf(r, { stats, mine: isMine(ctx, r.id), usedBy: list.filter((p) => p.recipe === r.id).length, root: all[r.from] }));
    recipes.sort((a, b) => Number(a.mine) - Number(b.mine));
    ctx.send(res, 200, { recipes, kinds: pr.craft.kinds() });
  } },
  { method: 'POST', path: '/api/recipes/check', handler: async (req, res, ctx) => {
    const { errors, recipe } = build(ctx, await ctx.readJson(req));
    ctx.send(res, 200, { errors, stages: recipe?.stages?.length || 0 });
  } },
  { method: 'POST', path: '/api/recipes', handler: async (req, res, ctx) => {
    const b = await ctx.readJson(req);
    const { recipe, errors, editing } = build(ctx, b);
    if (errors.length) return ctx.send(res, 400, { error: errors[0], errors });
    if (editing && using(ctx, editing).length) return ctx.send(res, 400, { error: 'Projects already use this recipe, so its stages cannot change. Copy it and change the copy.', errors: ['Projects already use this recipe.'] });
    writeJsonAtomic(path.join(mineDir(ctx), `${recipe.id}.json`), recipe);
    ctx.send(res, 200, { recipe: cardOf(recipe, { stats: {}, mine: true, usedBy: 0 }) });
  } },
  { method: 'POST', path: '/api/recipes/delete', handler: async (req, res, ctx) => {
    const b = await ctx.readJson(req);
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(String(b.id || '')) || !isMine(ctx, b.id)) return ctx.send(res, 404, { error: 'That is not one of your recipes.' });
    const n = using(ctx, b.id).length;
    if (n) return ctx.send(res, 409, { error: `${n} project${n === 1 ? ' uses' : 's use'} this recipe. Move ${n === 1 ? 'it' : 'them'} to the Bin first.` });
    fs.rmSync(path.join(mineDir(ctx), `${b.id}.json`), { force: true });
    ctx.send(res, 200, { ok: true });
  } },
];
