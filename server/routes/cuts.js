// The Cuts list: GET cuts.json merged with your choices; POST one choice (saved at once); the working edit list.
import fs from 'node:fs';
import path from 'node:path';
import { readCuts, merge, applyChoice, writeReview, cleanWorking, workingFile } from '../cuts.js';
import { writeJsonAtomic } from '../projects.js';

const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const known = (ctx, id) => { if (!ctx.projects?.exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); };
const urlOf = (id) => (rel) => `/api/media/${id}/video/${String(rel).replace(/\\/g, '/').replace(/^\/+/, '')}`;
// save (or with null remove) video/out/edl.working.json
function saveWorking(ctx, res, id, edl) {
  const dir = ctx.projectDir(id), file = workingFile(dir);
  if (edl === null) { fs.rmSync(file, { force: true }); ctx.broadcast({ type: 'files', project: id, paths: ['video/out/edl.working.json'], working: true }); return ctx.send(res, 200, { ok: true, working: null }); }
  const w = cleanWorking(edl);
  if (w.error) return ctx.send(res, 400, w);
  writeJsonAtomic(file, w.edl);
  ctx.broadcast({ type: 'files', project: id, paths: ['video/out/edl.working.json'], working: true });
  ctx.send(res, 200, { ok: true });
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export default [
  { method: 'GET', path: new RegExp(`^/api/cuts/${ID}$`, 'i'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const c = readCuts(ctx.projectDir(id));
    if (!c) return ctx.send(res, 200, { cuts: null, order: [], review: {} });
    ctx.send(res, 200, merge(c.data, c.review, urlOf(id)));
  } },
  { method: 'POST', path: new RegExp(`^/api/cuts/${ID}$`, 'i'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const b = await ctx.readJson(req);
    if ('working' in b) return saveWorking(ctx, res, id, b.working); // { working: <edl> | null }, the same as POST .../working
    const c = readCuts(ctx.projectDir(id));
    if (!c) return ctx.send(res, 404, { error: 'this project has no cuts yet' });
    const cut = String(b.cut ?? b.id ?? '');
    const patch = {}; if ('keep' in b) patch.keep = b.keep; if ('note' in b) patch.note = b.note;
    const r = applyChoice(c.review, c.ids, cut, patch);
    if (r.error) return ctx.send(res, 400, r);
    writeReview(c, r.review);
    ctx.broadcast({ type: 'cuts', project: id, cut, choice: r.review[cut] || null });
    ctx.send(res, 200, { ok: true, cut, choice: r.review[cut] || null, review: r.review });
  } },
  // the screen's working copy of the edit list (Keep/Restore and struck words play at once)
  { method: 'GET', path: new RegExp(`^/api/cuts/${ID}/working$`, 'i'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const dir = ctx.projectDir(id);
    ctx.send(res, 200, { working: readJson(workingFile(dir)), edl: readJson(path.join(dir, 'video', 'out', 'edl.json')) });
  } },
  { method: 'POST', path: new RegExp(`^/api/cuts/${ID}/working$`, 'i'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const b = await ctx.readJson(req);
    saveWorking(ctx, res, id, b.clear === true ? null : (b.working !== undefined ? b.working : b.edl ?? b));
  } },
];
