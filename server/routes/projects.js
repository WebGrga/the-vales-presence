// Projects and their stages: list, create, read, the stage view and log, footage upload, Go / approve / send back / resume.
import fs from 'node:fs';
import path from 'node:path';
import { view as stageView } from '../stages.js';
import { receive } from '../upload.js';
import { writeJsonAtomic } from '../projects.js';
import { listFootage } from '../footage.js';
import { createFormat } from '../project-format.js';

const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const P = (tail = '') => new RegExp(`^/api/projects/${ID}${tail}$`, 'i');
const need = (ctx, what) => { if (!ctx[what]) throw Object.assign(new Error(`${what} is not available`), { status: 503 }); return ctx[what]; };
const project = (ctx, id) => {
  const p = need(ctx, 'projects').get(id);
  if (!p) throw Object.assign(new Error('no such project'), { status: 404 });
  return p;
};
const reply = (ctx, res, r) => ctx.send(res, r?.error ? 409 : 200, r);
// the stage view with its live part (a question waiting, a sleeping stage, the line, Keep) when the runner is there
const viewOf = (ctx, p, r) => { if (!r) return null; try { if (ctx.runner?.view) return ctx.runner.view(p.id); } catch {} return stageView(p, r); };

const footageList = listFootage; // names, sizes, links (a linked recording may be missing) and which sources of the edit use each

export default [
  { method: 'GET', path: '/api/projects', handler: async (req, res, ctx) => {
    const list = need(ctx, 'projects').list().map((p) => { const r = ctx.projects.recipeOf(p); return { ...p, view: viewOf(ctx, p, r), ...homeMeta(ctx.projectDir(p.id)) }; });
    ctx.send(res, 200, { projects: list });
  } },
  { method: 'POST', path: '/api/projects', handler: async (req, res, ctx) => {
    const b = await ctx.readJson(req);
    ctx.send(res, 200, need(ctx, 'projects').create({ title: b.title, recipe: b.recipe, id: b.id, topic: b.topic, format: b.format }));
  } },
  // project.json, plus recipeDef (the recipe's stages) and view (the stage bar) for the screen
  { method: 'GET', path: P(), handler: async (req, res, ctx) => {
    const p = project(ctx, ctx.params[0]), r = ctx.projects.recipeOf(p);
    ctx.send(res, 200, { ...p, recipeDef: r ? { id: r.id, name: r.name, about: r.about || '', format: r.format, formats: r.formats, stages: r.stages } : null, view: viewOf(ctx, p, r) });
  } },
  { method: 'GET', path: P('/view'), handler: async (req, res, ctx) => {
    const p = project(ctx, ctx.params[0]), r = ctx.projects.recipeOf(p);
    ctx.send(res, 200, { ...viewOf(ctx, p, r), recipe: r });
  } },
  { method: 'GET', path: P('/log'), handler: async (req, res, ctx) => { project(ctx, ctx.params[0]); ctx.send(res, 200, { log: ctx.projects.readLog(ctx.params[0]) }); } },
  // the words the current stage would send its agent (what the context room shows)
  { method: 'GET', path: P('/prompt'), handler: async (req, res, ctx) => { project(ctx, ctx.params[0]); ctx.send(res, 200, { prompt: need(ctx, 'runner').promptFor(ctx.params[0]) }); } },
  { method: 'GET', path: P('/footage'), handler: async (req, res, ctx) => { project(ctx, ctx.params[0]); ctx.send(res, 200, { files: footageList(ctx.projectDir(ctx.params[0])) }); } },
  { method: 'POST', path: P('/footage'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; project(ctx, id);
    const got = await receive(req, path.join(ctx.projectDir(id), 'video', 'footage'));
    ctx.projects.log(id, { stage: 'footage', status: 'uploaded', files: got.files });
    ctx.broadcast({ type: 'files', project: id, paths: got.files.map((f) => `video/footage/${f.name}`) });
    ctx.broadcast({ type: 'toast', project: id, text: `Footage in: ${got.files.map((f) => f.name).join(', ')}`, kind: 'ok' });
    ctx.send(res, 200, { files: got.files, footage: footageList(ctx.projectDir(id)) });
  } },
  // the project's format ("long" | "short"): refused when the recipe has only one or the rough is locked
  ...['POST', 'PATCH'].map((method) => ({ method, path: P('/format'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; project(ctx, id);
    const b = await ctx.readJson(req);
    const r = (ctx.format ||= createFormat(ctx)).set(id, b.format);
    ctx.send(res, r.error ? r.status || 409 : 200, r);
  } })),
  { method: 'POST', path: P('/go'), handler: async (req, res, ctx) => reply(ctx, res, await need(ctx, 'runner').go(ctx.params[0])) },
  { method: 'POST', path: P('/approve'), handler: async (req, res, ctx) => { const b = await ctx.readJson(req); reply(ctx, res, await need(ctx, 'runner').approve(ctx.params[0], { notes: b.notes })); } },
  { method: 'POST', path: P('/sendback'), handler: async (req, res, ctx) => { const b = await ctx.readJson(req); reply(ctx, res, await need(ctx, 'runner').sendback(ctx.params[0], { notes: b.notes })); } },
  // go on with what exists after Stop (or a failed turn): no agent turn, nothing runs again
  { method: 'POST', path: P('/keep'), handler: async (req, res, ctx) => reply(ctx, res, await need(ctx, 'runner').keep(ctx.params[0])) },
  { method: 'POST', path: P('/resume'), handler: async (req, res, ctx) => reply(ctx, res, need(ctx, 'runner').resume(ctx.params[0])) },
  // typed text not saved anywhere else yet (the agent box, approve and send-back notes): { key: { text, at } }
  { method: 'GET', path: P('/drafts'), handler: async (req, res, ctx) => { project(ctx, ctx.params[0]); ctx.send(res, 200, readDrafts(ctx.projectDir(ctx.params[0]))); } },
  { method: 'POST', path: P('/drafts'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; project(ctx, id);
    const b = await ctx.readJson(req);
    const r = applyDraft(readDrafts(ctx.projectDir(id)), b.key, b.text);
    if (r.error) return ctx.send(res, 400, r);
    writeJsonAtomic(draftsFile(ctx.projectDir(id)), r.drafts);
    ctx.send(res, 200, { ok: true });
  } },
];

// pin and last-opened (the Projects home), kept in the project's own .presence/meta.json
function homeMeta(dir) { try { const m = JSON.parse(fs.readFileSync(path.join(dir, '.presence', 'meta.json'), 'utf8')); return { pinned: !!m.pinned, opened: m.opened || null }; } catch { return { pinned: false, opened: null }; } }

const draftsFile = (dir) => path.join(dir, '.presence', 'drafts.json');
function readDrafts(dir) { try { return JSON.parse(fs.readFileSync(draftsFile(dir), 'utf8')) || {}; } catch { return {}; } }
// pure: one draft set (text) or cleared (null / empty)
export function applyDraft(drafts, key, text, now = new Date().toISOString()) {
  if (typeof key !== 'string' || !/^[\w:./ -]{1,120}$/.test(key)) return { error: 'a draft needs a short key' };
  if (text != null && typeof text !== 'string') return { error: 'a draft is text' };
  const out = { ...(drafts || {}) };
  if (!text) delete out[key]; else out[key] = { text: text.slice(0, 200000), at: now };
  const keys = Object.keys(out);
  if (keys.length > 200) for (const k of keys.sort((a, b) => String(out[a].at).localeCompare(String(out[b].at))).slice(0, keys.length - 200)) delete out[k];
  return { drafts: out };
}
