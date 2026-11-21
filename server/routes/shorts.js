// The Shorts of a project.
//   GET  /api/shorts/:id -> { source, from, shorts: [moment + status + note + cut + cutStatus + cutNote], counts, hasRough,
//        cut: { do, why } (what "Cut these" does now), review: reviewPlan or { error }, made: [Shorts projects made from
//        this one], madeFrom: { project, title } | null, fromEdit: { ok } | { error } (can Shorts come from this edit) }
//   POST /api/shorts/:id { short, status?: 'keep'|'drop'|null, note? }: a pick choice, saved at once to studio/shorts-review.json
//   POST /api/shorts/:id/cut: "Cut these": approves the picks with your choices and starts the cutting (or says it waits in line)
//   POST /api/shorts/:id/cut-review { short, status?: 'ok'|'redo'|null, note? }: your review of one cut Short
//   POST /api/shorts/:id/review: the Review stage's answer from those: approve, or send back the Shorts marked redo
//   POST /api/shorts/:id/from-edit { go? }: a new "Shorts from a long video" project from this edit: its rough, final and
//        words linked in (no upload, no transcribing again); go: true starts picking at once
// The moments are the agent's (studio/shorts/picks.json, older shapes too); the choices are the user's, kept in
// studio/shorts-review.json and mirrored into the picks file as chosen/note for the cutting stage (web/shorts/list.js).
import fs from 'node:fs';
import path from 'node:path';
import { FILES, SOURCES, readMoments, merge, applyChoice, counts, withChoices, choiceNotes } from '../../web/shorts/list.js';
import { readCuts, readCutReview, withCuts, strayCuts, applyCutChoice, reviewPlan, cutAction, linkPlan, linkOrCopy, CUT_REVIEW, LINKABLE } from '../shorts-cut.js';

const PID = '(?<id>[a-z0-9][a-z0-9_-]{0,79})';
const PATH = new RegExp(`^/api/shorts/${PID}$`, 'i');
const SUB = (tail) => new RegExp(`^/api/shorts/${PID}/${tail}$`, 'i');
const at = (dir, rel) => path.join(dir, ...rel.split('/'));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const known = (ctx, id) => { if (!ctx.projects?.exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); return ctx.projects.get(id); };
const reply = (ctx, res, r) => ctx.send(res, r?.error ? 409 : 200, r);

function load(dir) {
  let doc = null, from = null;
  for (const rel of SOURCES) { doc = readJson(at(dir, rel)); if (doc) { from = rel; break; } }
  const { source, list } = readMoments(doc);
  const review = readJson(at(dir, FILES.review)) || {};
  return { source, from, doc, list, review, hasRough: fs.existsSync(at(dir, 'video/out/rough.mp4')) };
}

// the user's choices into the agent's picks file (chosen, note), when that file has the { picks } shape and differs
function mirror(dir, s, merged) {
  if (!s.from) return false;
  const next = withChoices(s.doc, merged);
  if (!next) return false;
  writeAtomic(at(dir, s.from), next);
  return true;
}

function writeAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// one write at a time per project, so two quick clicks never lose one
const queues = new Map();
function serial(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(key, next.catch(() => {}));
  return next;
}

// the picks with their cuts and your review of each
function full(dir, s = load(dir)) {
  const cuts = readCuts(dir);
  const shorts = withCuts(merge(s.list, s.review), cuts, readCutReview(dir));
  for (const x of strayCuts(s.list, cuts)) shorts.push(...withCuts([{ ...x, status: 'keep' }], cuts, readCutReview(dir)));
  return { shorts, cuts };
}
const outHas = (dir) => LINKABLE.filter((f) => fs.existsSync(path.join(dir, 'video', 'out', f)));

