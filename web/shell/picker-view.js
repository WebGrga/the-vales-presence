// The project picker's decisions (pure, no DOM; tested in picker-view.test.js): what the list shows for each answer
// of GET /api/projects, the words under each project, and where the popover sits so it stays inside the window.

const listOf = (x) => (Array.isArray(x) ? x : Array.isArray(x?.projects) ? x.projects : null);

// { ok: true, projects } | { ok: false, error } -> what to show: 'list' | 'empty' | 'error'
// "No projects yet" only when the server answered with an empty list; a failed call is an error, never "no projects".
export function listState(res) {
  if (!res || res.ok === false) return { show: 'error', error: res?.error || 'no answer from the server', projects: [] };
  const projects = listOf(res.projects);
  if (!projects) return { show: 'error', error: 'the server sent something that is not a list of projects', projects: [] };
  return { show: projects.length ? 'list' : 'empty', projects };
}

// "Edit a video · 4 of 7: Visuals" (the recipe's own names; the raw ids only when the recipe is unknown)
export function rowWords(p, recipes) {
  const r = (recipes || []).find((x) => x.id === p?.recipe);
  const stages = r?.stages || [];
  const i = stages.findIndex((s) => s.id === p?.at);
  const where = p?.done ? 'finished' : i >= 0 ? `${i + 1} of ${stages.length}: ${stages[i].title || stages[i].id}` : (p?.at ? String(p.at).replace(/[-_]+/g, ' ') : '');
  return [r?.name || p?.recipe || '', where].filter(Boolean).join(' · ');
}

// the popover's left edge (relative to its anchor) so that it stays inside the window with a margin
export function popLeft(anchorLeft, popWidth, winWidth, margin = 8) {
  const maxRight = winWidth - margin;
  let left = 0;
  if (anchorLeft + popWidth > maxRight) left = maxRight - popWidth - anchorLeft;
  if (anchorLeft + left < margin) left = margin - anchorLeft;
  return Math.round(left);
}
