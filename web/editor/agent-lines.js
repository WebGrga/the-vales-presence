// The agent panel's words for what the agent does (pure, no DOM; tested in agent-lines.test.js): a tool row says the
// agent's own description ("Transcribe the recording") instead of a raw shell command, and paths are shown relative to
// the project ("video/out/edl.json") instead of the full path into someone's home folder.

// a path relative to the project when it is inside it; else the last parts of it
export function shortPath(p, projectId) {
  let s = String(p ?? '').replace(/\\/g, '/').replace(/^["']|["']$/g, '');
  if (!s) return '';
  if (projectId) {
    const i = s.toLowerCase().lastIndexOf(`/projects/${String(projectId).toLowerCase()}/`);
    if (i >= 0) return s.slice(i + `/projects/${projectId}/`.length) || '.';
    if (s.toLowerCase().endsWith(`/projects/${String(projectId).toLowerCase()}`)) return '.';
  }
  const abs = /^([a-z]:\/|\/|~\/)/i.test(s);
  if (!abs) return s;
  const parts = s.split('/').filter(Boolean);
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : s;
}

// every absolute path in a command made short; a leading `cd "<project>" &&` dropped
export function shortCommand(cmd, projectId) {
  let s = String(cmd ?? '').trim();
  s = s.replace(/"((?:[a-z]:|~)?[\\/][^"]+)"|'((?:[a-z]:|~)?[\\/][^']+)'|((?:[a-z]:|~)[\\/][^\s"';|&<>]+)/gi, (all, a, b, c) => {
    const p = a || b || c;
    const q = a ? '"' : b ? "'" : '';
    const r = shortPath(p, projectId);
    return r === '.' ? q + '.' + q : q + r + q;
  });
  s = s.replace(/^cd\s+["']?\.["']?\s*(&&|;)\s*/, '');
  return s.replace(/\s+/g, ' ');
}

const host = (u) => { try { return new URL(u).host; } catch { return String(u || ''); } };
const one = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

// a tool call in plain words -> { title, detail } (detail: the short command or path, shown dim)
export function toolLine(tool, input, projectId) {
  const i = input && typeof input === 'object' ? input : {};
  const desc = one(i.description);
  const file = i.file_path || i.path || i.notebook_path;
  switch (tool) {
    case 'Bash': case 'PowerShell': {
      const c = one(shortCommand(i.command, projectId), 160);
      return { title: desc || c || 'Runs a command', detail: desc ? c : '', background: !!i.run_in_background };
    }
    case 'Read': return { title: `Reads ${shortPath(file, projectId) || 'a file'}`, detail: '' };
    case 'Write': return { title: `Writes ${shortPath(file, projectId) || 'a file'}`, detail: '' };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { title: `Edits ${shortPath(file, projectId) || 'a file'}`, detail: '' };
    case 'Glob': return { title: `Looks for files: ${one(i.pattern, 80)}`, detail: file ? shortPath(file, projectId) : '' };
    case 'Grep': return { title: `Searches for “${one(i.pattern, 60)}”`, detail: file ? shortPath(file, projectId) : '' };
    case 'WebSearch': return { title: `Searches the web: ${one(i.query, 100)}`, detail: '' };
    case 'WebFetch': return { title: `Reads ${host(i.url)}`, detail: one(i.prompt, 120) };
    case 'TodoWrite': return { title: 'Updates its to-do list', detail: '' };
    case 'Task': case 'Agent': return { title: desc || 'Hands a part to a helper', detail: '' };
    case 'AskUserQuestion': return { title: 'Asks you', detail: '' };
    case 'Skill': return { title: `Uses the skill ${one(i.skill || i.name, 60)}`, detail: '' };
    default: return { title: desc || String(tool || 'A tool'), detail: desc ? '' : one(shortCommand(file || i.command || i.url || i.query || '', projectId), 120) };
  }
}

// a background task in words: its Bash description when known, else a guess from the command
export function fireLabel(cmd, description) {
  if (description) return one(description, 80);
  const c = String(cmd || '').toLowerCase();
  if (/transcrib|whisper|align/.test(c)) return 'Transcribing';
  if (/remotion|render|compose|final|build_rough|rough\.mp4|ffmpeg/.test(c)) return 'Rendering';
  if (/proxy|peaks/.test(c)) return 'Making proxies';
  if (/ocr|find_/.test(c)) return 'Scanning the frames';
  return 'Working in the background';
}
