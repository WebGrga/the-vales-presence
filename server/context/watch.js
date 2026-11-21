// Tell every window when a context file changes on disk by any hand (the agent writing a lesson, an editor, git):
// one recursive watch on craft/ and data/craft/, quiet for 300 ms before it broadcasts { type: 'context' }.
// Started once, by the first read of the map. A folder that cannot be watched is simply left out.
import fs from 'node:fs';

let started = false;
export function watchCraft(dirs, broadcast) {
  if (started || typeof broadcast !== 'function' || process.env.NODE_TEST_CONTEXT) return; // never under node --test
  started = true;
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(() => broadcast({ type: 'context' }), 300); };
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const w = fs.watch(d, { recursive: true }, (ev, name) => { if (!/drafts\.json$|\.tmp$/.test(String(name || ''))) fire(); });
      w.on('error', () => {});
      w.unref?.();
    } catch {}
  }
}
