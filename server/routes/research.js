// The Research page's routes: search from the chosen phrases, how far it is, which runs are current, star and hide.
// A search runs yt-dlp here and never calls the agent, so it costs nothing; the agent's notes are a separate ask.
import { start, status, stopRun } from '../studio/research-run.js';
import { setCurrent, setMark } from '../studio/research-runs.js';
import { suggestPhrases } from '../studio/research-suggest.js';
import { proposePhrases, cleanPhrases, cleanOptions } from '../studio/research-plan.js';

const ID = '(?<id>[a-z0-9][a-z0-9_-]{0,79})';
const P = (tail) => new RegExp(`^/api/studio/${ID}/research${tail}$`, 'i');

export default [
  { method: 'GET', path: P('/status'), handler: async (req, res, ctx) => ctx.send(res, 200, status(ctx.params.id)) },
  { method: 'GET', path: P('/propose'), handler: async (req, res, ctx) => ctx.send(res, 200, { phrases: proposePhrases(ctx.query.get('topic')) }) },
  // the agent's phrases (one short call, a cent or two); when it cannot be reached the free ones come back, said plainly
  {
    method: 'POST', path: P('/suggest'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      const topic = String(b.topic || '').slice(0, 200);
      try { ctx.send(res, 200, { ...(await suggestPhrases(topic)), agent: true }); }
      catch (e) { ctx.send(res, 200, { phrases: proposePhrases(topic), agent: false, error: String(e.message || e).slice(0, 200) }); }
    },
  },
  {
    method: 'POST', path: P('/run'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      const id = ctx.params.id;
      const st = start({ id, dir: ctx.projectDir(id), phrases: cleanPhrases(b.phrases), options: cleanOptions(b.options) });
      ctx.send(res, 202, st);
    },
  },
  { method: 'POST', path: P('/stop'), handler: async (req, res, ctx) => ctx.send(res, 200, { stopping: stopRun(ctx.params.id) }) },
  {
    method: 'POST', path: P('/use'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      ctx.send(res, 200, { current: await setCurrent(ctx.projectDir(ctx.params.id), b.ids) });
    },
  },
  {
    method: 'POST', path: P('/mark'),
    handler: async (req, res, ctx) => {
      const b = await ctx.readJson(req);
      const patch = {};
      if (typeof b.starred === 'boolean') patch.starred = b.starred;
      if (typeof b.hidden === 'boolean') patch.hidden = b.hidden;
      ctx.send(res, 200, await setMark(ctx.projectDir(ctx.params.id), b.video, patch));
    },
  },
];
