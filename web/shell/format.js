// A project's format, "long" (16:9) or "short" (9:16), in one place (pure; server and web both import it, tested in format.test.js).
// A recipe has a default `format`. A recipe that can be either lists `formats: ["long","short"]`; its project then carries
// its own `project.format`, which wins. A stage may carry `short: { focus, title, out }`, what it says instead when the
// project is a Short. Every layout, size, prompt and tab asks here, never `recipe.format` for a project.

export const FORMATS = ['long', 'short'];
export const isFormat = (f) => FORMATS.includes(f);
export const LABEL = { long: 'Long video (16:9)', short: 'Short (9:16)' };

// the formats a recipe can be made in (its default first); a recipe with one format has one
export function formatsOf(recipe) {
  const list = Array.isArray(recipe?.formats) ? recipe.formats.filter(isFormat) : [];
  const own = isFormat(recipe?.format) ? recipe.format : null;
  const all = [...new Set([...(own ? [own] : []), ...list])];
  return all;
}
export const canChoose = (recipe) => formatsOf(recipe).length > 1;

// the format a project is in: its own choice when the recipe allows it, else the recipe's (null when the recipe has none)
export function formatOf(project, recipe) {
  const f = project?.format;
  if (isFormat(f) && formatsOf(recipe).includes(f)) return f;
  return isFormat(recipe?.format) ? recipe.format : null;
}

// the recipe as this project is: `format` set, and each stage's `<format>` override on top of the stage
export function recipeFor(recipe, project) {
  if (!recipe) return recipe;
  const format = formatOf(project, recipe);
  const stages = (recipe.stages || []).map((s) => {
    const o = format && s[format] && typeof s[format] === 'object' ? s[format] : null;
    return o ? { ...s, ...o } : s;
  });
  return { ...recipe, ...(format ? { format } : {}), stages };
}

// the recipe id the stage-skills lists use for a project's format: a two-format recipe made as a Short reads "<id>-short/<stage>" first, then "<id>/<stage>"
// (`recipe` is the project's recipe as recipeFor made it)
export const skillRecipe = (recipe) => (canChoose(recipe) && recipe.format === 'short' ? `${recipe.id}-short` : recipe?.id);

// pure: the format an agent wrote in .presence/format ("format: short", or just "short"), or null
export function parseFormatFile(text) {
  const m = /^\s*(?:format\s*[:=]\s*)?["']?(long|short)["']?\s*$/im.exec(String(text || '').split(/\r?\n/).find((l) => l.trim()) || '');
  return m ? m[1].toLowerCase() : null;
}
