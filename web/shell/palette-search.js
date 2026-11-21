// The command palette's search (pure, tested in palette-search.js's test): items { id, group, label, hint?, words? } and a
// typed query -> the items that match, best first. Every typed word must match: at the start of a word of the label
// scores most, inside a word less, and a letter-by-letter match of the label least. No query lists the first few items of
// each group in their own order (more are found by typing).

const GROUP_ORDER = ['Actions', 'Tabs', 'Projects', 'Skills'];

function score(item, words) {
  const label = String(item.label).toLowerCase();
  const hay = `${label} ${String(item.words || '').toLowerCase()}`;
  const starts = label.split(/[\s:/_-]+/);
  let total = 0;
  for (const w of words) {
    if (starts.some((s) => s.startsWith(w))) total += label.startsWith(w) ? 12 : 10;
    else if (hay.includes(w)) total += 5;
    else {
      let i = 0; for (const c of label) if (c === w[i]) i++;
      if (i === w.length && w.length > 2) total += 2; else return 0;
    }
  }
  return total;
}

export function search(items, query, limit = 40) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const order = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 9 : i; };
  if (!words.length) {
    const seen = {};
    const cap = { Actions: 6, Tabs: 3, Projects: 4, Skills: 3 };
    return items.filter((it) => (seen[it.group] = (seen[it.group] || 0) + 1) <= (cap[it.group] || 4)).sort((a, b) => order(a.group) - order(b.group));
  }
  return items.map((it, n) => ({ it, s: score(it, words), n })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || order(a.it.group) - order(b.it.group) || a.n - b.n).slice(0, limit).map((x) => x.it);
}
