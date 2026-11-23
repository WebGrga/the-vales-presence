// A stage ended: a toast "Visuals is done: watch it" with a button that opens the Edit tab and plays the result, and a
// short soft sound (off in Settings). The desktop note and the tab-title badge are notify.js. The words and the choice
// of what counts are pure (tested in stage-done.test.js).
import { toast } from './toast.js';

const SOUND = 'presence.sound'; // 'off' | absent (on)
export const soundOn = () => { try { return localStorage.getItem(SOUND) !== 'off'; } catch { return true; } };
export const setSound = (on) => { try { if (on) localStorage.removeItem(SOUND); else localStorage.setItem(SOUND, 'off'); } catch {} };

const DONE = new Set(['ended', 'yours', 'finished']);
// pure: a 'notify' message -> the toast's words, or null when the event is not "a stage is done"
export function doneWords(m) {
  if (!m || !DONE.has(m.kind)) return null;
  const stage = m.stageTitle || m.stage || 'The stage';
  return `${stage} is done: watch it`;
}

let ctx = null;
// two soft notes (a sine with a slow attack and a long fade); a browser that has not been touched yet stays silent
export function chime() {
  if (!soundOn()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.02;
    [[659.25, 0], [880, 0.16]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + d + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.7);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.75);
    });
  } catch {}
}

export function mountStageDone(app) {
  async function watch(project) {
    if (project && project !== app.project()?.id) { try { await app.select(project); } catch {} }
    app.openTab('edit');
    for (let i = 0; i < 40 && !app.hooks.watch; i++) await new Promise((r) => setTimeout(r, 100));
    app.hooks.watch?.();
  }
  app.watchResult = watch;
  // the first stage that runs: one line asks for desktop notifications (notify.js keeps a "no" for good)
  const off = app.on('live', (m) => { if (m.view?.running) { off?.(); setTimeout(() => app.notify?.offer(document.getElementById('stagebar')), 600); } });
  app.on('notify', (m) => {
    const words = doneWords(m);
    if (!words) return;
    chime();
    toast(words, 'ok', 15000, { action: { label: 'Watch', fn: () => watch(m.project) } });
  });
}
