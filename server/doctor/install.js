// The Setup tab's "Install yt-dlp": `uv tool install yt-dlp`, and nothing else. It needs uv (a check of its own). When the
// install is done, uv's tool folder is put on this server's PATH so the check and the research stage find yt-dlp at once,
// without a restart. The program runner is passed in, so the steps are tested with a fake one (install.test.js).
import path from 'node:path';

const SEP = process.platform === 'win32' ? ';' : ':';

// pure: PATH with dir added in front when it is not there yet
export function withDir(pathVar, dir, sep = SEP, caseless = process.platform === 'win32') {
  const d = String(dir || '').trim();
  if (!d) return pathVar;
  const norm = (x) => (caseless ? path.normalize(x).toLowerCase() : path.normalize(x)).replace(/[\\/]+$/, '');
  const have = String(pathVar || '').split(sep).filter(Boolean).map(norm);
  return have.includes(norm(d)) ? pathVar : `${d}${sep}${pathVar || ''}`;
}

// run: (cmd, args, opts) -> { code, out, err }. -> { ok, text } | { error }
export async function installYtDlp(run, env = process.env) {
  const v = await run('uv', ['--version']);
  if (v.code !== 0) return { error: 'uv is not installed, so yt-dlp cannot be installed from here. Install uv first (the check above shows how).' };
  const r = await run('uv', ['tool', 'install', 'yt-dlp'], { timeout: 4 * 60e3 });
  const said = `${r.out}\n${r.err}`.trim().split('\n').filter(Boolean).slice(-6).join('\n');
  if (r.code !== 0) return { error: `uv could not install yt-dlp${r.code == null ? ' (it took too long or did not start)' : ''}.${said ? '\n' + said : ''}` };
  const b = await run('uv', ['tool', 'dir', '--bin']);
  const dir = b.code === 0 ? b.out.trim().split('\n').pop().trim() : '';
  if (dir) env.PATH = withDir(env.PATH ?? env.Path, dir);
  return { ok: true, text: said || 'yt-dlp is installed.', bin: dir || null };
}
