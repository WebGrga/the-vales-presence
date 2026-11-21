// Small DOM helpers shared by the shell and the editor.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// h('div.cls#id', { attrs, on: { click } }, ...children)
export function h(tag, props, ...kids) {
  const [, name = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

// a pixel icon (web/icons/<name>.png, drawn by tools/gen_icons.py)
export function icon(name, small) {
  const img = document.createElement('img');
  img.src = `/icons/${name}.png`; img.alt = ''; img.className = 'icon' + (small ? ' sm' : ''); img.draggable = false;
  return img;
}

// a button with an icon and a label (label '' = icon only)
export function button(iconName, label, title, onClick, cls = '') {
  const b = h('button' + (cls ? '.' + cls.split(' ').join('.') : ''), { type: 'button', title: title || label || '' });
  if (iconName) b.append(icon(iconName, !label ? false : true));
  if (label) b.append(h('span', label)); else b.classList.add('icon-only');
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// run fn at most once every ms (the last call wins); .flush() runs a waiting call now
export function debounce(fn, ms) {
  let timer = null, args = null;
  const d = (...a) => { args = a; clearTimeout(timer); timer = setTimeout(() => { timer = null; fn(...args); }, ms); };
  d.flush = () => { if (timer) { clearTimeout(timer); timer = null; fn(...args); } };
  d.pending = () => !!timer;
  return d;
}
