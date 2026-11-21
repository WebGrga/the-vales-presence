// Runs every engine/test_*.py with a Python that has numpy (and Pillow): `npm run test:engine`.
// The Python: $PRESENCE_PYTHON if set, else the first of python, python3, py -3 that imports numpy. Exits non-zero when a suite fails or no Python is found.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = path.join(root, "engine");

function works(cmd) {
  const r = spawnSync(cmd[0], [...cmd.slice(1), "-c", "import numpy, PIL, sys; print(sys.version.split()[0])"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function findPython() {
  const cands = [];
  if (process.env.PRESENCE_PYTHON) cands.push([process.env.PRESENCE_PYTHON]);
  cands.push(["python"], ["python3"]);
  if (process.platform === "win32") cands.push(["py", "-3"]);
  for (const c of cands) {
    const v = works(c);
    if (v) return { cmd: c, version: v };
  }
  return null;
}

const py = findPython();
if (!py) {
  console.error("No Python with numpy and Pillow found (tried PRESENCE_PYTHON, python, python3, py -3). Install Python 3.10+ and run: python -m pip install numpy pillow");
  process.exit(2);
}
const suites = fs.readdirSync(engine).filter((f) => /^test_.*\.py$/.test(f)).sort();
console.log(`engine tests with ${py.cmd.join(" ")} (Python ${py.version}): ${suites.length} suites`);
const failed = [];
for (const s of suites) {
  const t0 = Date.now();
  const r = spawnSync(py.cmd[0], [...py.cmd.slice(1), s], { cwd: engine, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PRESENCE_CONFIG: path.join(root, "no-such-config.json") } });
  const out = (r.stdout || "") + (r.stderr || "");
  const ran = (out.match(/^Ran (\d+) tests?/m) || [])[1] || "?";
  const ok = r.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${s.padEnd(18)} ${String(ran).padStart(3)} tests  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!ok) {
    failed.push(s);
    console.log(out.split("\n").slice(-40).join("\n"));
  }
}
console.log(failed.length ? `${failed.length} of ${suites.length} suites failed: ${failed.join(", ")}` : `all ${suites.length} suites passed`);
process.exit(failed.length ? 1 : 0);
