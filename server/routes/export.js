// GET /api/export/:id -> { files, has, shorts: [{ id, title, files, has }] }: what is exported and what can be, for the
// project and for each of its cut Shorts (their workshops are shorts/<id>/video, so a Short exports like a project).
// POST /api/export/:id { kind: mp4|srt|fcpxml|otio, short? } -> { kind, file, url, size, ms, note }. The file is read
// through GET /api/media/:id/<file> (a Short's files are under shorts/<id>/).
// GET also answers presets, the last folder, the history (newest first) and the render that is running. More:
//   POST /api/export/:id/render { preset, folder, short?, all? } -> 202 { job } | { started: n }: a preset (presets.js) into a folder, in the
//        background, progress as { type: 'export', job } messages; all: every kept Short (cut, not marked Redo) one after the other
//   POST /api/export/:id/cancel { job } ; POST /api/export/:id/reveal { file }: show a file of the history in the system's file manager
import fs from 'node:fs';
import path from 'node:path';
import { exportProject, listExports } from '../export/index.js';
import { spawn } from 'node:child_process';
import { readMoments } from '../../web/shorts/list.js';
import { createRenders } from '../export/render.js';
import { readHistory, readSettings } from '../export/history.js';
import { presetList } from '../export/presets.js';
import { readCutReview } from '../shorts-cut.js';

const PATH = /^\/api\/export\/(?<id>[a-z0-9][a-z0-9_-]{0,79})$/i;
const SHORT = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const url = (id, file) => `/api/media/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// the cut Shorts of a project: shorts/<id>/video/out with a final or a rough, titled from the picks
function shortsOf(dir) {
  let ids = [];
  try { ids = fs.readdirSync(path.join(dir, 'shorts'), { withFileTypes: true }).filter((d) => d.isDirectory() && SHORT.test(d.name)).map((d) => d.name); } catch {}
  const out = path.join;
  const has = (id) => ['final.mp4', 'rough.mp4'].some((f) => fs.existsSync(out(dir, 'shorts', id, 'video', 'out', f)));
  const titles = Object.fromEntries(readMoments(readJson(path.join(dir, 'studio', 'shorts', 'picks.json'))).list.map((m) => [m.id, m.title]));
  return ids.filter(has).map((id) => ({ id, title: titles[id] || id }));
}
let renders = null;
const R = (ctx) => (renders ||= createRenders({ broadcast: ctx.broadcast }));
const SUB = (tail) => new RegExp(`^/api/export/(?<id>[a-z0-9][a-z0-9_-]{0,79})/${tail}$`, 'i');
const title = (dir) => readJson(path.join(dir, 'project.json'))?.title || path.basename(dir);
// the kept Shorts: cut, and not marked Redo
const keptShorts = (dir) => { const rv = readCutReview(dir); return shortsOf(dir).filter((s) => rv?.[s.id]?.status !== 'redo'); };
function reveal(file) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [`/select,${path.normalize(file)}`]] : process.platform === 'darwin' ? ['open', ['-R', file]] : ['xdg-open', [path.dirname(file)]];
  try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }); p.on('error', () => {}); p.unref(); return true; } catch { return false; }
}
const prefix = (sid) => (sid ? `shorts/${sid}/` : '');

export default [
  {
    method: 'GET',
    path: PATH,
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      const dir = ctx.projectDir(id);
      const r = listExports(dir);
      const shorts = shortsOf(dir).map((s) => {
        const e = listExports(path.join(dir, 'shorts', s.id));
        return { ...s, has: e.has, files: e.files.map((f) => ({ ...f, file: prefix(s.id) + f.file, url: url(id, prefix(s.id) + f.file) })) };
      });
      const kept = new Set(keptShorts(dir).map((k) => k.id));
      ctx.send(res, 200, { ...r, files: r.files.map((f) => ({ ...f, url: url(id, f.file) })), shorts: shorts.map((s) => ({ ...s, kept: kept.has(s.id) })),
        presets: presetList(), folder: readSettings(dir).folder || '', history: readHistory(dir), render: R(ctx).active(id) });
    },
  },
  {
    method: 'POST', path: SUB('render'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id, dir = ctx.projectDir(id), body = await ctx.readJson(req);
      const r = R(ctx);
      const one = (sid, batch) => r.start({ project: id, projectDir: dir, base: sid ? path.join(dir, 'shorts', sid) : dir, short: sid, preset: body.preset, folder: body.folder, title: title(dir), batch });
      if (body.all) {
        const list = keptShorts(dir);
        if (!list.length) return ctx.send(res, 404, { error: 'No Short is cut and kept yet.' });
        const first = await one(list[0].id, { n: 1, of: list.length });
        (async () => {
          let cur = first;
          for (let i = 1; i <= list.length; i++) {
            const done = await r.wait(cur.id);
            if (done?.state !== 'done' || i === list.length) break;
            try { cur = await one(list[i].id, { n: i + 1, of: list.length }); } catch (e) { ctx.broadcast({ type: 'toast', project: id, text: `Export: ${e.message}`, kind: 'error' }); break; }
          }
        })();
        return ctx.send(res, 202, { started: list.length, job: first });
      }
      const sid = body.short ? String(body.short) : '';
      if (sid && (!SHORT.test(sid) || !shortsOf(dir).some((s) => s.id === sid))) return ctx.send(res, 404, { error: `no cut Short "${sid}"` });
      ctx.send(res, 202, { job: await one(sid) });
    },
  },
  { method: 'POST', path: SUB('cancel'), handler: async (req, res, ctx) => { const b = await ctx.readJson(req); ctx.send(res, 200, { job: R(ctx).cancel(String(b.job || '')) }); } },
  {
    method: 'POST', path: SUB('reveal'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id, dir = ctx.projectDir(id), b = await ctx.readJson(req);
      const file = path.resolve(String(b.file || ''));
      const known = readHistory(dir).some((e) => path.resolve(e.file) === file) || path.relative(dir, file).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(dir, file));
      if (!known || !fs.existsSync(file)) return ctx.send(res, 404, { error: 'That file is not there any more.' });
      ctx.send(res, 200, { ok: reveal(file) });
    },
  },
  {
    method: 'POST',
    path: PATH,
    handler: async (req, res, ctx) => {
      const id = ctx.params.id;
      const body = await ctx.readJson(req);
      const sid = body.short ? String(body.short) : '';
      if (sid && (!SHORT.test(sid) || !shortsOf(ctx.projectDir(id)).some((s) => s.id === sid))) return ctx.send(res, 404, { error: `no cut Short "${sid}"` });
      const base = sid ? path.join(ctx.projectDir(id), 'shorts', sid) : ctx.projectDir(id);
      const r = await exportProject(base, String(body.kind || ''));
      const file = prefix(sid) + r.file;
      if (r.kind !== 'mp4') ctx.broadcast({ type: 'files', project: id, paths: [file] });
      ctx.send(res, 200, { ...r, file, short: sid || undefined, url: url(id, file) });
    },
  },
];
