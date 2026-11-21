// The keys that work in every tab (pure, tested in app-keys.test.js), and their list for the ? overlay.
//   1 to 7 switch tabs · Ctrl+O the Projects page · Ctrl+Enter Go or Approve · Ctrl+K the command palette · Ctrl+Z undo
//   (outside the Edit tab, which keeps its own) · ? shows the keys.
// Nothing fires while you type in a field, while a dialog or the palette is open, or with Alt held.
import { comboOf, ownsKeys } from '../editor/keys.js';

export const TAB_KEYS = ['edit', 'shorts', 'studio', 'context', 'export', 'setup', 'settings'];

// the groups the ? overlay shows first
export const APP_KEYS = [
  { keys: ['1', '…', '7'], label: 'Go to the tab: 1 Edit, 2 Shorts, 3 Studio, 4 Context, 5 Export, 6 Setup, 7 Settings' },
  { keys: ['Ctrl+O'], label: 'Open the Projects page' },
  { keys: ['Ctrl+Enter'], label: 'Go (or Approve, after asking you to confirm)' },
  { keys: ['Ctrl+K'], label: 'Command palette: actions, projects, tabs, skills' },
  { keys: ['Ctrl+Z'], label: 'Undo the last Studio or Context change (the Edit tab keeps its own Ctrl+Z)' },
];

// e: a key event; ctx: { tab, blocked: a dialog/palette is open }. -> { action, arg? } | null
export function appAction(e, ctx = {}) {
  if (ctx.blocked || e.altKey || e.isComposing) return null;
  if (ownsKeys(e.target)) return null;
  const combo = comboOf(e);
  if (/^[1-7]$/.test(combo)) return { action: 'tab', arg: TAB_KEYS[Number(combo) - 1] };
  if (combo === 'ctrl+o') return { action: 'projects' };
  if (combo === 'ctrl+enter') return { action: 'go' };
  if (combo === 'ctrl+k') return { action: 'palette' };
  if (combo === 'ctrl+z' && ctx.tab !== 'edit') return { action: 'undo' };
  return null;
}
