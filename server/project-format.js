// Setting a project's format ("long" or "short") after it was made: by the user (POST/PATCH /api/projects/<id>/format) or by
// the agent, which writes one line `format: short` into the project's .presence/format and has it read when its stage ends.
// Only a recipe that can be either (formats: ["long","short"]) takes one, and not once the rough is locked: the talk was cut
// for one shape. The decisions are pure (project-format.test.js).
import fs from 'node:fs';
import path from 'node:path';
import { readLocks } from './locks.js';
import { formatOf, formatsOf, isFormat, parseFormatFile } from '../web/shell/format.js';

export const FORMAT_FILE = path.join('.presence', 'format');

// pure: why the format cannot change now, or '' (project, recipe = the stored one, locks = what readLocks gave)
export function whyNotFormat(project, recipe, locks, format) {
  if (!isFormat(format)) return 'The format is "long" or "short".';
  if (formatsOf(recipe).length < 2) return `${recipe?.name || 'This recipe'} is always a ${recipe?.format === 'short' ? 'Short' : 'long video'}.`;
  if (!formatsOf(recipe).includes(format)) return `${recipe.name} cannot be a ${format === 'short' ? 'Short' : 'long video'}.`;
  if (Object.keys(locks || {}).length || project?.stages?.['rough-review']?.status === 'done') return 'The rough cut is locked, so the format stays as it is. Reopen the rough review first if the talk must change.';
  return '';
}

// pure: the project with the format set (a format equal to the recipe's default is stored too, so a later recipe edit does not move it)
export const withFormat = (project, format) => ({ ...project, format });

export function createFormat(ctx) {
  const P = () => ctx.projects;
  // -> { ok, format, changed } | { error }
  function set(id, format, by = 'user') {
    const p = P().get(id);
    if (!p) return { error: 'no such project', status: 404 };
    const r = P().craft.recipe(p.recipe);
    const why = whyNotFormat(p, r, readLocks(P().dir(id)), format);
    if (why) return { error: why, status: 409 };
    const was = formatOf(p, r);
    if (was === format && p.format === format) return { ok: true, format, changed: false };
    P().save(withFormat(p, format));
    P().log(id, { stage: 'format', status: 'set', format, was, by });
    ctx.broadcast?.({ type: 'toast', project: id, kind: 'info', text: `This project is now a ${format === 'short' ? 'Short (9:16)' : 'long video (16:9)'}.` });
    return { ok: true, format, changed: was !== format };
  }
  // read .presence/format after a stage (the ask stage states it); the file is left as it is. -> the answer of set(), or null
  function adopt(id) {
    let text;
    try { text = fs.readFileSync(path.join(P().dir(id), FORMAT_FILE), 'utf8'); } catch { return null; }
    const f = parseFormatFile(text);
    const p = P().get(id);
    if (!f || !p || p.format === f) return null;
    const r = P().craft.recipe(p.recipe);
    if (formatsOf(r).length < 2) return null;
    const res = set(id, f, 'agent');
    if (res.error) ctx.log?.('format', id, res.error);
    return res;
  }
  return { set, adopt };
}
