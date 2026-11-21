// Managing the footage of a project (the media bin): add a file by its path (copy it in, or link it in place), rename, replace,
// relink a missing file, remove. Every answer is the new list: GET /api/projects/:id/footage ({ files }, projects.js).
//   POST /api/projects/:id/footage/add     { path, mode?: 'copy'|'link' }   (no mode: link above 200 MB, else copy)
//   POST /api/projects/:id/footage/rename  { name, to }                     (the edit list follows the new name)
//   POST /api/projects/:id/footage/replace { name, path?, mode?, with? }    (keeps the name; `with`: a file just uploaded)
//   POST /api/projects/:id/footage/relink  { name, path }                   (a linked file that moved)
//   POST /api/projects/:id/footage/remove  { name }                         (a link is only forgotten, a copy is deleted)
//   GET  /api/projects/:id/footage/probe?path=  -> { size, mode } | { error }  (the size of a file and the way it should be added by default)
//   GET  /api/projects/:id/footage/check?name=  -> { used: [source keys], rough: bool }  (what the edit would lose)
import fs from 'node:fs';
import { cleanPath, defaultMode, addByPath, renameFootage, replaceFootage, relink, removeFootage, listFootage, dependents } from '../footage.js';

const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const P = (tail) => new RegExp(`^/api/projects/${ID}/footage/${tail}$`, 'i');
const known = (ctx, id) => { if (!ctx.projects?.exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); return ctx.projectDir(id); };
const plain = (n) => typeof n === 'string' && n && !/[\/]/.test(n) && !n.startsWith('.');
const nameOf = (b) => { if (!plain(b.name)) throw Object.assign(new Error('name a file of the footage'), { status: 400 }); return b.name; };

// each action: (dir, body) -> its own answer; the route adds the new list and tells the screens
const act = (tail, text, fn) => ({ method: 'POST', path: P(tail), handler: async (req, res, ctx) => {
  const id = ctx.params[0], dir = known(ctx, id), b = await ctx.readJson(req);
  const r = fn(dir, b);
  ctx.projects.log(id, { stage: 'footage', status: text, files: [r.name] });
  ctx.broadcast({ type: 'files', project: id, paths: [`video/footage/${r.name}`, 'video/out/edl.json'] });
  ctx.send(res, 200, { ...r, files: listFootage(dir) });
} });

export default [
  act('add', 'added by path', (dir, b) => addByPath(dir, b.path, { mode: b.mode })),
  act('rename', 'renamed', (dir, b) => renameFootage(dir, nameOf(b), String(b.to || ''))),
  act('replace', 'replaced', (dir, b) => replaceFootage(dir, nameOf(b), { path: b.path, mode: b.mode, with: b.with })),
  act('relink', 'relinked', (dir, b) => relink(dir, nameOf(b), b.path)),
  act('remove', 'removed', (dir, b) => removeFootage(dir, nameOf(b))),
  { method: 'GET', path: P('probe'), handler: async (req, res, ctx) => {
    known(ctx, ctx.params[0]);
    const c = cleanPath(ctx.query.get('path') || '');
    if (c.error) return ctx.send(res, 200, { error: c.error });
    try { const st = fs.statSync(c.path); if (!st.isFile()) return ctx.send(res, 200, { error: 'That path is a folder, not a recording.' }); ctx.send(res, 200, { size: st.size, mode: defaultMode(st.size) }); } catch { ctx.send(res, 200, { error: 'That file is not there.' }); }
  } },
  { method: 'GET', path: P('check'), handler: async (req, res, ctx) => {
    const dir = known(ctx, ctx.params[0]);
    const name = ctx.query.get('name') || '';
    ctx.send(res, 200, plain(name) ? dependents(dir, name) : { keys: [], rough: false });
  } },
];
