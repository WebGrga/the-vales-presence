// The Studio's package routes (E44 to E51): the Judge button, the feed marks (a Missed why leaves a lesson in your
// house rules) and the bet for an upload. The page reads all of it in GET /api/studio/<id> (`pack`).
import fs from 'node:fs';
import { readStudio } from '../studio/store.js';
import { runJudge } from '../studio/judge-run.js';
import { applyMark, readMarks, writeMarks, withLesson, withoutLesson, readBet, applyBet, BET_FILE } from '../studio/package-data.js';
import { writeJson } from '../studio/files.js';
import { houseRulesFile } from '../context/stage-context.js';

const ID = '(?<id>[a-z0-9][a-z0-9_-]{0,79})';
const P = (tail) => new RegExp(`^/api/studio/${ID}${tail}$`, 'i');
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const judging = new Set();
const lastState = new Map(); // project id -> { status, error? } of the latest judge run
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

// the lesson goes into the user's own copy of the house rules (made from the shipped one the first time)
function changeLessons(ctx, projectId, { lessonOut, lessonIn }) {
  if (!lessonOut && !lessonIn) return false;
  const file = houseRulesFile({ root: ctx.root, dataDir: ctx.dataDir, home: ctx.home, projectId, recipeId: null });
  let md = fs.readFileSync(file, 'utf8');
  if (lessonOut) md = withoutLesson(md, lessonOut);
  if (lessonIn) md = withLesson(md, lessonIn, today());
  fs.writeFileSync(file, md);
  return true;
}

export default [
  {
    method: 'GET', path: P('/judge-status'),
    handler: async (req, res, ctx) => ctx.send(res, 200, { running: judging.has(ctx.params.id), state: lastState.get(ctx.params.id) || null }),
  },
  {
    method: 'POST', path: P('/judge'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id, dir = ctx.projectDir(id);
      if (judging.has(id)) throw bad('The judges are already at work on this project.', 409);
      const b = await ctx.readJson(req);
      const studio = await readStudio(dir);
      const file = ctx.craft?.skillFile('judge-package');
      if (!file) throw bad('The skill judge-package is missing.', 500);
      const skill = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
      judging.add(id);
      const say = (j) => { lastState.set(id, j); if (j.status === 'done' || j.status === 'error') ctx.broadcast({ type: 'studio', project: id, judge: j }); };
      say({ status: 'starting' });
      runJudge({ dir, skill, titles: studio.titles, thumbs: studio.thumbs, pairs: b.pairs, seed: studio.feed.seed, onState: say })
        .then((r) => { say({ status: 'done' }); ctx.broadcast({ type: 'toast', text: `The judges are done (${r.judges} of 3 answered, $${r.cost.toFixed(2)}).`, kind: 'ok' }); })
        .catch((e) => { say({ status: 'error', error: e.message }); ctx.broadcast({ type: 'toast', text: `Judge: ${e.message}`, kind: 'error' }); })
        .finally(() => judging.delete(id));
      ctx.send(res, 202, { started: true });
    },
  },
  {
    method: 'POST', path: P('/marks'),
    handler: async (req, res, ctx) => {
      const id = ctx.params.id, dir = ctx.projectDir(id);
      const b = await ctx.readJson(req);
      const r = applyMark(await readMarks(dir), b);
      if (r.error) throw bad(r.error);
      await writeMarks(dir, r.marks);
      const lesson = changeLessons(ctx, id, r);
      if (lesson) ctx.broadcast({ type: 'context' });
      ctx.send(res, 200, { marks: r.marks, lesson: !!r.lessonIn });
    },
  },
  {
    method: 'POST', path: P('/bet'),
    handler: async (req, res, ctx) => {
      const dir = ctx.projectDir(ctx.params.id);
      const b = await ctx.readJson(req);
      const patch = {};
      for (const k of ['metric', 'direction', 'median', 'note']) if (typeof b[k] === 'string') patch[k] = b[k];
      if ('result' in b) patch.result = b.result;
      const bet = applyBet(await readBet(dir), patch);
      await writeJson(BET_FILE(dir), bet);
      ctx.send(res, 200, { bet });
    },
  },
];
