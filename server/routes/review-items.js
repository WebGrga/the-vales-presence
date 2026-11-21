// Review items (server/review-items.js): GET the agent's "look at this" points with your marks; POST one mark.
//   GET  /api/projects/:id/review-items[?short=s3]  -> { items: [{ id, at, to, kind, text, source, on, done, mark }], file }
//   POST /api/projects/:id/review-items { id, done?, note?, short? } -> { ok, items }
import path from 'node:path';
import { readItems, writeMarks, applyMark, ITEMS_FILE } from '../review-items.js';

const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const P = new RegExp(`^/api/projects/${ID}/review-items$`, 'i');
const SHORT = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const known = (ctx, id) => { if (!ctx.projects?.exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); };
// the folder whose video/out holds the items: the project, or one Short's workshop
function baseOf(ctx, id, short) {
  const dir = ctx.projectDir(id);
  if (!short) return { base: dir, file: ITEMS_FILE };
  if (!SHORT.test(String(short))) throw Object.assign(new Error('bad Short id'), { status: 400 });
  return { base: path.join(dir, 'shorts', String(short)), file: `shorts/${short}/${ITEMS_FILE}` };
}

export default [
  { method: 'GET', path: P, handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const short = ctx.query.get('short');
    const { base, file } = baseOf(ctx, id, short);
    ctx.send(res, 200, { items: readItems(base, { inspect: !short }).items, file });
  } },
  { method: 'POST', path: P, handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const b = await ctx.readJson(req);
    const { base } = baseOf(ctx, id, b.short);
    const cur = readItems(base, { inspect: !b.short });
    const patch = {}; if ('done' in b) patch.done = b.done; if ('note' in b) patch.note = b.note;
    const r = applyMark(cur.marks, cur.items.map((x) => x.id), String(b.id || ''), patch);
    if (r.error) return ctx.send(res, 400, r);
    writeMarks(base, r.marks);
    const items = readItems(base, { inspect: !b.short }).items;
    ctx.broadcast({ type: 'review-items', project: id, short: b.short || undefined, id: b.id });
    ctx.send(res, 200, { ok: true, items });
  } },
];
