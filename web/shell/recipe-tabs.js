// Which tab a recipe's stages want (pure, no DOM; tested in recipe-tabs.test.js): the tab to open a new project on, the
// tabs a recipe uses (the others are hidden), the tab the current stage wants you on, and the "Next:" line after Create.

const BY_ID = {
  research: 'studio', plan: 'studio', 'plan-review': 'studio', script: 'studio', titles: 'studio', thumbnails: 'studio', feed: 'studio', upload: 'studio',
  pick: 'shorts', 'pick-review': 'shorts', cut: 'shorts', review: 'shorts',
};
export const ALWAYS = ['edit', 'context', 'export', 'setup', 'settings'];

// the tab a stage works in: its own `tab`, else by its id, else the export stage's Export tab, else Edit
export const stageTab = (st) => st?.tab || BY_ID[st?.id] || (st?.kind === 'export' ? 'export' : 'edit');

// the stage a project stands on (recipe = { stages }, project = { at, done })
export const currentStage = (project, recipe) => (project && !project.done ? (recipe?.stages || []).find((s) => s.id === project.at) || null : null);

// the tabs this recipe uses -> Set of tab ids (null = no recipe known: show them all)
export function tabsFor(recipe) {
  if (!recipe?.stages?.length) return null;
  if (Array.isArray(recipe.tabs)) return new Set([...ALWAYS, ...recipe.tabs]);
  const used = new Set(ALWAYS);
  for (const s of recipe.stages) used.add(stageTab(s));
  // a long edit gets its Upload page in the Studio, and offers "Shorts from this edit" in the Shorts tab
  if (recipe.format === 'long') { used.add('studio'); if (recipe.stages.some((s) => s.id === 'rough')) used.add('shorts'); }
  return used;
}

// where a new project opens and what it says to do next. opts: { footage: files were added, topic: a topic was typed }
// recipe.card.start = { tab, tabNoFootage?, hint, withFootage?: { tab?, hint }, withTopic?: { hint } }
export function startFor(recipe, { footage = false, topic = false } = {}) {
  const first = recipe?.stages?.[0];
  const s = recipe?.card?.start || recipe?.start || {};
  const pick = (footage && s.withFootage) || (topic && s.withTopic) || s;
  const tab = (footage ? pick.tab || s.tab : s.tabNoFootage || s.tab) || stageTab(first);
  return { tab, hint: pick.hint || s.hint || (first ? `Next: ${first.kind === 'ask' || first.kind === 'make' || first.kind === 'inspect' ? 'press Go' : 'open the stage bar'} for ${first.title || first.id}.` : '') };
}
