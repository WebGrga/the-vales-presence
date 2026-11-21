// Saving plan.md and script.md as the user types, without losing anyone's words. Pure.
// The browser sends the text and `base`, the file time it last saw. When the file changed on disk since then
// (the agent wrote it) and differs, the user's text is saved and the agent's version is kept as a backup.

// { diskText: string|null, diskMtime: number, base: number|undefined, text: string }
// -> { write: boolean, backup: boolean, conflict: boolean }
export function saveDecision({ diskText, diskMtime, base, text }) {
  if (typeof text !== 'string') return { write: false, backup: false, conflict: false };
  if (diskText === null || diskText === undefined) return { write: true, backup: false, conflict: false };
  if (diskText === text) return { write: false, backup: false, conflict: false };
  const changedSince = Number.isFinite(base) && base > 0 && diskMtime > base + 1;
  return { write: true, backup: changedSince, conflict: changedSince };
}

// the backup's name inside studio/.history/: plan-2026-11-20T09-31-05.md
export function backupName(file, now = new Date()) {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot) : '';
  return `${stem}-${stamp}${ext}`;
}

export const MAX_TEXT = 2_000_000; // 2 MB of text is far past any plan or script
