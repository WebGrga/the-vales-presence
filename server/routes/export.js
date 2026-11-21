// GET /api/export/:id -> { files, has, shorts: [{ id, title, files, has }] }: what is exported and what can be, for the
// project and for each of its cut Shorts (their workshops are shorts/<id>/video, so a Short exports like a project).
// POST /api/export/:id { kind: mp4|srt|fcpxml|otio, short? } -> { kind, file, url, size, ms, note }. The file is read
// through GET /api/media/:id/<file> (a Short's files are under shorts/<id>/).
import fs from 'node:fs';
import path from 'node:path';
import { exportProject, listExports } from '../export/index.js';
import { readMoments } from '../../web/shorts/list.js';

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
      ctx.send(res, 200, { ...r, files: r.files.map((f) => ({ ...f, url: url(id, f.file) })), shorts });
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
