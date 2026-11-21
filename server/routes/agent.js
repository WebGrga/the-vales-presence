// Talking to the agent: say, answer a question, stop, its live status, a fresh conversation; and its settings.
import { checkSettings } from '../settings-check.js';
const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const P = (tail) => new RegExp(`^/api/projects/${ID}${tail}$`, 'i');
const need = (ctx, what) => { if (!ctx[what]) throw Object.assign(new Error(`${what} is not available`), { status: 503 }); return ctx[what]; };
const known = (ctx, id) => { if (!need(ctx, 'projects').exists(id)) throw Object.assign(new Error('no such project'), { status: 404 }); };
const reply = (ctx, res, r) => ctx.send(res, r?.error ? 409 : 200, r);

// pure: the answers to the agent's waiting questions as AskUserQuestion takes them -> { answers } | { error }.
// Every value a string (several picks joined with ", "), trimmed and capped; only the questions that wait; a question
// left without an answer says so, so the agent never reads silence as a choice.
export const NO_ANSWER = 'No answer from me: use your judgment.';
export function cleanAnswers(answers, questions) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { error: 'send answers as { question: answer }' };
  const val = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ') : String(v ?? '').trim()).slice(0, 4000);
  const asked = (questions || []).map((q) => String(q?.question ?? ''));
  const out = {};
  if (!asked.length) { for (const [k, v] of Object.entries(answers)) if (val(v)) out[String(k).slice(0, 2000)] = val(v); }
  else for (const q of asked) out[q] = val(answers[q]) || NO_ANSWER;
  if (!Object.values(out).some((v) => v && v !== NO_ANSWER)) return { error: 'answer at least one question' };
  return { answers: out };
}

export default [
  { method: 'POST', path: P('/say'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const b = await ctx.readJson(req);
    reply(ctx, res, await need(ctx, 'runner').say(id, String(b.text || ''), { answers: b.answers && typeof b.answers === 'object' ? b.answers : undefined }));
  } },
  { method: 'POST', path: P('/answer'), handler: async (req, res, ctx) => {
    const id = ctx.params[0]; known(ctx, id);
    const b = await ctx.readJson(req);
    const agent = need(ctx, 'agent');
    const waiting = agent.status(id)?.question;
    if (!waiting) return ctx.send(res, 409, { error: 'no question is waiting' });
    const c = cleanAnswers(b.answers, waiting.questions);
    if (c.error) return ctx.send(res, 400, c);
    reply(ctx, res, agent.answer(id, c.answers));
  } },
  { method: 'POST', path: P('/stop'), handler: async (req, res, ctx) => { const id = ctx.params[0]; known(ctx, id); reply(ctx, res, await need(ctx, 'runner').stop(id)); } },
  { method: 'GET', path: P('/agent'), handler: async (req, res, ctx) => { const id = ctx.params[0]; known(ctx, id); ctx.send(res, 200, need(ctx, 'agent').status(id)); } },
  { method: 'POST', path: P('/forget'), handler: async (req, res, ctx) => { const id = ctx.params[0]; known(ctx, id); ctx.send(res, 200, need(ctx, 'agent').forget(id)); } },
  { method: 'GET', path: '/api/agent/settings', handler: async (req, res, ctx) => {
    const a = need(ctx, 'agent');
    ctx.send(res, 200, { settings: a.settings(), models: a.models(), efforts: a.efforts(), modes: a.modes() });
  } },
  { method: 'POST', path: '/api/agent/settings', handler: async (req, res, ctx) => {
    const a = need(ctx, 'agent');
    const c = checkSettings(await ctx.readJson(req));
    if (c.error) return ctx.send(res, 400, { error: c.error });
    const s = a.setSettings(c.patch);
    ctx.broadcast({ type: 'settings', settings: s });
    ctx.send(res, 200, { settings: s, models: a.models(), efforts: a.efforts(), modes: a.modes() });
  } },
];
