// "Suggest phrases" on the Research page: one short agent call (no tools, no files, no history) that writes the search
// phrases a real viewer would type for the topic. The free version (research-plan.js proposePhrases) stays the starting
// point and the fallback when the agent cannot be reached. The pure parts (the prompt, reading the reply) are tested.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanPhrases } from './research-plan.js';

const MODEL = 'claude-sonnet-5-5';

export const suggestPrompt = (topic) => [
  `A creator is making a YouTube video about: "${String(topic).slice(0, 200)}".`,
  'Write 6 searches a real viewer would type into YouTube when they want this video. Rules:',
  '- short: 2 to 5 words, the way people type, no filler such as "explained", "tutorial" or "for beginners" unless a viewer really would;',
  '- different in wording and in angle: the problem the viewer has, the tool or thing by name, the result they want, one question;',
  '- no two phrases that share most of their words; do not just repeat the topic.',
  'Answer with a JSON array of 6 strings and nothing else.',
].join('\n');

// pure: the phrases out of a reply (a JSON array, maybe inside a code fence or a sentence)
export function readSuggestion(text) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return cleanPhrases(JSON.parse(m[0]).filter((x) => typeof x === 'string')); } catch { return []; }
}

export async function suggestPhrases(topic) {
  let text = '', cost = 0;
  async function* input() { yield { type: 'user', message: { role: 'user', content: suggestPrompt(topic) }, parent_tool_use_id: null, session_id: '' }; }
  const q = query({ prompt: input(), options: { model: MODEL, effort: 'low', settingSources: [], tools: [], permissionMode: 'dontAsk', maxTurns: 2, systemPrompt: 'You write YouTube search phrases. You answer with the JSON asked for and nothing else.' } });
  for await (const m of q) {
    if (m.type === 'result') { cost = m.total_cost_usd || 0; if (m.subtype === 'success') text = m.result || text; else if (!text) throw new Error('The agent stopped early (' + m.subtype + ').'); }
    else if (m.type === 'assistant') { const t = (m.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''); if (t) text = t; }
  }
  const phrases = readSuggestion(text);
  if (!phrases.length) throw new Error('The agent sent no phrases.');
  return { phrases, cost };
}
