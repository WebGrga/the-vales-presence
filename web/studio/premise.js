// The premise lines the Titles stage judged as text, as a ranked list with the gate drawn in (E43).
// Lines at or above the gate got thumbnails; the ones below did not, and a line that failed the clarity check says why.
import { h } from '../shell/dom.js';

// pure: lines + gate -> { rows: [{ ...line, passes }], passed, gateAt } (best first; gateAt = index of the first row below the gate)
export function rankLines(lines, gate) {
  const list = (Array.isArray(lines) ? lines : []).map((l) => ({ ...l }));
  const cleared = list.filter((l) => l.clear !== false), failed = list.filter((l) => l.clear === false);
  cleared.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const has = Number.isFinite(gate);
  for (const l of cleared) l.passes = has && Number.isFinite(l.score) ? l.score >= gate : null;
  for (const l of failed) l.passes = false;
  const rows = [...cleared, ...failed];
  const gateAt = has ? (cleared.findIndex((l) => l.passes === false) < 0 ? cleared.length : cleared.findIndex((l) => l.passes === false)) : -1;
  return { rows, passed: cleared.filter((l) => l.passes).length, gateAt };
}

export function premiseList(doc) {
  const lines = doc.lines || [];
  if (!lines.length) return null;
  const { rows, passed, gateAt } = rankLines(lines, doc.gate);
  const row = (l) => h('li.st-line' + (l.passes ? '.pass' : '') + (l.clear === false ? '.fail' : ''),
    h('span.st-line-score', Number.isFinite(l.score) ? String(l.score) : '–'),
    h('div.st-line-text', h('b', l.title), l.premise ? h('span.dim', ` · ${l.premise}`) : null, l.clear === false ? h('span.st-line-why', `not clear to a stranger${l.failed ? `: ${l.failed}` : ''}`) : null));
  const items = [], SHOW = 8, hasGate = Number.isFinite(doc.gate);
  const gateRow = h('li.st-gate', h('span', `The gate: ${doc.gate} (the 3rd-best real title). Above it got thumbnails; below it did not.`));
  const more = (n, what) => h('li.st-more', `${n} more ${what}`);
  const above = hasGate ? rows.slice(0, gateAt) : rows, below = hasGate ? rows.slice(gateAt) : [];
  // the top of the list, then the gate, then the first lines under it: the gate is always on screen
  above.slice(0, SHOW).forEach((l) => items.push(row(l)));
  if (above.length > SHOW) items.push(more(above.length - SHOW, 'above the gate'));
  if (hasGate) items.push(gateRow);
  below.slice(0, SHOW).forEach((l) => items.push(row(l)));
  if (below.length > SHOW) items.push(more(below.length - SHOW, 'below it'));
  return h('details.st-premise', { open: true },
    h('summary', `The premise lines: ${lines.length} judged as text${Number.isFinite(doc.gate) ? `, ${passed} at or above the gate` : ''}`),
    h('ol.st-lines', ...items));
}
