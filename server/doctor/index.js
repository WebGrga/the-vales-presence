// The doctor: is this machine ready? One run at a time, the answer kept for 10 minutes (the Claude check starts a session and takes a few seconds).
import { runChecks } from './checks.js';

const KEEP_MS = 10 * 60 * 1000;
let last = null, running = null;

export async function doctor({ root, dataDir, fresh = false }) {
  if (!fresh && last && Date.now() - last.t < KEEP_MS) return last.result;
  if (running) return running;
  running = runChecks({ root, dataDir }).then((result) => { last = { t: Date.now(), result }; return result; }).finally(() => { running = null; });
  return running;
}
