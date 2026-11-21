// Footage of a project, in place or copied: video/footage/ holds copies (uploaded or copied from a path) and links.
// A link is a line of video/footage/.links.json ({ "<name>": "<absolute path of the real file>" }); where the system allows it
// the name is also made a symlink or hard link in the folder, so a plain command line finds it too. Everything that reads
// footage resolves a path through resolveFootage(): the media proxies, the export, the agent's file list. The Python engine
// does the same in pipelib.Cut.p. The decisions are pure and tested in footage.test.js.
import fs from 'node:fs';
import path from 'node:path';
import { safeName, freeName } from './upload.js';

export const LINK_FILE = '.links.json';
export const BIG = 200 * 1024 * 1024;        // above this size "Link" is the default choice
const MEDIA = /\.(mp4|mkv|mov|m4v|webm|avi|mts|m2ts|ts|flv|wmv|mxf|wav|mp3|m4a|aac|flac|ogg|opus)$/i;

// pure: the default way to add a file of this size
export const defaultMode = (size) => (Number(size) > BIG ? 'link' : 'copy');

// pure: a path the user typed or the app window gave -> a clean absolute path, or { error }
export function cleanPath(text) {
  const s = String(text ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  if (!s) return { error: 'Type the path of a recording.' };
  if (!path.isAbsolute(s)) return { error: 'Give the whole path, from the drive or the root folder.' };
  if (!MEDIA.test(s)) return { error: 'Only video and sound files can be added (.mp4, .mkv, .mov, .wav ...).' };
  return { path: path.normalize(s) };
}

// pure: links of a .links.json text -> { name: absolute path }
export function parseLinks(text) {
  let j; try { j = JSON.parse(text); } catch { return {}; }
  const out = {};
  for (const [k, v] of Object.entries(j && typeof j === 'object' ? j : {})) if (typeof v === 'string' && path.isAbsolute(v) && !k.includes('/') && !k.includes('\\')) out[k] = v;
  return out;
}

// pure: a path of the edit list (relative to video/, or absolute) -> the path on disk. links: { name: path }
export function resolveIn(videoDir, rel, links = {}) {
  if (path.isAbsolute(String(rel))) return String(rel);
  const parts = String(rel).replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'footage' && links[parts[1]]) return links[parts[1]];
  return path.join(videoDir, ...parts);
}

// pure: rename `from` to `to` in the sources of an edit list -> { edl, changed }
export function renameInEdl(edl, from, to) {
  if (!edl?.sources) return { edl, changed: 0 };
  let changed = 0;
  const sources = {};
  for (const [k, s] of Object.entries(edl.sources)) {
    const file = typeof s === 'string' ? s : s?.file;
    if (typeof file === 'string' && file.replace(/\\/g, '/') === `footage/${from}`) {
      changed++;
      sources[k] = typeof s === 'string' ? `footage/${to}` : { ...s, file: `footage/${to}` };
    } else sources[k] = s;
  }
  return { edl: { ...edl, sources }, changed };
}

// pure: which edit-list sources use a footage name -> [source keys]
export function usedBy(edl, name) {
  return Object.entries(edl?.sources || {}).filter(([, s]) => String(typeof s === 'string' ? s : s?.file || '').replace(/\\/g, '/') === `footage/${name}`).map(([k]) => k);
}

