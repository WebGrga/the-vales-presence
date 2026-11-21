// Resizable panels: a bar between two panes that sets a CSS variable on the layout (a size in px), remembered in this
// browser. split(bar, { host, name, axis: 'x'|'y', min, max, invert }) where invert = the pane grows when the bar moves
// left/up (a pane on the right or at the bottom). Until you drag a bar the stylesheet's own default holds (it may be
// a share of the room, like the agent panel's), so restoreSizes sets only the sizes you chose.

const LS = 'presence.layout';
const saved = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };

export function restoreSizes(host, defaults) {
  const s = saved();
  for (const name of Object.keys(defaults)) if (Number(s[name]) > 0) host.style.setProperty(`--${name}`, `${s[name]}px`);
}

// the size the pane has on screen now: the pane after the bar when it grows as the bar moves left/up, else the one before
function measured(bar, axis, invert) {
  const pane = invert ? bar.nextElementSibling : bar.previousElementSibling;
  if (!pane) return 0;
  const r = pane.getBoundingClientRect();
  return axis === 'x' ? r.width : r.height;
}

export function split(bar, { host, name, axis = 'x', min = 120, max = 2000, invert = false, onMove }) {
  bar.classList.add('split', axis === 'x' ? 'split-x' : 'split-y');
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
  bar.title = 'Drag to resize · double-click resets';
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const start = axis === 'x' ? e.clientX : e.clientY;
    const set = parseFloat(host.style.getPropertyValue(`--${name}`));
    const cur = Number.isFinite(set) && set > 0 ? set : measured(bar, axis, invert);
    document.body.classList.add('resizing', axis === 'x' ? 'resizing-x' : 'resizing-y');
    const move = (ev) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - start;
      const v = Math.round(Math.min(max, Math.max(min, cur + (invert ? -d : d))));
      host.style.setProperty(`--${name}`, `${v}px`);
      onMove?.();
    };
    const up = () => {
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
      const v = parseFloat(host.style.getPropertyValue(`--${name}`));
      if (Number.isFinite(v)) { try { localStorage.setItem(LS, JSON.stringify({ ...saved(), [name]: v })); } catch {} }
      onMove?.();
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  });
  bar.addEventListener('dblclick', () => {
    host.style.removeProperty(`--${name}`);
    const s = saved(); delete s[name];
    try { localStorage.setItem(LS, JSON.stringify(s)); } catch {}
    onMove?.();
  });
}
