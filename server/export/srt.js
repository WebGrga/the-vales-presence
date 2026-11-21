// Captions as SRT. Two ways in: the caption events of the visuals (video/out/events.json, kind "caption", the blocks as shown in the video),
// or the rough's words (video/out/rough-words.json [[start, end, word, ...]]) grouped into short lines. Times are seconds of the rough, which the
// final keeps. Fillers are left out, as the burned-in captions do. Pure.

export const FILLERS = new Set(['um', 'uh', 'er', 'ah', 'hmm', 'erm', 'umm', 'uhm', 'mm', 'hm']);
const core = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
export const isFiller = (w) => FILLERS.has(core(w));

// 3725.5 -> "01:02:05,500"
export function srtTime(sec) {
  const ms = Math.max(0, Math.round(Number(sec) * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

// a word with stray spaces, joined: "it" "'s" -> "it's"; punctuation keeps to its word
function joinWords(ws) {
  return ws.map((w) => String(w).trim()).filter(Boolean).join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

// events.json `events` -> blocks [{ at, end, text }] (ordered; a block with no words but a `text` uses the text)
export function fromCaptionEvents(events) {
  const out = [];
  for (const e of events || []) {
    if (e?.kind !== 'caption') continue;
    const words = Array.isArray(e.words) ? e.words.map((w) => (Array.isArray(w) ? w[2] : w?.w ?? w?.word)).filter((w) => w && !isFiller(w)) : [];
    const text = words.length ? joinWords(words) : String(e.text || '').trim();
    if (text && Number(e.end) > Number(e.at)) out.push({ at: Number(e.at), end: Number(e.end), text });
  }
  return out.sort((a, b) => a.at - b.at);
}

// words [[start, end, word, ...]] -> blocks of at most maxWords words / maxChars characters, broken at sentence ends and pauses
export function fromWords(words, { maxWords = 7, maxChars = 42, pause = 0.7, linger = 0.3, minDur = 0.6 } = {}) {
  const ws = (words || []).map((w) => (Array.isArray(w) ? { s: Number(w[0]), e: Number(w[1]), w: String(w[2] ?? '') } : { s: Number(w.s ?? w.start), e: Number(w.e ?? w.end), w: String(w.w ?? w.word ?? '') }))
    .filter((w) => w.w.trim() && Number.isFinite(w.s) && Number.isFinite(w.e) && !isFiller(w.w))
    .sort((a, b) => a.s - b.s);
  const groups = [];
  let cur = [];
  for (const w of ws) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const chars = joinWords([...cur.map((x) => x.w), w.w]).length;
      if (cur.length >= maxWords || chars > maxChars || /[.!?]["')\]]?$/.test(prev.w) || w.s - prev.e > pause) { groups.push(cur); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => {
    const next = groups[i + 1]?.[0]?.s ?? Infinity;
    const at = g[0].s;
    let end = Math.max(g[g.length - 1].e + linger, at + minDur);
    end = Math.min(end, next - 0.02);
    return { at, end: Math.max(end, g[g.length - 1].e, at + 0.05), text: joinWords(g.map((x) => x.w)) };
  });
}

// blocks -> the .srt text (numbered from 1, no overlaps, CRLF-free, ends with a blank line)
export function toSrt(blocks) {
  const list = (blocks || []).filter((b) => b && b.text && b.end > b.at).sort((a, b) => a.at - b.at);
  const lines = [];
  list.forEach((b, i) => {
    const next = list[i + 1];
    const end = next ? Math.min(b.end, next.at) : b.end;
    lines.push(String(i + 1), `${srtTime(b.at)} --> ${srtTime(Math.max(end, b.at + 0.001))}`, b.text, '');
  });
  return lines.join('\n');
}

// the share of spoken words (fillers left out) that start inside one of the blocks
export function coverage(blocks, words) {
  const ws = (words || []).filter((w) => Array.isArray(w) && !isFiller(w[2]));
  if (!ws.length) return blocks.length ? 1 : 0;
  const inside = ws.filter((w) => blocks.some((b) => w[0] >= b.at - 0.05 && w[0] < b.end)).length;
  return inside / ws.length;
}

// pick the source: the video's own caption blocks when they cover most of what is said (at least `need`), else every word,
// so a video captioned only in places still gets full subtitles
export function captionsSrt({ events, words }, { need = 0.8 } = {}) {
  const fromEv = fromCaptionEvents(events);
  if (fromEv.length && coverage(fromEv, words) >= need) return { srt: toSrt(fromEv), from: 'captions', count: fromEv.length };
  const blocks = fromWords(words);
  if (!blocks.length && fromEv.length) return { srt: toSrt(fromEv), from: 'captions', count: fromEv.length };
  return { srt: toSrt(blocks), from: 'words', count: blocks.length };
}