// pure: the rows of the bin from the folder's names, the links, and a stat function -> [{ name, size, linked, target?, missing, path }]
export function binRows(names, links, stat) {
  const rows = [];
  const seen = new Set();
  for (const name of names) {
    seen.add(name);
    const target = links[name];
    const st = stat(target || null, name);
    rows.push({ name, size: st?.size || 0, linked: !!target, target: target || undefined, missing: !!target && !st?.targetOk, path: `video/footage/${name}` });
  }
  for (const [name, target] of Object.entries(links)) {
    if (seen.has(name)) continue;
    const st = stat(target, name);
    rows.push({ name, size: st?.size || 0, linked: true, target, missing: !st?.targetOk, path: `video/footage/${name}` });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ---------------------------------------------------------------- the disk

const dirOf = (project) => path.join(project, 'video', 'footage');
const videoOf = (project) => path.join(project, 'video');

export function readLinks(project) {
  try { return parseLinks(fs.readFileSync(path.join(dirOf(project), LINK_FILE), 'utf8')); } catch { return {}; }
}
function writeLinks(project, links) {
  const d = dirOf(project); fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, LINK_FILE), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(links, null, 1)); fs.renameSync(tmp, f);
}
const fail = (status, message) => Object.assign(new Error(message), { status });
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// the file on disk for a path of the edit list ("footage/rec.mkv")
export function resolveFootage(project, rel) {
  const links = readLinks(project);
  const target = resolveIn(videoOf(project), rel, links);
  if (!exists(target) && links[path.basename(String(rel))]) { // the real file is gone: a hard link in the folder may still hold it
    const local = path.join(dirOf(project), path.basename(String(rel)));
    if (exists(local)) return local;
  }
  return target;
}

export function listFootage(project) {
  const d = dirOf(project), links = readLinks(project);
  let names = []; try { names = fs.readdirSync(d).filter((f) => !f.startsWith('.') && !f.endsWith('.part')); } catch {}
  const edl = edlOf(project);
  return binRows(names, links, (target, name) => {
    const local = path.join(d, name);
    try { const st = fs.statSync(target || local); return { size: st.size, targetOk: st.isFile() }; } catch {
      if (target) { try { const st = fs.statSync(local); return { size: st.size, targetOk: st.isFile() }; } catch {} }
      return null;
    }
  }).map((r) => ({ ...r, used: usedBy(edl, r.name) }));
}

// names the edit list uses (the edit list of the project, or none)
export function edlOf(project) { try { return JSON.parse(fs.readFileSync(path.join(videoOf(project), 'out', 'edl.json'), 'utf8')); } catch { return null; } }

// footage name -> { keys: [source keys], rough: bool } : what depends on it
export function dependents(project, name) {
  const keys = usedBy(edlOf(project), name);
  return { keys, rough: keys.length > 0 && exists(path.join(videoOf(project), 'out', 'rough.mp4')) };
}

function materialize(local, target) {
  try { fs.rmSync(local, { force: true }); } catch {}
  for (const kind of ['symlink', 'link']) {
    try { if (kind === 'symlink') fs.symlinkSync(target, local, 'file'); else fs.linkSync(target, local); return kind; } catch {}
  }
  return null;
}

// add a file by path: mode 'link' (in place) or 'copy' (into the project). -> { name, mode, size }
export function addByPath(project, text, { mode, name } = {}) {
  const c = cleanPath(text);
  if (c.error) throw fail(400, c.error);
  let st; try { st = fs.statSync(c.path); } catch { throw fail(404, 'That file is not there.'); }
  if (!st.isFile()) throw fail(400, 'That path is a folder, not a recording.');
  const d = dirOf(project); fs.mkdirSync(d, { recursive: true });
  const links = readLinks(project);
  const taken = [...fs.readdirSync(d), ...Object.keys(links)];
  const final = freeName(safeName(name || path.basename(c.path)), taken);
  const how = mode === 'link' || mode === 'copy' ? mode : defaultMode(st.size);
  if (how === 'copy') {
    const tmp = path.join(d, final + '.part');
    fs.copyFileSync(c.path, tmp); fs.renameSync(tmp, path.join(d, final));
    return { name: final, mode: 'copy', size: st.size };
  }
  writeLinks(project, { ...links, [final]: c.path });
  materialize(path.join(d, final), c.path);
  return { name: final, mode: 'link', size: st.size };
}

