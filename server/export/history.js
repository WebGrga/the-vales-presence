// The export history of a project: <project>/export/history.json, one entry per render ({ id, at, preset, short, file, folder, size, ms }).
// The folder last used is in <project>/export/settings.json. The order and the marks are pure (presets.js orderHistory).
import fs from 'node:fs';
import path from 'node:path';
import { orderHistory } from './presets.js';

const dir = (project) => path.join(project, 'export');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); }

export function readHistory(project) {
  const list = readJson(path.join(dir(project), 'history.json'), []);
  // a file that is gone (moved, deleted) is still listed, marked: the record is the history
  return orderHistory(Array.isArray(list) ? list : []).map((e) => ({ ...e, exists: fs.existsSync(e.file) }));
}
export function addHistory(project, entry) {
  const f = path.join(dir(project), 'history.json');
  const list = readJson(f, []);
  list.push(entry);
  writeJson(f, list.slice(-200));
  return entry;
}
export const readSettings = (project) => readJson(path.join(dir(project), 'settings.json'), {});
export function saveFolder(project, folder) { writeJson(path.join(dir(project), 'settings.json'), { ...readSettings(project), folder }); }
