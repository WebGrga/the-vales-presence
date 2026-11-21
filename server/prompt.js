// The words a stage sends its agent (pure). The session's system prompt is Claude Code's own plus craft/CLAUDE.md
// (agent.js); everything about one stage goes in its message: the kind's instruction, the recipe's focus, where things
// are, the files it must leave, the skills switched on for it, the house rules, the brief, your notes, the locks.

const section = (title, body) => (String(body || '').trim() ? `## ${title}\n\n${String(body).trim()}\n` : '');

// a: { recipe, stage, index, kind: { title, instruction }, projectDir, root, skills: [{name, file, about}], missing,
//      houseRules, brief, topic (the idea typed at creation), sentBack (notes), approved (notes from the gate before), lock (the lock sentence), footage: [names] }
export function stagePrompt(a) {
  const { recipe, stage } = a;
  const n = recipe.stages.length;
  const out = [];
  out.push(`# Stage ${a.index + 1} of ${n}: ${stage.title || stage.id} (${stage.kind})`);
  out.push(`Recipe: ${recipe.name}${recipe.about ? ` (${recipe.about})` : ''}. The stages: ${recipe.stages.map((s) => (s.id === stage.id ? `[${s.id}]` : s.id)).join(' > ')}.\n`);
  out.push(section('What this kind of stage does', a.kind?.instruction));
  out.push(section('This stage', stage.focus));
  if (a.sentBack) out.push(section('Sent back to you', `The user sent this stage back. Do what these notes say, and change nothing they do not name:\n\n${a.sentBack}`));
  out.push(section('Where things are', [
    `- The project folder (your working folder): ${a.projectDir}`,
    `- The workshop the engine works in: ${a.projectDir}${sep(a.projectDir)}video (footage in video/footage, outputs in video/out)`,
    `- The repo root: ${a.root}`,
    `- The engine ($ENGINE, also in the PRESENCE_ENGINE environment variable): ${a.root}${sep(a.root)}engine. Run \`python "${a.root}${sep(a.root)}engine${sep(a.root)}<script>.py" --video "${a.projectDir}${sep(a.projectDir)}video"\`, or from the video folder without --video. Its README.md is the manual.`,
    `- The studio folder for plans, scripts, research, titles and thumbnails: ${a.projectDir}${sep(a.projectDir)}studio`,
    a.footage?.length ? `- Footage: ${a.footage.map((f) => 'video/footage/' + f).join(', ')}` : '',
  ].filter(Boolean).join('\n')));
  if (a.source) out.push(section('Made from another project', [
    `This project starts from the edit of "${a.source.title || a.source.project}" (project ${a.source.project}). Its files are here already, so nothing is uploaded or transcribed again. The videos are hard links shared with that project: read them and link them on, never write to them or render over them.`,
    ...(a.source.files || []).map((f) => `- ${f}`),
    'video/out/rough-words.json are the words of video/out/rough.mp4 (and of final.mp4, which has the same timeline): use them for every time, and never transcribe again.',
  ].join('\n')));
  if (stage.out?.length) out.push(section('This stage is done when these files exist', stage.out.map((f) => `- ${f}`).join('\n')));
  if (a.skills?.length) out.push(section('Skills switched on for this stage (read each one before you start)', a.skills.map((s) => `- ${s.name}: ${s.file}${s.about ? ` (${s.about})` : ''}`).join('\n')));
  if (a.missing?.length) out.push(`(Switched on but not found: ${a.missing.join(', ')}.)\n`);
  out.push(section('House rules (they win over a skill)', [
    a.houseRulesFile ? `The user's house rules file: ${a.houseRulesFile}${a.houseRulesShipped ? ` (when it does not exist yet, copy ${a.houseRulesShipped} there first, then write lessons in your copy; never edit the shipped one)` : ''}.` : '',
    a.houseRules,
  ].filter(Boolean).join('\n\n')));
  out.push(section('What the user wants this to be about (typed when the project was made: build on it)', a.topic));
  out.push(section('The brief (brief.md)', a.brief));
  if (a.approved) out.push(section('Notes the user left when approving the stage before', a.approved));
  if (a.lock) out.push(section('Locked', a.lock));
  out.push(section('Rules for every stage', [
    '- Long renders and encodes (over a minute): start them with the Bash tool in the background (run_in_background), then end your turn with a short line saying what runs. You will be woken when it ends. Do not poll or sleep.',
    '- Never upload or publish anything: the user presses those buttons.',
    '- If you need the user, ask with the AskUserQuestion tool, or end your turn with the question.',
    '- If what is asked needs something the engine and the kit do not have (a new kind of effect, OCR, tracking, a new tool), do not build it unasked: say in a line what is missing and the quickest ways to do it, and ask which one before you spend more than a few minutes. A background task that writes nothing to its log for a long time is reported to the user as stuck, so print progress.',
    `- Everything the user should look at or listen to at a time (a tight join, a word you were unsure of, private text on screen, a quiet stretch, a judgment call) also goes in ${a.reviewItems || 'video/out/review-items.json'}: { "items": [ { "at": seconds, "to": seconds (optional), "kind": "listen|look|private|length|pace|words|flag|other", "text": "one line for the user", "source": "${a.stage.id}", "on": "rough|final" } ] }. Times are seconds on the video this stage made (rough.mp4 for the rough; the final after the lock, which has the same timeline). Keep the items other stages wrote, and replace only those with your own source. The screen shows them on the timeline and in the Cuts list.`,
    '- End the stage with a short summary: what you made, the files, anything the user should look at.',
  ].join('\n')));
  return out.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
const sep = (p) => (String(p).includes('\\') ? '\\' : '/');

// The message that continues a stage that asked you something
export const answerPrompt = (text) => `The user answers:\n\n${String(text || '').trim()}\n\nContinue the stage.`;

// The stages the Studio page shows; a plain turn said while the project is at one of them also gets the Studio's skills
export const STUDIO_STAGES = ['research', 'plan', 'plan-review', 'script', 'titles', 'thumbnails', 'feed', 'upload'];
// pure: the line added to a plain turn so the agent knows which skills of the project's set apply (none = nothing added)
export function studioNote(skills) {
  if (!skills?.length) return '';
  const list = skills.map((k) => `- ${k.name}: ${k.file}`).join('\n');
  return `\n\n(Skills switched on for the Studio, read the ones that fit this request first:\n${list})`;
}
