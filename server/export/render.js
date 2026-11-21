// Renders an export preset (presets.js) of a project's video or of one cut Short into a folder you choose, with progress, and Cancel.
// One render at a time per project; each is a job { id, project, short, preset, state: 'running'|'done'|'error'|'cancelled', pct, file, ... }
// that is broadcast as { type: 'export', project, job } on every step. The finished file is written as .part and renamed, so a cancelled
// or failed render leaves nothing behind. Every finished render goes into the history (history.js).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PRESETS, presetArgs, renderName, progressSeconds, fraction, cleanFolder } from './presets.js';
import { addHistory, saveFolder } from './history.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

function duration(file) {
  return new Promise((done) => {
    let out = '';
    let p; try { p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true }); } catch { return done(0); }
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => done(0));
    p.on('close', () => done(Number(out.trim()) || 0));
  });
}

// the video of a project (or a Short's workshop): the final, else the rough
export function sourceVideo(base) {
  const o = path.join(base, 'video', 'out');
  return ['final.mp4', 'rough.mp4'].map((f) => path.join(o, f)).find((f) => fs.existsSync(f)) || null;
}

// ffmpeg may be started through a launcher (a shim) that leaves the real encoder running when it is killed: on Windows end the whole tree
function killTree(proc) {
  try {
    if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    else proc.kill('SIGKILL');
  } catch { try { proc.kill(); } catch {} }
}

export function createRenders({ broadcast = () => {} } = {}) {
  const jobs = new Map(); // id -> { job, proc }
  let seq = 0;
  const running = (project) => [...jobs.values()].find((j) => j.job.project === project && j.job.state === 'running');
  const publish = (j) => { try { broadcast({ type: 'export', project: j.project, job: { ...j } }); } catch {} };

  // start: { project, projectDir, base (the project dir, or the Short's workshop), short, preset, folder, title } -> the job (the render goes on in the background)
  async function start(o) {
    const preset = PRESETS[o.preset];
    if (!preset) throw fail(400, `preset must be one of ${Object.keys(PRESETS).join(', ')}`);
    if (running(o.project)) throw fail(409, 'A render of this project is already running: wait for it or cancel it.');
    const input = sourceVideo(o.base);
    if (!input) throw fail(404, 'There is no video yet: neither video/out/final.mp4 nor video/out/rough.mp4.');
    const c = cleanFolder(o.folder);
    if (c.error) throw fail(400, c.error);
    try { fs.mkdirSync(c.folder, { recursive: true }); fs.accessSync(c.folder, fs.constants.W_OK); } catch { throw fail(400, `The folder ${c.folder} cannot be written to.`); }
    const name = renderName(o.short ? `${o.title || 'short'}-${o.short}` : o.title, preset.id, new Date(), fs.readdirSync(c.folder));
    const out = path.join(c.folder, name), part = out.replace(/\.mp4$/, '.part.mp4');
    const job = { id: `r${++seq}`, project: o.project, short: o.short || '', preset: preset.id, state: 'running', pct: 0, file: out, name, folder: c.folder, startedAt: Date.now(), batch: o.batch || undefined };
    const total = await duration(input);
    const proc = spawn('ffmpeg', presetArgs(preset, input, part), { windowsHide: true });
    let finish; const ended = new Promise((r) => { finish = r; });
    jobs.set(job.id, { job, proc, ended });
    saveFolder(o.projectDir, c.folder);
    let err = '', buf = '', last = 0;
    proc.stdout.on('data', (d) => {
      buf = (buf + d).slice(-4000);
      const s = progressSeconds(buf);
      const pct = Math.round(fraction(s, total) * 100);
      if (pct !== job.pct && Date.now() - last > 250) { job.pct = pct; last = Date.now(); publish(job); }
    });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const end = (patch) => { Object.assign(job, patch, { ms: Date.now() - job.startedAt }); publish(job); finish(); };
    proc.on('error', (e) => { fs.rmSync(part, { force: true }); end({ state: 'error', error: `ffmpeg could not start: ${e.message}` }); });
    proc.on('close', (code) => {
      if (job.state !== 'running') { fs.rmSync(part, { force: true }); finish(); return; }
      if (code !== 0) { fs.rmSync(part, { force: true }); return end({ state: 'error', error: err.trim().split('\n').slice(-2).join(' ') || `ffmpeg stopped with code ${code}` }); }
      try { fs.renameSync(part, out); } catch (e) { return end({ state: 'error', error: e.message }); }
      const size = fs.statSync(out).size;
      end({ state: 'done', pct: 100, size });
      addHistory(o.projectDir, { id: job.id + '-' + Date.now().toString(36), at: new Date().toISOString(), preset: preset.id, presetName: preset.name, short: job.short || undefined, file: out, folder: c.folder, size, ms: job.ms, from: path.basename(input) });
    });
    publish(job);
    return { ...job };
  }

  function cancel(id) {
    const j = jobs.get(id);
    if (!j || j.job.state !== 'running') throw fail(404, 'That render is not running.');
    j.job.state = 'cancelled'; j.job.ms = Date.now() - j.job.startedAt;
    killTree(j.proc);
    setTimeout(() => { try { fs.rmSync(j.job.file.replace(/\.mp4$/, '.part.mp4'), { force: true }); } catch {} }, 600);
    publish(j.job);
    return { ...j.job };
  }
  const wait = (id) => (jobs.get(id)?.ended || Promise.resolve()).then(() => get(id));
  const get = (id) => (jobs.get(id) ? { ...jobs.get(id).job } : null);
  const active = (project) => { const j = running(project); return j ? { ...j.job } : null; };
  return { start, cancel, get, active, wait };
}