export default [
  {
    method: 'GET',
    path: PATH,
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      const p = known(ctx, id);
      const dir = ctx.projectDir(id);
      const s = load(dir);
      // the agent rewrote its picks after the user chose: put the choices back in
      if (Object.keys(s.review).length) await serial(dir, () => mirror(dir, load(dir), merge(load(dir).list, s.review)));
      const { shorts } = full(dir, s);
      const r = ctx.projects.recipeOf(p);
      const made = ctx.projects.list().filter((x) => x.from?.project === id).map((x) => ({ id: x.id, title: x.title, at: x.at, done: !!x.done }));
      const shortsRecipe = !!r?.stages?.some((x) => x.kind === 'options') && !!r?.stages?.some((x) => (x.out || []).includes('shorts/'));
      ctx.send(res, 200, {
        source: s.source, from: s.from, shorts, counts: counts(shorts), hasRough: s.hasRough,
        cut: r ? cutAction(p, r) : { do: 'none' }, review: reviewPlan(shorts), made,
        madeFrom: p.from ? { project: p.from.project, title: p.from.title } : null,
        fromEdit: shortsRecipe ? { error: 'This is a Shorts project already.' } : linkPlan(outHas(dir)),
      });
    },
  },
  {
    method: 'POST',
    path: PATH,
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      known(ctx, id);
      const dir = ctx.projectDir(id);
      const body = await ctx.readJson(req);
      const out = await serial(dir, () => {
        const s = load(dir);
        const review = applyChoice(s.review, s.list, { ...body, at: new Date().toISOString() });
        writeAtomic(at(dir, FILES.review), review);
        const merged = merge(s.list, review);
        return { merged, mirrored: mirror(dir, s, merged) ? s.from : null };
      }).then((r) => { if (r.mirrored) ctx.broadcast({ type: 'files', project: id, paths: [r.mirrored] }); return r.merged; });
      ctx.broadcast({ type: 'files', project: id, paths: [FILES.review] });
      ctx.send(res, 200, { ok: true, shorts: out, counts: counts(out) });
    },
  },
  // "Cut these": approve the picks with your choices, and the cutting starts (the approve chains on); or start it
  {
    method: 'POST',
    path: SUB('cut'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      const p = known(ctx, id);
      if (!ctx.runner) return ctx.send(res, 503, { error: 'the runner is not available' });
      const dir = ctx.projectDir(id);
      const merged = merge(load(dir).list, load(dir).review);
      const keep = merged.filter((m) => m.status === 'keep');
      if (!keep.length) return reply(ctx, res, { error: 'Keep at least one Short first.' });
      const a = cutAction(p, ctx.projects.recipeOf(p));
      if (a.do === 'none') return reply(ctx, res, { error: a.why });
      let r;
      if (a.do === 'approve') {
        r = await ctx.runner.approve(id, { notes: choiceNotes(merged) });
        if (r.error) return reply(ctx, res, r);
        if (!r.next) r.next = await ctx.runner.go(id); // chaining is off in the settings: "Cut these" still starts it
      } else r = { ok: true, next: await ctx.runner.go(id) };
      const n = r.next || {};
      const text = n.queued ? `Cutting ${keep.length} Short${keep.length === 1 ? '' : 's'}: ${n.text}` : n.error ? `The picks are approved, but the cutting did not start: ${n.error}` : `Cutting ${keep.length} Short${keep.length === 1 ? '' : 's'}: the agent is on it.`;
      ctx.send(res, 200, { ok: true, count: keep.length, started: !!n.ok, queued: !!n.queued, behind: n.behind, error: n.error, text });
    },
  },
  {
    method: 'POST',
    path: SUB('cut-review'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      known(ctx, id);
      const dir = ctx.projectDir(id);
      const body = await ctx.readJson(req);
      const out = await serial(dir + '#cut', () => {
        const cuts = readCuts(dir);
        const r = applyCutChoice(readCutReview(dir), Object.keys(cuts), body);
        if (r.error) return r;
        writeAtomic(at(dir, CUT_REVIEW), r.review);
        return { ok: true };
      });
      if (out.error) return ctx.send(res, 400, out);
      ctx.broadcast({ type: 'files', project: id, paths: [CUT_REVIEW] });
      const { shorts } = full(dir);
      ctx.send(res, 200, { ok: true, shorts, review: reviewPlan(shorts) });
    },
  },
  {
    method: 'POST',
    path: SUB('review'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      known(ctx, id);
      if (!ctx.runner) return ctx.send(res, 503, { error: 'the runner is not available' });
      const { shorts } = full(ctx.projectDir(id));
      const plan = reviewPlan(shorts);
      if (plan.error) return reply(ctx, res, plan);
      const r = plan.action === 'sendback' ? await ctx.runner.sendback(id, { notes: plan.notes }) : await ctx.runner.approve(id, { notes: plan.notes });
      reply(ctx, res, { ...r, action: plan.action, notes: plan.notes });
    },
  },
  {
    method: 'POST',
    path: SUB('from-edit'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      const p = known(ctx, id);
      const body = await ctx.readJson(req);
      const dir = ctx.projectDir(id);
      const plan = linkPlan(outHas(dir));
      if (plan.error) return reply(ctx, res, plan);
      const q = ctx.projects.create({ title: String(body.title || `${p.title || id}: Shorts`).slice(0, 200), recipe: String(body.recipe || 'shorts-from-long') });
      const qdir = ctx.projectDir(q.id);
      const how = {};
      for (const f of plan.link) how[f] = linkOrCopy(path.join(dir, 'video', 'out', f), path.join(qdir, 'video', 'out', f));
      for (const f of plan.copy) { fs.mkdirSync(path.join(qdir, 'video', 'out'), { recursive: true }); fs.copyFileSync(path.join(dir, 'video', 'out', f), path.join(qdir, 'video', 'out', f)); how[f] = 'copy'; }
      if (fs.existsSync(path.join(dir, 'brief.md'))) { try { fs.copyFileSync(path.join(dir, 'brief.md'), path.join(qdir, 'source-brief.md')); } catch {} }
      const files = plan.files.map((f) => `video/out/${f}${plan.link.includes(f) ? ' (shared with the edit: read it, never write to it)' : ''}`).concat(fs.existsSync(path.join(qdir, 'source-brief.md')) ? ['source-brief.md (the brief of the edit)'] : []);
      const saved = ctx.projects.update(q.id, (x) => ({ ...x, from: { project: id, title: p.title || id, files, at: new Date().toISOString() } }));
      ctx.projects.log(q.id, { stage: 'from', status: 'linked', from: id, files: how });
      ctx.projects.log(id, { stage: 'shorts', status: 'shorts project', project: q.id });
      ctx.broadcast({ type: 'files', project: id, paths: ['shorts'] });
      let next = null;
      if (body.go && ctx.runner) next = await ctx.runner.go(q.id);
      ctx.send(res, 200, { ok: true, project: saved, linked: how, next });
    },
  },
];
