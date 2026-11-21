// The doctor's probes: each runs a tool (or reads a file) and hands the output to a judge in parse.js.
// Nothing here installs anything; a probe that hangs is cut off. runDoctor() runs them all at once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as P from './parse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXES = JSON.parse(fs.readFileSync(path.join(here, 'fixes.json'), 'utf8'));

// run a program, never throws: { code, out, err } (code null = not found or timed out)
export function run(cmd, args = [], { timeout = 10000, shell = false, cwd } = {}) {
  return new Promise((done) => {
    let out = '', err = '', fin = false;
    const end = (code) => { if (!fin) { fin = true; clearTimeout(t); done({ code, out, err }); } };
    let p;
    try { p = spawn(cmd, args, { windowsHide: true, shell, cwd }); } catch (e) { return done({ code: null, out: '', err: String(e.message) }); }
    const t = setTimeout(() => { try { p.kill(); } catch {} end(null); }, timeout);
    p.stdout?.on('data', (d) => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    p.stderr?.on('data', (d) => { err += d; if (err.length > 2e5) err = err.slice(-1e5); });
    p.on('error', (e) => { err += String(e.message); end(null); });
    p.on('close', (code) => end(code));
  });
}

const WIN = process.platform === 'win32';

async function checkNode() {
  return { id: 'node', title: 'Node.js 22+', required: true, ...P.judgeNode(process.versions.node) };
}

async function checkFf() {
  const [a, b] = await Promise.all([run('ffmpeg', ['-hide_banner', '-version']), run('ffprobe', ['-hide_banner', '-version'])]);
  // -hide_banner drops the first line on some builds: ask again without it
  const [a2, b2] = await Promise.all([P.ffVersion(a.out) ? a : run('ffmpeg', ['-version']), P.ffVersion(b.out) ? b : run('ffprobe', ['-version'])]);
  return { id: 'ffmpeg', title: 'ffmpeg and ffprobe', required: true, ...P.judgeFf(a2.out, b2.out) };
}

async function checkUv() {
  const r = await run('uv', ['--version']);
  return { id: 'uv', title: 'uv (runs speech-to-text)', required: true, ...P.judgeUv(r.out) };
}

async function checkPython() {
  const tries = WIN ? [['python', []], ['py', ['-3']], ['python3', []]] : [['python3', []], ['python', []]];
  let first = null;
  for (const [cmd, pre] of tries) {
    const r = await run(cmd, [...pre, '-c', P.PY_PROBE], { timeout: 20000 });
    const found = P.parsePython(r.out);
    if (!found) continue;
    const label = [cmd, ...pre].join(' ');
    const j = P.judgePython(found, label);
    if (j.status === 'ok') return { id: 'python', title: 'Python 3 with numpy and Pillow', required: true, ...j, cmd: label };
    first ??= { ...j, cmd: label };
  }
  return { id: 'python', title: 'Python 3 with numpy and Pillow', required: true, ...(first || P.judgePython(null)) };
}

async function otherGpu(osName) {
  if (osName === 'win') return (await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'], { timeout: 15000 })).out;
  if (osName === 'mac') return (await run('system_profiler', ['SPDisplaysDataType'], { timeout: 15000 })).out;
  return (await run('lspci', [])).out;
}

async function checkGpu(osName) {
  const [smi, enc] = await Promise.all([
    run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader']),
    run('ffmpeg', ['-hide_banner', '-encoders']),
  ]);
  const gpus = smi.code === 0 ? P.parseNvidiaSmi(smi.out) : [];
  const other = gpus.length ? '' : P.otherGpuName(osName, await otherGpu(osName));
  const listed = P.listedEncoders(enc.out);
  let encoder = null;
  for (const e of P.encoderCandidates(listed)) {
    // a real encode of a tiny clip: a listed encoder can still fail (no driver, no device)
    const r = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30', '-frames:v', '5', '-c:v', e, '-f', 'null', '-'], { timeout: 15000 });
    if (r.code === 0) { encoder = e; break; }
  }
  return { id: 'gpu', title: 'GPU and video encoder', required: false, ...P.judgeGpu({ gpus, other, encoder, cpu264: listed.has('libx264') || listed.size === 0 }) };
}

// the Agent SDK starts a session (no prompt is sent, so nothing is spent) and says who is logged in
async function accountInfo(root) {
  const req = createRequire(path.join(root, 'package.json'));
  let entry;
  try { entry = req.resolve('@anthropic-ai/claude-agent-sdk'); } catch { return { missing: true }; }
  const { query } = await import(pathToFileURL(entry).href);
  let release;
  const hold = new Promise((r) => (release = r));
  async function* prompt() { await hold; }
  let q;
  try {
    q = query({ prompt: prompt(), options: { cwd: os.tmpdir(), settingSources: [], persistSession: false, maxTurns: 1 } });
    const info = await Promise.race([q.accountInfo(), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 30000))]);
    return { info };
  } catch (e) {
    return { error: String(e?.message || e) };
  } finally {
    release();
    try { q?.close(); } catch {}
  }
}

async function checkClaude(root) {
  const [cli, acct] = await Promise.all([run('claude', ['--version'], { shell: WIN, timeout: 15000 }), accountInfo(root)]);
  const v = cli.code === 0 ? P.claudeVersion(cli.out) : null;
  if (acct.missing) return { id: 'claude', title: 'Claude Code login', required: true, status: 'fail', found: 'the Agent SDK is not installed', why: 'run npm install in the repository folder', fixId: 'sdk' };
  const j = P.judgeAccount(acct.info || null, v);
  if (acct.error && j.status === 'fail') j.why = `${j.why} (${acct.error.split('\n')[0].slice(0, 160)})`;
  return { id: 'claude', title: 'Claude Code login', required: true, ...j };
}

async function checkDisk(dataDir) {
  let free = null;
  try { fs.mkdirSync(dataDir, { recursive: true }); const s = fs.statfsSync(dataDir); free = s.bavail * s.bsize; } catch {}
  return { id: 'disk', title: 'Free disk space', required: true, ...P.judgeDisk(free) };
}

async function checkRemotion(root) {
  const dir = path.join(root, 'engine', 'remotion');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const pkg = read(path.join(dir, 'package.json'));
  const inst = read(path.join(dir, 'node_modules', 'remotion', 'package.json'));
  const wanted = pkg?.dependencies?.remotion || pkg?.devDependencies?.remotion || null;
  return { id: 'remotion', title: 'Remotion (draws the overlays)', required: true, ...P.judgeRemotion({ wanted, installed: inst?.version || null, hasPackage: !!pkg }) };
}

// every check, in the order the Setup tab lists them
export async function runChecks({ root, dataDir, platform = process.platform }) {
  const osName = P.osOf(platform);
  const t0 = Date.now();
  const list = await Promise.all([
    checkNode(), checkFf(), checkPython(), checkUv(), checkClaude(root), checkRemotion(root), checkGpu(osName), checkDisk(dataDir),
  ].map((p, i) => p.catch((e) => ({ id: `check${i}`, title: 'a check', required: false, status: 'warn', found: 'the check itself failed', why: String(e?.message || e) }))));
  const checks = list.map((c) => {
    const { fixId, ...rest } = c;
    return { ...rest, fix: c.status === 'ok' ? null : P.fixFor(FIXES, fixId || c.id, osName) };
  });
  return { os: osName, at: new Date().toISOString(), ms: Date.now() - t0, ...P.summarise(checks), checks };
}
