// Pure text helpers of the Context room: word counts, a skill's frontmatter, a new skill's file, the checks a saved
// text must pass. No file system here (text.test.js).

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
export const MAX_TEXT = 200_000; // characters: a context file is a few pages, never a book

// size in words: what the user sees for every item (never tokens)
export function wordCount(text) {
  const m = String(text ?? '').match(/\S+/g);
  return m ? m.length : 0;
}

// --- frontmatter: the block between the first two --- lines ---
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function frontmatter(text) {
  const t = String(text ?? ''), m = t.match(FRONT);
  if (!m) return { fields: {}, body: t };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = unquote(kv[2].trim());
  }
  return { fields, body: t.slice(m[0].length) };
}
function unquote(v) {
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
  return v;
}
// a value written so a YAML reader takes it as one plain string
function yamlValue(v) {
  const s = String(v).replace(/\s+/g, ' ').trim();
  return /^[\w(][^:#]*$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s) ? s : JSON.stringify(s);
}

// --- a new skill (name, description, text) -> its SKILL.md, or { error } in plain words ---
export function checkName(raw) {
  const name = String(raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!name) return { error: 'give the skill a name' };
  if (!SKILL_NAME.test(name)) return { error: 'a skill name is 3 to 64 letters, digits and dashes, like "cut-my-way"' };
  return { name };
}

export function newSkillText({ name, description, text }) {
  const n = checkName(name);
  if (n.error) return n;
  const desc = String(description ?? '').replace(/\s+/g, ' ').trim();
  if (desc.length < 10) return { error: 'say in a sentence what the skill is for and when to use it: the agent reads that first' };
  if (desc.length > 600) return { error: 'keep the description to a sentence or two (under 600 characters)' };
  let body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (FRONT.test(body + '\n')) body = frontmatter(body + '\n').body.trim(); // a pasted skill: its own header is replaced
  if (!body) body = `# ${n.name}\n\nWrite here how the agent should do this, step by step.`;
  const out = `---\nname: ${n.name}\ndescription: ${yamlValue(desc)}\n---\n\n${body}\n`;
  if (out.length > MAX_TEXT) return { error: 'the text is too long for a skill' };
  return { name: n.name, text: out };
}

// what a save of an item must pass, by kind; null = fine
export function checkText(kind, text) {
  if (typeof text !== 'string') return 'there is no text to save';
  if (text.length > MAX_TEXT) return 'the text is too long to save here';
  if (kind === 'skill') {
    const { fields } = frontmatter(text);
    if (!fields.name || !fields.description) return 'a skill starts with its header: a --- line, "name: ...", "description: ...", and a --- line';
  }
  return null;
}
