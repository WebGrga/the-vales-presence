// The comfort routes: Undo (Studio and Context changes), what the agents cost, the queue across projects, what Go will
// do before it does it, and "Stop after this stage".
//   GET  /api/undo?scope=<project id | context>   -> { entries: [{ label, at }] } newest first
//   POST /api/undo { scope }                       -> { ok, label } | 409
//   GET  /api/spend                                -> { today, month, days, months, projects, plan, limits, over }
//   GET  /api/queue                                -> { running, waitingForYou, inLine, slots, empty }
//   GET  /api/projects/:id/go-info                 -> { info } (null when the current stage is not the agent's)
//   POST /api/projects/:id/stop-after { on }       -> { ok, stopAfter }
import { over } from '../spend.js';
import { describe } from '../queue-view.js';
import { cleanSettings } from '../agent-util.js';
import fs from 'node:fs';
import path from 'node:path';

const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const P = (tail) => new RegExp(`^/api/projects/${ID}${tail}$`, 'i');
const runner = (ctx) => { if (!ctx.runner) throw Object.assign(new Error('the runner is not available'), { status: 503 }); return ctx.runner; };
const known = (ctx, id) => { if (!ctx.projects?.exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); };
const scopeOf = (v) => { const s = String(v || ''); if (s !== 'context' && !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(s)) throw Object.assign(new Error('bad scope'), { status: 400 }); return s; };
const settings = (ctx) => { try { return cleanSettings(JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'settings.json'), 'utf8'))); } catch { return cleanSettings(null); } };

export default [
  { method: 'GET', path: '/api/undo', handler: async (req, res, ctx) => ctx.send(res, 200, { entries: ctx.undo.list(scopeOf(ctx.query.get('scope'))) }) },
  { method: 'POST', path: '/api/undo', handler: async (req, res, ctx) => {
    const b = await ctx.readJson(req);
    const r = ctx.undo.undo(scopeOf(b.scope));
    ctx.send(res, r.error ? 409 : 200, r);
  } },
  { method: 'GET', path: '/api/spend', handler: async (req, res, ctx) => {
    const sum = runner(ctx).summary();
    const cfg = settings(ctx);
    ctx.send(res, 200, { ...sum, limits: { warnDay: cfg.warnDay, warnMonth: cfg.warnMonth }, over: over(sum, cfg), live: !!ctx.agent });
  } },
  { method: 'GET', path: '/api/queue', handler: async (req, res, ctx) => {
    const o = runner(ctx).overview();
    ctx.send(res, 200, describe(o.rows, { limit: o.limit }));
  } },
  { method: 'GET', path: P('/go-info'), handler: async (req, res, ctx) => { known(ctx, ctx.params[0]); ctx.send(res, 200, { info: runner(ctx).goInfo(ctx.params[0]) }); } },
  { method: 'POST', path: P('/stop-after'), handler: async (req, res, ctx) => {
    known(ctx, ctx.params[0]);
    const b = await ctx.readJson(req);
    const r = runner(ctx).setStopAfter(ctx.params[0], b.on !== false);
    ctx.send(res, r.error ? 409 : 200, r);
  } },
];
