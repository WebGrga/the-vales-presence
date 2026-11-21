// The idea a new project starts with (pure). A topic typed in the New project box is kept in .presence/topic.md and goes into
// the prompt of every stage (server/prompt.js, under the brief), so the first stage and research read it from the first second.
// It is not written to brief.md on purpose: the Ask stage is done "when brief.md exists", and a pre-written brief would end
// it before the user had answered a question. The agent folds the idea into the brief it writes.
export const TOPIC_FILE = ['.presence', 'topic.md'];
export function topicText(topic) {
  const t = String(topic || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  return t ? t + '\n' : '';
}
