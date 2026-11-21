// The queue across projects (pure, tested in queue-view.test.js): what runs now, what waits for you, what waits in line
// and behind what. rows come from the runner (run.js overview): one per project that has a current stage.
//   { id, title, stage, stageTitle, status ('running'|'waiting'|'queued'|...), busy, heavy, since, asking, position, behind: [titles], halted, stopAfter }
// -> { running: [...], waitingForYou: [...], inLine: [...], slots: { used, limit }, empty }

export function describe(rows, { limit = 1 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const running = list.filter((r) => r.busy && r.status !== 'queued')
    .map((r) => ({ project: r.id, title: r.title, stage: r.stage, stageTitle: r.stageTitle, since: r.since || null, heavy: !!r.heavy, asking: !!r.asking, stopAfter: !!r.stopAfter }))
    .sort((a, b) => (a.since || 0) - (b.since || 0));
  const inLine = list.filter((r) => r.status === 'queued' || r.position > 0)
    .map((r) => ({ project: r.id, title: r.title, stage: r.stage, stageTitle: r.stageTitle, position: r.position || 0, behind: r.behind || [] }))
    .sort((a, b) => (a.position || 99) - (b.position || 99));
  const waitingForYou = list.filter((r) => !r.busy && !(r.position > 0) && (r.halted || (r.status === 'waiting')))
    .map((r) => ({ project: r.id, title: r.title, stage: r.stage, stageTitle: r.stageTitle, halted: !!r.halted, asking: !!r.asking }));
  const used = running.filter((r) => r.heavy).length;
  return { running, waitingForYou, inLine, slots: { used, limit }, empty: !running.length && !inLine.length && !waitingForYou.length };
}

// pure: one sentence for a line in the queue: "Other video waits behind Rough cut of Podcast"
export function lineText(l) {
  const b = (l.behind || []).filter(Boolean);
  if (!b.length) return `${l.title} is next in line.`;
  const first = b[0];
  return `${l.title} waits behind ${first}${b.length > 1 ? ` and ${b.length - 1} more` : ''}.`;
}
