// What the agent added to the user's house rules during a stage (pure, tested): the list items that are in `after`
// and not in `before`, as short lines for a notice. Edited or removed lines are not reported.
export function addedRules(before, after, { max = 4, width = 160 } = {}) {
  const item = (l) => /^\s*[-*]\s+\S/.test(l);
  const had = new Set(String(before ?? '').split(/\r?\n/).filter(item).map((l) => l.trim()));
  const out = [];
  for (const l of String(after ?? '').split(/\r?\n/)) {
    if (!item(l) || had.has(l.trim())) continue;
    const t = l.trim().replace(/^[-*]\s+/, '').replace(/\s*_\([^)]*\)_\s*$/, '');
    out.push(t.length > width ? t.slice(0, width - 1) + '…' : t);
  }
  return out.slice(0, max);
}

// the sentence of the notice, or '' when nothing was added
export function rulesNotice(lines) {
  return lines.length ? `House rules updated: ${lines.map((l) => `“${l}”`).join('; ')}` : '';
}
