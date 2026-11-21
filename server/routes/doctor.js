// GET /api/doctor[?fresh=1]: what this machine has and what it lacks, with a plain fix per OS (server/doctor).
import { doctor } from '../doctor/index.js';

export default [
  {
    method: 'GET',
    path: '/api/doctor',
    handler: async (req, res, ctx) => {
      const fresh = ctx.query?.get('fresh') === '1';
      ctx.send(res, 200, await doctor({ root: ctx.root, dataDir: ctx.dataDir, fresh }));
    },
  },
];
