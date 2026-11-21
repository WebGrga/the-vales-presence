// Media of a project: any file inside it with Range (GET /api/media/<id>/<path>), and the live-preview proxies and peaks.
const ID = '([a-z0-9][a-z0-9_-]{0,79})';
const need = (ctx, what) => { if (!ctx[what]) throw Object.assign(new Error(`${what} is not available`), { status: 503 }); return ctx[what]; };

export default [
  { method: 'GET', path: new RegExp(`^/api/media/${ID}/(.+)$`, 'i'), handler: async (req, res, ctx) => {
    const [id, rel] = ctx.params;
    if (!need(ctx, 'projects').exists(id)) return ctx.send(res, 404, { error: 'no such project' });
    const file = need(ctx, 'media').fileOf(id, rel);
    if (!file) return ctx.send(res, 400, { error: 'that path is not inside the project' });
    return ctx.sendFile(req, res, file);
  } },
  // makes what is missing and answers when it is done; ?nowait=1 answers at once with what exists (and starts the job)
  { method: 'GET', path: new RegExp(`^/api/projects/${ID}/proxy$`, 'i'), handler: async (req, res, ctx) => {
    const id = ctx.params[0];
    if (!need(ctx, 'projects').exists(id)) return ctx.send(res, 404, { error: 'no such project' });
    const m = need(ctx, 'media');
    const now = m.list(id);
    if (now.ready && !m.busy(id)) return ctx.send(res, 200, now);
    const job = m.make(id);
    if (ctx.query.get('nowait')) { job.catch(() => {}); return ctx.send(res, 202, { ...m.list(id), making: true }); }
    ctx.send(res, 200, await job);
  } },
];
