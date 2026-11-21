// The agent's pure helpers: models and settings, what goes to the screen, the streaming input, the recent messages.
export const MODELS = [
  { value: 'claude-opus-5-5', name: 'Opus 5.5', about: 'the default: the best editor' },
  { value: 'claude-sonnet-5-5', name: 'Sonnet 5.5', about: 'cheaper, for simpler stages' },
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const MODES = ['auto', 'acceptEdits'];
// chain: agent stages run on by themselves after the one before; heavy: renders at once across projects;
// quietMinutes: a stage that shows no output for this long is reported to you (0: never)
export const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium', permissionMode: 'auto', chain: true, heavy: 1, quietMinutes: 15, warnDay: 0, warnMonth: 0, defaultRecipe: '' };
export const ALLOW = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const TEXT_MAX = 4000;       // tool results and inputs sent to the screen are trimmed

// pure: settings as they may be kept
export function cleanSettings(s) {
  const o = { ...DEFAULTS };
  if (s && typeof s === 'object') {
    if (typeof s.model === 'string' && /^[a-z0-9.\-[\]]{2,60}$/i.test(s.model)) o.model = s.model;
    if (EFFORTS.includes(s.effort)) o.effort = s.effort;
    if (MODES.includes(s.permissionMode)) o.permissionMode = s.permissionMode;
    if (typeof s.chain === 'boolean') o.chain = s.chain;
    if (Number.isInteger(s.heavy) && s.heavy >= 1 && s.heavy <= 8) o.heavy = s.heavy;
    if (Number.isFinite(s.quietMinutes) && s.quietMinutes >= 0 && s.quietMinutes <= 240) o.quietMinutes = Math.round(s.quietMinutes);
    if (Number.isFinite(s.warnDay) && s.warnDay >= 0 && s.warnDay <= 100000) o.warnDay = Math.round(s.warnDay * 100) / 100;
    if (Number.isFinite(s.warnMonth) && s.warnMonth >= 0 && s.warnMonth <= 100000) o.warnMonth = Math.round(s.warnMonth * 100) / 100;
    if (typeof s.defaultRecipe === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(s.defaultRecipe)) o.defaultRecipe = s.defaultRecipe;
  }
  return o;
}

// pure: a tool input made small enough for the screen
export function trimInput(input) {
  const s = JSON.stringify(input ?? {});
  if (s.length <= TEXT_MAX) return input;
  const o = {};
  for (const [k, v] of Object.entries(input || {})) o[k] = typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '…' : v;
  return JSON.stringify(o).length <= TEXT_MAX ? o : { note: 'too long to show', keys: Object.keys(input || {}) };
}
// pure: a tool_result block's text
export function resultText(block) {
  const c = block?.content;
  const s = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x.type === 'text' ? x.text : x.type === 'image' ? '[image]' : '')).join('\n') : '';
  return s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) + '\n…' : s;
}
// pure: AskUserQuestion answers from one typed reply (every question gets the same text)
export const answersFrom = (questions, text) => Object.fromEntries((questions || []).map((q) => [q.question, String(text || '')]));

// Messages pushed in while the session lives; the SDK reads them as streaming input.
export function inbox() {
  const items = []; let wake = null, done = false;
  return {
    push(m) { items.push(m); wake?.(); },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length) yield items.shift();
        if (done) return;
        await new Promise((r) => (wake = r)); wake = null;
      }
    },
  };
}

// The recent agent messages of each project, so a reloaded screen can fill its panel (text deltas joined per turn).
export function createRecent(max = 300) {
  const recent = {};
  function remember(m) {
    const list = (recent[m.project] ||= []);
    const last = list[list.length - 1];
    if (m.event === 'text' && last?.event === 'text' && !m.start && !last.closed) last.text += m.text || '';
    else list.push({ ...m, t: Date.now() });
    if (m.event !== 'text' && last?.event === 'text') last.closed = true;
    if (list.length > max) list.splice(0, list.length - max);
  }
  const of = (id) => (recent[id] || []).map(({ closed, ...m }) => m);
  return { remember, of };
}
