// Routes for your edits of the visuals (edits.js). Loaded by server/routes/edits.js (a one-line re-export, F1's folder).
//   GET  /api/edits/:id                                         -> { redactions, eventEdits, chapters }
//   POST /api/edits/:id { file: 'redactions'|'event-edits', data } -> { ok, file, data }   written at once, a `files` broadcast follows
import { readEdits, saveEdits } from './edits.js';
import { chaptersFor } from './index.js';

const PATH = /^\/api\/edits\/(?<id>[a-z0-9][a-z0-9_-]{0,79})$/i;
const known = (ctx, id) => { if (ctx.projects && !ctx.projects.exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); };

export default [
  {
    method: 'GET', path: PATH,
    handler: async (req, res, ctx) => {
      const id = ctx.params.id; known(ctx, id);
      const dir = ctx.projectDir(id);
      ctx.send(res, 200, { ...readEdits(dir), chapters: chaptersFor(dir) });
    },
  },
  {
    method: 'POST', path: PATH,
    handler: async (req, res, ctx) => {
      const id = ctx.params.id; known(ctx, id);
      const b = await ctx.readJson(req);
      const r = saveEdits(ctx.projectDir(id), String(b.file || ''), b.data);
      ctx.broadcast({ type: 'files', project: id, paths: [r.file], edits: true });
      ctx.send(res, 200, { ok: true, ...r });
    },
  },
];
