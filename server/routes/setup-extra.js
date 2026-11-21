// What Setup and Settings add: the data folder, a report to copy, and the yt-dlp install.
//   GET  /api/data-folder          -> { path, projects } (read-only)
//   POST /api/data-folder/open     shows the folder in the file manager
//   GET  /api/doctor/report        -> { text } the versions and checks, no personal paths
//   POST /api/doctor/install-ytdlp -> { ok, text } | 409 { error }; then asks the doctor again
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { doctor } from '../doctor/index.js';
import { reportText } from '../doctor/report.js';
import { installYtDlp } from '../doctor/install.js';
import { run } from '../doctor/checks.js';
import { revealCommand } from '../project-manage.js';

let installing = false;

export default [
  { method: 'GET', path: '/api/data-folder', handler: async (req, res, ctx) => {
    let projects = 0;
    try { projects = fs.readdirSync(path.join(ctx.dataDir, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory()).length; } catch {}
    ctx.send(res, 200, { path: ctx.dataDir, projects });
  } },
  { method: 'POST', path: '/api/data-folder/open', handler: async (req, res, ctx) => {
    const { cmd, args } = revealCommand(process.platform, ctx.dataDir);
    try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }); p.on('error', () => {}); p.unref(); } catch (e) { throw Object.assign(new Error('could not open the folder: ' + e.message), { status: 500 }); }
    ctx.send(res, 200, { ok: true });
  } },
  { method: 'GET', path: '/api/doctor/report', handler: async (req, res, ctx) => {
    const d = await doctor({ root: ctx.root, dataDir: ctx.dataDir });
    let app = ''; try { app = JSON.parse(fs.readFileSync(path.join(ctx.root, 'package.json'), 'utf8')).version || ''; } catch {}
    let user = ''; try { user = os.userInfo().username; } catch {}
    ctx.send(res, 200, { text: reportText(d, { app, node: process.versions.node, platform: process.platform, arch: process.arch, home: os.homedir(), user, folders: { app: ctx.root, data: ctx.dataDir } }) });
  } },
  { method: 'POST', path: '/api/doctor/install-ytdlp', handler: async (req, res, ctx) => {
    if (installing) return ctx.send(res, 409, { error: 'An install is already running.' });
    installing = true;
    try {
      const r = await installYtDlp(run);
      if (r.error) return ctx.send(res, 409, { error: r.error });
      await doctor({ root: ctx.root, dataDir: ctx.dataDir, fresh: true });
      ctx.send(res, 200, r);
    } finally { installing = false; }
  } },
];
