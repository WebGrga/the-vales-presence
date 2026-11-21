// GET /api/studio/:id/uploads -> { uploads: [{ at, dry, url, studio, title, privacy, bytes, thumb: { id, file } | null, ... }] }, newest first:
// what went up, when, the link and the thumbnail that was set (studio/upload-history.json, written when an upload finishes).
import { readUploads } from '../studio/upload-history.js';
import { readUpload } from '../studio/store.js';

export default [{
  method: 'GET', path: /^\/api\/studio\/(?<id>[a-z0-9][a-z0-9_-]{0,79})\/uploads$/i,
  handler: async (req, res, ctx) => {
    const dir = ctx.projectDir(ctx.params.id);
    const { state } = await readUpload(dir);
    ctx.send(res, 200, { uploads: await readUploads(dir, state) });
  },
}];
