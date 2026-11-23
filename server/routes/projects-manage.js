// Looking after projects: rename, pin, last opened, duplicate, Bin / restore / empty, size, free space, open folder,
// poster, and a whole project as a zip (export, import). The work is in server/project-manage.js.
import fs from 'node:fs';
import path from 'node:path';
import { createManage } from '../project-manage.js';
import { posterFile } from '../project-poster.js';
import { formatBytes } from '../project-space.js';

const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const P = (tail = '') => new RegExp(`^/api/projects/${ID}${tail}$`, 'i');
const managers = new WeakMap();
const manage = (ctx) => {
  if (!ctx.projects) throw Object.assign(new Error('projects is not available'), { status: 503 });
  if (!managers.has(ctx.projects)) managers.set(ctx.projects, createManage(ctx, ctx.projects));
  return managers.get(ctx.projects);
};
const ok = (ctx, res, body = {}) => ctx.send(res, 200, { ok: true, ...body });

export default [
  { method: 'POST', path: P('/rename'), handler: async (req, res, ctx) => { const b = await ctx.readJson(req); const p = manage(ctx).rename(ctx.params[0], b.title); ok(ctx, res, { title: p.title }); } },
  { method: 'POST', path: P('/pin'), handler: async (req, res, ctx) => { const b = await ctx.readJson(req); ok(ctx, res, { pinned: !!manage(ctx).pin(ctx.params[0], b.pinned !== false).pinned }); } },
  { method: 'POST', path: P('/opened'), handler: async (req, res, ctx) => ok(ctx, res, { opened: manage(ctx).opened(ctx.params[0]).opened }) },
  { method: 'POST', path: P('/duplicate'), handler: async (req, res, ctx) => {
    const b = await ctx.readJson(req);
    const r = await manage(ctx).duplicate(ctx.params[0], { footage: ['link', 'copy', 'none'].includes(b.footage) ? b.footage : 'link', title: b.title });
    ctx.send(res, 200, { ok: true, id: r.project.id, title: r.project.title, footage: r.footage });
  } },
  { method: 'POST', path: P('/bin'), handler: async (req, res, ctx) => ok(ctx, res, await manage(ctx).toBin(ctx.params[0])) },
  { method: 'GET', path: '/api/bin', handler: async (req, res, ctx) => {
    const items = await manage(ctx).binList();
    ctx.send(res, 200, { items, bytes: items.reduce((a, x) => a + x.bytes, 0) });
  } },
  { method: 'POST', path: '/api/bin/restore', handler: async (req, res, ctx) => { const b = await ctx.readJson(req); ok(ctx, res, manage(ctx).restore(b.name)); } },
  // names: which to delete (all when empty); confirm: true is required
  { method: 'POST', path: '/api/bin/empty', handler: async (req, res, ctx) => { const b = await ctx.readJson(req); ok(ctx, res, await manage(ctx).emptyBin(b.names, b.confirm)); } },
  // every project's size at once (cached, computed when asked)
  { method: 'GET', path: '/api/projects/sizes', handler: async (req, res, ctx) => {
    const m = manage(ctx), out = {};
    await Promise.all(ctx.projects.list().map(async (p) => { try { out[p.id] = await m.size(p.id); } catch {} }));
    ctx.send(res, 200, { sizes: out });
  } },
  { method: 'GET', path: P('/size'), handler: async (req, res, ctx) => ctx.send(res, 200, await manage(ctx).size(ctx.params[0], ctx.query?.get('fresh') === '1')) },
  // what Free space would delete (nothing is deleted)
  { method: 'GET', path: P('/free'), handler: async (req, res, ctx) => {
    const plan = await manage(ctx).freePlan(ctx.params[0]);
    ctx.send(res, 200, { files: plan.files, bytes: plan.bytes, words: formatBytes(plan.bytes) });
  } },
  { method: 'POST', path: P('/free'), handler: async (req, res, ctx) => { const r = await manage(ctx).free(ctx.params[0]); ok(ctx, res, { ...r, words: formatBytes(r.bytes) }); } },
  { method: 'POST', path: P('/reveal'), handler: async (req, res, ctx) => ok(ctx, res, manage(ctx).reveal(ctx.params[0], ctx.query?.get('dry') === '1')) },
  { method: 'GET', path: P('/poster'), handler: async (req, res, ctx) => {
    manage(ctx); if (!ctx.projects.exists(ctx.params[0])) return ctx.send(res, 404, { error: 'no such project' });
    const r = await posterFile(ctx.projectDir(ctx.params[0]));
    if (r.none) return ctx.send(res, 404, { error: 'no poster' });
    ctx.sendFile(req, res, r.file, { type: 'image/jpeg' });
  } },
  { method: 'GET', path: P('/export\\.zip'), handler: async (req, res, ctx) => {
    const id = ctx.params[0];
    const zip = await manage(ctx).exportZip(id, { footage: ctx.query?.get('footage') !== '0' });
    const st = fs.statSync(zip);
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': st.size, 'content-disposition': `attachment; filename="${id}.zip"`, 'cache-control': 'no-cache' });
    const s = fs.createReadStream(zip);
    const done = () => { try { fs.rmSync(zip, { force: true }); } catch {} };
    s.on('close', done); s.on('error', () => { try { res.destroy(); } catch {} });
    res.on('close', () => s.destroy());
    s.pipe(res);
  } },
  // the raw zip as the body (Content-Type: application/zip)
  { method: 'POST', path: '/api/projects/import', handler: async (req, res, ctx) => {
    const m = manage(ctx);
    fs.mkdirSync(m.tmpDir(), { recursive: true });
    const file = path.join(m.tmpDir(), `upload-${Date.now().toString(36)}.zip`);
    try {
      await new Promise((done, fail) => { const w = fs.createWriteStream(file); req.pipe(w); w.on('finish', done); w.on('error', fail); req.on('error', fail); });
      const p = await m.importZip(file);
      ok(ctx, res, { id: p.id, title: p.title });
    } finally { try { fs.rmSync(file, { force: true }); } catch {} }
  } },
];
