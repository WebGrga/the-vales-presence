// What a research run is asked, the pure half: the topic of a project, the search phrases proposed for it,
// cleaned phrase lists, competitor channels as URLs, and the date choices as YouTube's search filters.
// The Research page edits these; research-run.js and research-fetch.js carry them out.
import fs from 'node:fs/promises';
import path from 'node:path';

export const MAX_PHRASES = 8;
export const MAX_CHANNELS = 6;

// when: the choices, as YouTube's own upload-date filter on a search (sp), so the dates are the site's, not guessed
export const WHEN = { any: { label: 'Any time', sp: '' }, week: { label: 'Past week', sp: 'EgQIAxAB' }, month: { label: 'Past month', sp: 'EgQIBBAB' }, year: { label: 'Past year', sp: 'EgQIBRAB' } };

export function cleanPhrases(list) {
  const seen = new Set(), out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const t = String(p ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

const VERBS = /^(edit|make|build|create|write|record|learn|use|fix|start|grow|get|set|setup|install|train|automate|design|plan|cut|speed|film|shoot|publish|upload|find|run|code|add|improve|stop|beat|win|pick|choose|test|cook|bake)\b/i;

// phrases a viewer might type for a topic, free and instant (a starting point; "Suggest phrases" asks the agent for better):
// the plain task, a question, the tool for the thing, the outcome. Short, and different in wording.
export function proposePhrases(topic) {
  const t = String(topic || '').replace(/\s+/g, ' ').trim().replace(/^(brief|plan)\s*:\s*/i, '').slice(0, 100);
  if (!t) return [];
  const bare = t.replace(/^(how (do i|do you|can i|to)|ways to|learn to)\s+/i, '').replace(/[?.!]+$/, '').trim() || t;
  const m = bare.match(/^(.+?)\s+(?:with|using|by|via|through)\s+(.+)$/i);
  const task = (m ? m[1] : bare).trim();
  const toolFull = m ? m[2].trim() : '';
  const tool = toolFull.replace(/^(an?|the|my|your|some)\s+/i, '');
  const verb = VERBS.test(task);
  const object = verb ? task.replace(/^(set up|\w+)\s+/i, '') : '';
  const list = [];
  if (verb && tool) list.push(task, `can ${toolFull} ${task}?`, object ? `${tool} for ${object}` : '', `${task} automatically`, `${tool} ${object || task}`);
  else if (verb) list.push(task, `best way to ${task}`, `can you ${task}?`, `${task} fast`, `${task} mistakes`);
  else if (tool) list.push(bare, `${tool} for ${task}`, `is ${tool} good for ${task}?`, `${task} problems`);
  else if (/^(why|what|how|is|are|can|does|do|should)\b/i.test(bare)) list.push(bare);
  else list.push(bare); // no rule makes real searches out of a bare topic: "Suggest phrases" asks the agent
  return cleanPhrases(list.filter(Boolean));
}

// a channel as the user typed it (@handle, a channel link, a UC id) into the page of its videos; null when it is none of them
export function channelUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^UC[\w-]{20,}$/.test(s)) return `https://www.youtube.com/channel/${s}/videos`;
  if (/^@[\w.-]{2,}$/.test(s)) return `https://www.youtube.com/${s}/videos`;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^(www\.|m\.)?youtube\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(@[\w.-]+|channel\/UC[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/);
  return m ? `https://www.youtube.com/${m[1]}/videos` : null;
}

export function cleanChannels(list) {
  const seen = new Set(), out = [];
  for (const c of Array.isArray(list) ? list : String(list || '').split(/[,\n]+/)) {
    const raw = String(c || '').trim();
    const url = channelUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(raw.slice(0, 200));
    if (out.length >= MAX_CHANNELS) break;
  }
  return out;
}

// the options of a run, kept to what the fetch understands
export function cleanOptions(o = {}) {
  const lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(o.language || '').trim()) ? String(o.language).trim() : '';
  return {
    channels: cleanChannels(o.channels),
    when: WHEN[o.when] ? o.when : 'any',
    language: lang,
    n: Math.min(40, Math.max(5, Math.floor(Number(o.n)) || 20)),
  };
}

const heading = (text, drop) => {
  const m = String(text || '').match(/^#\s+(.+)$/m);
  return m ? m[1].replace(drop, '').trim() : '';
};

// the topic of a project: its brief's heading, else its plan's, else the topic given when it was made (.presence/topic.md), else its title.
// asks = there is nothing to read it from, so the page asks.
export async function readTopic(dir) {
  const rd = (f) => fs.readFile(path.join(dir, f), 'utf8').catch(() => '');
  const [brief, plan, proj, given] = await Promise.all([rd('brief.md'), rd(path.join('studio', 'plan.md')), rd('project.json'), rd(path.join('.presence', 'topic.md'))]);
  let title = '';
  try { title = String(JSON.parse(proj).title || ''); } catch {}
  const fromBrief = heading(brief, /^brief\s*:\s*/i), fromPlan = heading(plan, /^plan\s*:\s*/i);
  const fromTopic = given.replace(/\s+/g, ' ').trim().slice(0, 200);
  const topic = fromBrief || fromPlan || fromTopic || title.trim();
  return { topic, from: fromBrief ? 'brief' : fromPlan ? 'plan' : fromTopic ? 'topic' : 'title', asks: !fromBrief && !fromPlan && !fromTopic };
}
