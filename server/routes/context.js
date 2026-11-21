// The Context room's routes (part E): the agent's whole context as a map, read and edited in place. Every item is
// named by an id and found through the scan (server/context/scan.js); no route takes a path. Writes go to data/craft/
// (craft/ is the shipped default) with the day's first backup in data/backups/, and broadcast { type: 'context' }.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../context/scan.js';
import { buildMap } from '../context/graph.js';
import { readNode, saveNode, resetNode, newSkill, toggleSkill, resetStageSkills, countLesson, saveDraft, readDraft } from '../context/store.js';
import { stageContext } from '../context/stage-context.js';
import { watchCraft } from '../context/watch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const route = (p) => new RegExp('^' + p.replace(/\//g, '\\/') + '(?:\\?.*)?$');
const query = (req) => new URL(req.url, 'http://x').searchParams;

// the scan's options for this request: the app's folders, plus the open project and recipe (ids, checked by the scan)
function opts(ctx, a) {
  const root = ctx.root || ROOT;
  return { root, dataDir: ctx.dataDir || path.join(root, 'data'), home: ctx.home, projectId: a.project ? String(a.project) : null, recipeId: a.recipe ? String(a.recipe) : null };
}
const fromQuery = (req) => Object.fromEntries(query(req));
const send = (ctx, res, r) => ctx.send(res, r?.error ? 400 : 200, r);

async function body(ctx, req) {
  try { return (await ctx.readJson(req)) || {}; } catch { return {}; }
}

// a POST that changes the context: run it, tell every window, answer
const write = (fn) => async (req, res, ctx) => {
  const a = await body(ctx, req);
  let r;
  try { r = fn(opts(ctx, a), a); } catch (e) { r = { error: 'that could not be done: ' + e.message }; }
  if (r?.ok) ctx.broadcast?.({ type: 'context' });
  send(ctx, res, r);
};

export default [
  { method: 'GET', path: route('/api/context'), handler: async (req, res, ctx) => {
    const a = fromQuery(req), o = opts(ctx, a);
    watchCraft([path.join(o.root, 'craft'), path.join(o.dataDir, 'craft')], ctx.broadcast);
    try { ctx.send(res, 200, { ok: true, ...buildMap(scan(o)) }); } catch (e) { ctx.send(res, 500, { error: 'the context could not be read: ' + e.message }); }
  } },
  { method: 'GET', path: route('/api/context/node'), handler: async (req, res, ctx) => {
    const a = fromQuery(req);
    send(ctx, res, readNode(opts(ctx, a), a.id));
  } },
  { method: 'GET', path: route('/api/context/stage'), handler: async (req, res, ctx) => {
    const a = fromQuery(req), o = opts(ctx, a), s = scan(o);
    if (!s.recipe?.stages.some((x) => x.id === a.stage)) return send(ctx, res, { error: 'that stage is not in this recipe' });
    const c = stageContext({ ...o, recipe: s.recipe.id, stage: a.stage, create: false });
    const instructions = s.items['stage:' + a.stage]?.text || '';
    send(ctx, res, { ok: true, stage: a.stage, instructions, claude: c.claudeMd.text, text: c.text, missing: c.missing });
  } },
  { method: 'GET', path: route('/api/context/draft'), handler: async (req, res, ctx) => {
    const a = fromQuery(req);
    send(ctx, res, readDraft(opts(ctx, a), a.id));
  } },
  { method: 'POST', path: route('/api/context/save'), handler: write((o, a) => saveNode(o, a)) },
  { method: 'POST', path: route('/api/context/reset'), handler: write((o, a) => resetNode(o, a)) },
  { method: 'POST', path: route('/api/context/skill'), handler: write((o, a) => newSkill(o, a)) },
  { method: 'POST', path: route('/api/context/toggle'), handler: write((o, a) => toggleSkill(o, a)) },
  { method: 'POST', path: route('/api/context/stage-reset'), handler: write((o, a) => resetStageSkills(o, a)) },
  { method: 'POST', path: route('/api/context/lesson'), handler: write((o, a) => countLesson(o, a)) },
  // a draft changes nothing the agent reads: no broadcast
  { method: 'POST', path: route('/api/context/draft'), handler: async (req, res, ctx) => {
    const a = await body(ctx, req);
    let r;
    try { r = saveDraft(opts(ctx, a), a); } catch (e) { r = { error: e.message }; }
    send(ctx, res, r);
  } },
];
