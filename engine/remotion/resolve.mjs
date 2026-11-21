// Which node_modules the Remotion side loads from. A workshop's own remotion/node_modules wins when it has the package (a template that pins
// its own Remotion keeps it); else the engine's own (engine/remotion/node_modules, from engine/remotion/package.json: `npm install` there once).
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const ENGINE_REMOTION = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_MODULES = path.join(ENGINE_REMOTION, "node_modules");

const has = (dir, pkg) => fs.existsSync(path.join(dir, "node_modules", ...pkg.split("/"), "package.json"));

// require(pkg) from the workshop's remotion folder when it has it, else from the engine's
export function load(remotionDir, pkg) {
  const from = remotionDir && has(remotionDir, pkg) ? remotionDir : ENGINE_REMOTION;
  return createRequire(path.join(from, "package.json"))(pkg);
}

// true when the workshop's own files cannot find "remotion" and the bundler must also look in the engine's node_modules
export function needsEngineModules(remotionDir) {
  return !has(remotionDir, "remotion");
}

// a bundler override that adds the engine's node_modules after the workshop's own (only when the workshop has none)
export function withEngineModules(remotionDir) {
  if (!needsEngineModules(remotionDir)) return (c) => c;
  return (c) => ({
    ...c,
    resolve: { ...(c.resolve || {}), modules: [...((c.resolve && c.resolve.modules) || ["node_modules"]), ENGINE_MODULES] },
  });
}