// point a missing (or any) linked name at another file
export function relink(project, name, text) {
  const links = readLinks(project);
  if (!links[name]) throw fail(409, `${name} is not a linked file: use Replace.`);
  const c = cleanPath(text); if (c.error) throw fail(400, c.error);
  if (!exists(c.path)) throw fail(404, 'That file is not there.');
  writeLinks(project, { ...links, [name]: c.path });
  materialize(path.join(dirOf(project), name), c.path);
  return { name, target: c.path };
}

// rename a name of the folder and everywhere the edit list uses it
export function renameFootage(project, name, to) {
  const d = dirOf(project), links = readLinks(project);
  const next = safeName(to);
  if (!MEDIA.test(next)) throw fail(400, 'Keep a video or sound extension on the name.');
  if (next === name) return { name, changed: 0 };
  const taken = [...fs.readdirSync(d), ...Object.keys(links)].filter((n) => n !== name);
  if (taken.some((n) => n.toLowerCase() === next.toLowerCase())) throw fail(409, `${next} is already in the footage.`);
  const local = path.join(d, name), isLink = !!links[name];
  if (!isLink && !exists(local)) throw fail(404, `${name} is not in the footage.`);
  if (isLink) {
    const { [name]: target, ...rest } = links;
    try { fs.rmSync(local, { force: true }); } catch {}
    writeLinks(project, { ...rest, [next]: target });
    materialize(path.join(d, next), target);
  } else fs.renameSync(local, path.join(d, next));
  const f = path.join(videoOf(project), 'out', 'edl.json');
  const edl = edlOf(project);
  const r = renameInEdl(edl, name, next);
  if (r.changed) { fs.writeFileSync(f + '.tmp', JSON.stringify(r.edl, null, 1)); fs.renameSync(f + '.tmp', f); }
  return { name: next, changed: r.changed };
}

// take a name out of the footage: a copy is deleted, a link only forgotten (the real file is never touched)
export function removeFootage(project, name) {
  const d = dirOf(project), links = readLinks(project);
  const local = path.join(d, name);
  if (links[name]) { const { [name]: _, ...rest } = links; writeLinks(project, rest); }
  else if (!exists(local)) throw fail(404, `${name} is not in the footage.`);
  try { fs.rmSync(local, { force: true }); } catch {} // a symlink or hard link: only the name goes
  return { name };
}

// replace what a name holds, keeping the name (so the edit list still points at it): by a path (link or copy), or by another
// file already in the footage folder (an upload), which then takes the old name
export function replaceFootage(project, name, { path: text, mode, with: other } = {}) {
  const d = dirOf(project), links = readLinks(project);
  if (!links[name] && !exists(path.join(d, name))) throw fail(404, `${name} is not in the footage.`);
  const sameKind = (f) => path.extname(f).toLowerCase() === path.extname(name).toLowerCase();
  if (other) {
    if (!sameKind(other)) throw fail(400, `Replace needs a ${path.extname(name)} file, like the one it replaces. Add the new one and remove the old one instead.`);
    const src = path.join(d, safeName(other));
    if (!exists(src)) throw fail(404, `${other} is not in the footage.`);
    removeFootage(project, name);
    fs.renameSync(src, path.join(d, name));
    return { name, mode: 'copy' };
  }
  const c = cleanPath(text); if (c.error) throw fail(400, c.error);
  if (!sameKind(c.path)) throw fail(400, `Replace needs a ${path.extname(name)} file, like the one it replaces. Add the new one and remove the old one instead.`);
  let st; try { st = fs.statSync(c.path); } catch { throw fail(404, 'That file is not there.'); }
  if (!st.isFile()) throw fail(400, 'That path is a folder, not a recording.');
  removeFootage(project, name);
  const how = mode === 'link' || mode === 'copy' ? mode : defaultMode(st.size);
  if (how === 'copy') { const tmp = path.join(d, name + '.part'); fs.copyFileSync(c.path, tmp); fs.renameSync(tmp, path.join(d, name)); }
  else { writeLinks(project, { ...readLinks(project), [name]: c.path }); materialize(path.join(d, name), c.path); }
  return { name, mode: how };
}
