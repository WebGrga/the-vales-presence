// Is the live link still alive? A WebSocket that the other side stopped answering (the PC slept, the server was killed
// without closing it) stays "open" in the browser and nothing ever arrives on it: the page looks frozen until a refresh.
// So the page asks: when nothing was heard for QUIET ms it sends a ping (the server answers with a pong), and when
// nothing at all came back within GRACE ms the link is dead and is opened again. Pure; the timers are in api.js.
export const WATCH = { every: 10000, quiet: 25000, grace: 8000 };

// { now, lastHeard (ms of the last message of any kind), pingAt (ms of the ping nobody answered yet, or 0) } -> 'ok' | 'ping' | 'dead'
// `quiet` can be given shorter (the page just came back to the front, the network came back).
export function watchStep({ now, lastHeard, pingAt = 0 }, o = {}) {
  const quiet = o.quiet ?? WATCH.quiet, grace = o.grace ?? WATCH.grace;
  if (pingAt) return now - pingAt > grace ? 'dead' : 'ok';
  return now - lastHeard > quiet ? 'ping' : 'ok';
}
