// A question of the agent can point at its example: a path of a video or a picture in the project (`video/out/proof.mp4`,
// `studio/thumbs/a.png`) in the question or in an option. The question card shows it right there, as a player or a
// picture, so you can say "this is it" without hunting for the file. Pure; tested in agent-media.test.js.
// Only files inside the project: a path with `..`, a web address, or an absolute path outside this project is left alone
// (the server's media route refuses those too).

const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v']);
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const TOKEN = /(?:[A-Za-z]:)?[\w@%+~\-./\\]*[\w@%+\-]\.(mp4|webm|mov|m4v|jpe?g|png|webp|gif)(?![\w])/gi;

// a path as the agent wrote it -> the path inside the project, or null
export function projectPath(raw, projectId) {
  let p = String(raw || '').replace(/\\/g, '/').trim();
  if (!p) return null;
  const abs = /^[A-Za-z]:\//.test(p) || p.startsWith('/') || p.startsWith('~');
  if (abs) {
    // an absolute path counts only when it runs through this project's own folder: .../projects/<id>/...
    const mark = `/projects/${String(projectId || '').toLowerCase()}/`;
    const at = projectId ? p.toLowerCase().indexOf(mark) : -1;
    if (at < 0) return null;
    p = p.slice(at + mark.length);
  }
  p = p.replace(/^(\.\/)+/, '');
  if (!p || p.split('/').some((s) => s === '..' || s === '')) return null;
  return p;
}

// text -> [{ path, kind: 'video'|'image' }] in the order they appear, each once (at most `max`)
export function mediaPaths(text, projectId, max = 4) {
  const s = String(text || '').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' '); // web addresses are not project files
  const seen = new Set(), out = [];
  for (const m of s.matchAll(TOKEN)) {
    const path = projectPath(m[0], projectId);
    if (!path || seen.has(path.toLowerCase())) continue;
    const ext = m[1].toLowerCase();
    seen.add(path.toLowerCase());
    out.push({ path, kind: VIDEO.has(ext) ? 'video' : IMAGE.has(ext) ? 'image' : null });
    if (out.length >= max) break;
  }
  return out.filter((x) => x.kind);
}

// a question { question, header, options: [{ label, description }] } -> its media (question text first, then the options)
export function questionMedia(q, projectId, max = 4) {
  const texts = [q?.header, q?.question, ...(q?.options || []).flatMap((o) => [typeof o === 'string' ? o : o?.label, o?.description])];
  return mediaPaths(texts.filter(Boolean).join('\n'), projectId, max);
}
