// Looking after projects (the Projects home): rename, pin, last opened, duplicate, the Bin, size, free space, open the
// folder, and a whole project as a zip. The decisions are pure and tested in project-bin.js, project-space.js,
// project-zip.js and project-poster.js; this file does the disk work. Routes: routes/projects-manage.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { initStages } from './stages.js';
import { slugify, uniqueId, writeJsonAtomic } from './projects.js';
import { binName, parseBinName, binNote, cleanTitle, copyTitle, copyProject } from './project-bin.js';
import { measure, freeablePlan, freeSpace } from './project-space.js';
import { unwatch } from './routes/studio.js';
import { zipCommand, unzipCommand, listCommand, unsafeEntries, entryNames, run, EXCLUDES } from './project-zip.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

// pure: the program that shows a folder in the system's file manager
export function revealCommand(platform, dir) {
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [dir] };
  if (platform === 'darwin') return { cmd: 'open', args: [dir] };
  return { cmd: 'xdg-open', args: [dir] };
}

export function createManage(ctx, projects) {
  const base = path.join(ctx.dataDir, 'projects');
  const binDir = path.join(ctx.dataDir, 'bin');
  const dir = (id) => ctx.projectDir(id);
  const sizes = new Map(); // id -> { at, size }

  const metaFile = (id) => path.join(dir(id), '.presence', 'meta.json');
  function meta(id) { try { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')) || {}; } catch { return {}; } }
  function setMeta(id, patch) { const m = { ...meta(id), ...patch }; writeJsonAtomic(metaFile(id), m); return m; }
  const need = (id) => { const p = projects.get(id); if (!p) throw fail(404, 'no such project'); return p; };
  const busy = (id) => { try { const v = ctx.runner?.view?.(id); return !!(v?.running || v?.queued); } catch { return false; } };
  const ids = () => { try { return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

  function rename(id, title) {
    const t = cleanTitle(title); if (t.error) throw fail(400, t.error);
    need(id);
    return projects.update(id, (p) => { p.title = t.title; });
  }
  const pin = (id, pinned) => { need(id); return setMeta(id, { pinned: !!pinned }); };
  const opened = (id) => { need(id); return setMeta(id, { opened: new Date().toISOString() }); };

  // a copy: the settings, the brief, and the footage linked (hard links: no space used) or copied
  async function duplicate(id, { footage = 'link', title } = {}) {
    const p = need(id);
    const r = projects.recipeOf(p); if (!r) throw fail(409, 'the recipe of this project is not here any more');
    const all = projects.list();
    const newTitle = cleanTitle(title).title || copyTitle(p.title, all.map((x) => x.title));
    const pid = uniqueId(slugify(newTitle), ids());
    const copy = copyProject(p, { id: pid, title: newTitle, recipe: r, initStages });
    const to = dir(pid), from = dir(id);
    for (const f of ['video/footage', 'video/out', 'studio', '.presence']) fs.mkdirSync(path.join(to, ...f.split('/')), { recursive: true });
    try { fs.copyFileSync(path.join(from, 'brief.md'), path.join(to, 'brief.md')); } catch {}
    try { fs.copyFileSync(path.join(from, '.presence', 'topic.md'), path.join(to, '.presence', 'topic.md')); } catch {}
    let how = 'none', n = 0;
    if (footage !== 'none') {
      let names = []; try { names = fs.readdirSync(path.join(from, 'video', 'footage')).filter((x) => !x.startsWith('.') && !x.endsWith('.part')); } catch {}
      how = footage === 'copy' ? 'copied' : 'linked';
      for (const name of names) {
        const a = path.join(from, 'video', 'footage', name), b = path.join(to, 'video', 'footage', name);
        try { if (!fs.statSync(a).isFile()) continue; } catch { continue; }
        if (footage !== 'copy') { try { fs.linkSync(a, b); n++; continue; } catch {} how = 'copied'; }
        fs.copyFileSync(a, b); n++;
      }
    }
    projects.save(copy);
    return { project: projects.get(pid), footage: { how, files: n } };
  }

  // ---------------------------------------------------------------- the Bin
  // Presence itself holds an open project's folder (the Studio's watcher, the idle agent session's working directory):
  // both let go first, then the move is tried for a few seconds while Windows closes the handles
  async function toBin(id) {
    const p = need(id);
    if (busy(id)) throw fail(409, 'the agent is working on this project: stop it first');
    unwatch(id);
    try { ctx.agent?.release?.(id); } catch {}
    fs.mkdirSync(binDir, { recursive: true });
    const name = binName(id, Date.now(), fs.readdirSync(binDir));
    for (let i = 0; ; i++) {
      try { fs.renameSync(dir(id), path.join(binDir, name)); break; }
      catch (e) {
        if (i < 12 && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')) { await new Promise((ok) => setTimeout(ok, 400)); continue; }
        throw fail(409, `could not move the folder: a program outside Presence has a file in it open (a video player, Explorer, an editor). Close it and try again. (${e.code || e.message})`);
      }
    }
    writeJsonAtomic(path.join(binDir, `${name}.bin.json`), binNote(p));
    sizes.delete(id);
    ctx.broadcast({ type: 'projects', change: 'binned', project: id });
    return { name, id };
  }
  async function binList() {
    let names = []; try { names = fs.readdirSync(binDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
    const out = await Promise.all(names.map(async (name) => {
      let note = {}; try { note = JSON.parse(fs.readFileSync(path.join(binDir, `${name}.bin.json`), 'utf8')); } catch {}
      const parsed = parseBinName(name);
      const s = await measure(path.join(binDir, name));
      return { name, id: note.id || parsed?.id || name, title: note.title || parsed?.id || name, recipe: note.recipe || '', binned: note.binned || null, bytes: s.total };
    }));
    return out.sort((a, b) => String(b.binned || '').localeCompare(String(a.binned || '')));
  }
  const binFolder = (name) => {
    if (!/^[\w.-]+$/.test(String(name || '')) || name.includes('..')) throw fail(400, 'bad name');
    const f = path.join(binDir, name);
    if (!fs.existsSync(f)) throw fail(404, 'not in the Bin');
    return f;
  };
  function restore(name) {
    const from = binFolder(name);
    const note = (() => { try { return JSON.parse(fs.readFileSync(`${from}.bin.json`, 'utf8')); } catch { return {}; } })();
    const want = note.id || parseBinName(name)?.id || 'project';
    const pid = uniqueId(slugify(want) === want ? want : slugify(want), ids());
    try { fs.renameSync(from, dir(pid)); } catch (e) { throw fail(409, `could not move the folder back: ${e.code || e.message}`); }
    try { const f = path.join(dir(pid), 'project.json'); const p = JSON.parse(fs.readFileSync(f, 'utf8')); writeJsonAtomic(f, { ...p, id: pid }); } catch {}
    try { fs.rmSync(`${from}.bin.json`, { force: true }); } catch {}
    ctx.broadcast({ type: 'projects', change: 'restored', project: pid });
    return { id: pid, renamed: pid !== want };
  }
  // deletes for good: names must be given, and confirm must be true
  async function emptyBin(names, confirm) {
    if (confirm !== true) throw fail(400, 'say confirm: true to delete for good');
    const list = Array.isArray(names) && names.length ? names : (await binList()).map((x) => x.name);
    let bytes = 0, n = 0;
    for (const name of list) {
      const f = binFolder(name);
      bytes += (await measure(f)).total;
      fs.rmSync(f, { recursive: true, force: true }); fs.rmSync(`${f}.bin.json`, { force: true }); n++;
    }
    return { deleted: n, bytes };
  }

  // ---------------------------------------------------------------- size and free space
  async function size(id, fresh = false) {
    need(id);
    const c = sizes.get(id);
    if (!fresh && c && Date.now() - c.at < 5 * 60 * 1000) return c.size;
    const s = await measure(dir(id));
    sizes.set(id, { at: Date.now(), size: s });
    return s;
  }
  const freePlan = (id) => { need(id); return freeablePlan(dir(id)); };
  async function free(id) {
    need(id);
    if (busy(id)) throw fail(409, 'the agent is working on this project: stop it first');
    const r = await freeSpace(dir(id));
    sizes.delete(id);
    ctx.projects.log(id, { stage: 'free-space', status: 'done', files: r.deleted.length, bytes: r.bytes });
    return r;
  }

  function reveal(id, dry = false) {
    need(id);
    const c = revealCommand(process.platform, dir(id));
    if (!dry) { try { const p = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); } catch (e) { throw fail(500, e.message); } }
    return { ...c, dry };
  }

  // ---------------------------------------------------------------- a whole project as a zip
  // a temp zip of the project (footage in or out); the caller sends it and removes it
  async function exportZip(id, { footage = true } = {}) {
    need(id);
    const tmp = path.join(ctx.dataDir, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
    const out = path.join(tmp, `${id}-${Date.now().toString(36)}.zip`);
    const names = fs.readdirSync(dir(id)).filter((n) => n !== '.presence');
    const excludes = footage ? undefined : [...EXCLUDES, 'video/footage'];
    await run(zipCommand({ dir: dir(id), out, names, ...(excludes ? { excludes } : {}) }));
    return out;
  }
  // a zip file on disk becomes a new project (a free id). The zip is checked before anything is unpacked.
  async function importZip(zip) {
    let names;
    try { names = entryNames(await run(listCommand({ zip }))); } catch (e) { throw fail(400, /not installed/.test(e.message) ? e.message : 'this file is not a zip of a project'); }
    const bad = unsafeEntries(names);
    if (bad.length) throw fail(400, `the zip holds paths that leave the project folder (${bad[0]}): not imported`);
    if (!names.some((n) => n === 'project.json')) throw fail(400, 'this zip is not a project (no project.json)');
    const tmp = fs.mkdtempSync(path.join(ctx.dataDir, 'import-'));
    try {
      await run(unzipCommand({ zip, dest: tmp }));
      const p = JSON.parse(fs.readFileSync(path.join(tmp, 'project.json'), 'utf8'));
      if (!projects.recipe(p.recipe)) throw fail(409, `this project uses a recipe this app does not have ("${p.recipe}")`);
      const pid = uniqueId(slugify(p.id || p.title), ids());
      fs.mkdirSync(base, { recursive: true });
      fs.renameSync(tmp, dir(pid));
      for (const f of ['video/footage', 'video/out', 'studio', '.presence']) fs.mkdirSync(path.join(dir(pid), ...f.split('/')), { recursive: true });
      writeJsonAtomic(path.join(dir(pid), 'project.json'), { ...p, id: pid });
      ctx.broadcast({ type: 'projects', change: 'imported', project: pid });
      return projects.get(pid);
    } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
  }

  return { meta, setMeta, rename, pin, opened, duplicate, toBin, binList, restore, emptyBin, size, freePlan, free, reveal, exportZip, importZip, tmpDir: () => path.join(ctx.dataDir, 'tmp') };
}
