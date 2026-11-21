// Ending a background task for good. The SDK's stopTask ends the task's shell, but on Windows what the shell started
// can live on: a Git Bash tool such as `sleep` is started through a short-lived helper, so it ends up an orphan whose
// parent is gone, and `taskkill /T` can no longer find it. So before the SDK is asked, the process list is read; the
// task's shell is found by the command it was given and its tree is killed from the bottom up, and orphans that carry the
// same command and were born after the task started are killed too. The rules are pure and tested (task-kill.test.js).
import { execFile } from 'node:child_process';

const WIN = process.platform === 'win32';

// pure: process rows from the system's list. Windows: PowerShell JSON; elsewhere: `ps -eo pid=,ppid=,args=`
export function parseRows(text, win = WIN) {
  if (win) {
    let j;
    try { j = JSON.parse(String(text || '[]')); } catch { return []; }
    return (Array.isArray(j) ? j : [j]).filter(Boolean).map((r) => ({ pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId), name: String(r.Name || ''), cmd: String(r.CommandLine || ''), born: Number(r.Born) || 0 }));
  }
  return String(text || '').split('\n').map((l) => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), name: (m[3].split(/\s/)[0] || '').split('/').pop(), cmd: m[3], born: 0 }));
}

// pure: a piece of the command that the shell's own command line will contain (one line, no quotes, which the shell rewrites)
export function needleOf(command) {
  const first = String(command || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const cut = first.split(/['"\\]/)[0].trim();
  return cut.length >= 6 ? cut.slice(0, 80) : '';
}

// pure: a command line as the user wrote it: no quotes, no folder before the program, no .exe
export function plainCmd(line) {
  return String(line || '').replace(/"([^"]*[\\/])([^"\\/]+)"/g, '$2').replace(/"/g, '').replace(/^[A-Za-z]:[\\/]\S*[\\/]/, '').replace(/\.exe\b/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// pure: the shells whose command line holds the command (not this process, not the one asking)
export function shellsFor(rows, command, selfPids = []) {
  const needle = needleOf(command);
  if (!needle) return [];
  const own = new Set(selfPids);
  return rows.filter((r) => !own.has(r.pid) && /^(bash|sh|zsh|dash|cmd|powershell|pwsh)(\.exe)?$/i.test(r.name) && r.cmd.includes(needle)).map((r) => r.pid);
}

// pure: orphans (their parent is gone) that run the command and were born after the task started
export function orphansFor(rows, command, since, selfPids = []) {
  const needle = plainCmd(needleOf(command));
  if (!needle || !since) return [];
  const alive = new Set(rows.map((r) => r.pid)), own = new Set(selfPids);
  return rows.filter((r) => !own.has(r.pid) && !alive.has(r.ppid) && r.born >= since - 2000 && plainCmd(r.cmd).includes(needle)).map((r) => r.pid);
}

// pure: the roots and everything below them, deepest first
export function treeOf(rows, roots) {
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r.pid); }
  const out = [], seen = new Set();
  const walk = (pid, depth) => { if (seen.has(pid)) return; seen.add(pid); out.push({ pid, depth }); for (const k of kids.get(pid) || []) walk(k, depth + 1); };
  for (const r of roots) walk(r, 0);
  return out.sort((a, b) => b.depth - a.depth).map((x) => x.pid);
}

const run = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: 15000, windowsHide: true, maxBuffer: 16e6 }, (err, out) => resolve(err ? '' : String(out))));

const LIST = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n="Born";e={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress';
export async function snapshot() {
  if (WIN) return parseRows(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST]), true);
  return parseRows(await run('ps', ['-eo', 'pid=,ppid=,args=']), false);
}

// kill what a background command started (since: when the task started, ms); true when something was found
export async function killTaskTree(command, { rows = null, since = 0, selfPids = [process.pid] } = {}) {
  const all = rows || await snapshot();
  // the shells only below this process (another program's shell may hold the same words)
  const mine = new Set(treeOf(all, [selfPids[0]]));
  const roots = shellsFor(all.filter((r) => mine.has(r.pid)), command, selfPids);
  const orphans = orphansFor(all, command, since, selfPids);
  const pids = [...new Set([...treeOf(all, roots), ...treeOf(all, orphans)])].filter((p) => !selfPids.includes(p));
  for (const pid of pids) {
    if (WIN) await run('taskkill', ['/F', '/PID', String(pid)]);
    else { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
  return pids.length > 0;
}
