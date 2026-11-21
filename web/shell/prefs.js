// Settings that belong to this browser, not to the server: the size of the whole screen. Kept in localStorage and
// applied at once on boot (app.js) and when Settings changes it. (Notifications keep theirs in notify.js.)
const KEY = 'presence.uiSize';
export const SIZES = [{ value: '90', label: 'Smaller (90%)' }, { value: '100', label: 'Normal (100%)' }, { value: '115', label: 'Larger (115%)' }, { value: '130', label: 'Largest (130%)' }];

export const uiSize = () => { try { const v = localStorage.getItem(KEY); return SIZES.some((s) => s.value === v) ? v : '100'; } catch { return '100'; } };
export function setUiSize(v) { try { if (v === '100') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch {} applyUiSize(); }

// the whole page is zoomed; --ui-zoom lets the height of the page stay the window's
export function applyUiSize() {
  const z = Number(uiSize()) / 100;
  document.documentElement.style.setProperty('--ui-zoom', String(z));
  document.documentElement.style.zoom = z === 1 ? '' : String(z);
}
