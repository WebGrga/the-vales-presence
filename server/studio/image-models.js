// AI image models for thumbnail backgrounds and props, pure: the list from craft/image-models.json with the user's
// overrides from data/craft/image-models.json laid over it by id, and an entry's command filled in.
// Nothing is enabled by default; an entry runs only when the user set "enabled": true and its env vars exist.

const str = (v, n = 2000) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : '');

export function loadModels(base, overlay) {
  const list = (o) => (Array.isArray(o) ? o : Array.isArray(o?.models) ? o.models : []).filter((m) => m && typeof m === 'object' && str(m.id));
  const byId = new Map(list(base).map((m) => [m.id, { ...m }]));
  for (const m of list(overlay)) byId.set(m.id, { ...(byId.get(m.id) || {}), ...m });
  return [...byId.values()].map((m) => ({
    id: str(m.id, 60), name: str(m.name, 120) || str(m.id, 60), kind: m.kind === 'api' ? 'api' : 'local',
    enabled: m.enabled === true, command: m.command, env: Array.isArray(m.env) ? m.env.map((e) => str(e, 80)).filter(Boolean) : [],
    about: str(m.about, 600), price: str(m.price, 200), time: str(m.time, 200), needs: str(m.needs, 300),
    width: Number(m.width) || 1344, height: Number(m.height) || 768,
  }));
}

// split a command string like a shell would for quotes, but never through a shell
export function tokenize(cmd) {
  const out = []; let cur = '', q = null, any = false;
  for (const c of String(cmd)) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; any = true; continue; }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}

// the command as an argument list with {prompt} {out} {width} {height} {seed} {app} filled in, one value per argument
export function fillCommand(model, vars) {
  const args = Array.isArray(model?.command) ? model.command.map(String) : tokenize(model?.command || '');
  if (!args.length) return null;
  return args.map((a) => a.replace(/\{(prompt|out|width|height|seed|app)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k]))));
}

export const missingEnv = (model, env) => (model?.env || []).filter((k) => !env[k]);

// -> { model } | { error } in plain words
export function pickModel(models, id, env) {
  const m = models.find((x) => x.id === id);
  if (!m) return { error: `No image model "${id}". Known: ${models.map((x) => x.id).join(', ') || 'none'}.` };
  if (!m.enabled) return { error: `The image model "${id}" is not enabled. Turn it on in data/craft/image-models.json ({"models":[{"id":"${id}","enabled":true}]}); see docs/thumbnails-ai-images.md.` };
  const miss = missingEnv(m, env);
  if (miss.length) return { error: `The image model "${id}" needs ${miss.join(', ')} in the environment.` };
  return { model: m };
}

// what the Studio tab shows: no commands, only names, kinds, whether it is ready
export const publicList = (models, env) => models.map((m) => ({ id: m.id, name: m.name, kind: m.kind, enabled: m.enabled, ready: m.enabled && !missingEnv(m, env).length, about: m.about, price: m.price, time: m.time, needs: m.needs }));
