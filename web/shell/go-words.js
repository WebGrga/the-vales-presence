// The words of the line before Go (pure, tested in go-words.test.js). info = the server's go-info:
// { title, skills, names, missing, heavy, usualMs, usualCost, runs }. Nothing is invented: with no past run it says so.
export function roughWords(info, fmtMs = (x) => `${Math.round(x / 1000)} s`) {
  if (!info) return '';
  const parts = [info.title];
  parts.push(info.skills ? `reads ${info.skills} skill${info.skills === 1 ? '' : 's'}` : 'reads no skills');
  if (info.missing?.length) parts.push(`${info.missing.length} switched on but missing`);
  if (info.usualMs) {
    const m = Math.round(info.usualMs / 60000);
    parts.push(`usually ${m < 2 ? 'about a minute' : `about ${m < 10 ? m : Math.round(m / 5) * 5} min`}${info.runs ? ` (${info.runs} past run${info.runs === 1 ? '' : 's'})` : ''}`);
  } else parts.push('no past run to guess the time from');
  if (info.heavy) parts.push('a render: it may wait in line');
  return parts.join(' · ');
}
