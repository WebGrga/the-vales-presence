// What the Edit tab says when files land (pure, tested in landed-words.test.js): paths -> one short line, or null.
// `live` is true for what the server saw finish while a stage ran (not the stage-end broadcast of every output).
const BY = [
  [/out\/final\.mp4$/, 'The final render is ready'],
  [/out\/proof\.mp4$/, 'The proof is ready'],
  [/out\/proof-sheet\.jpg$/, 'A proof sheet is ready'],
  [/out\/rough\.mp4$/, 'The rough cut video is ready'],
  [/out\/visual-plan\.md$/, 'The visual plan is written'],
  [/out\/events\.json$/, 'The overlays are placed'],
  [/out\/edl\.json$/, 'The edit list is updated'],
  [/out\/review-items\.json$/, 'Review items were added'],
];
export function landedWords(paths, live = true) {
  if (!live) return null;
  const list = Array.isArray(paths) ? paths.map((p) => String(p).replace(/\\/g, '/')) : [];
  for (const [re, words] of BY) if (list.some((p) => re.test(p))) return words;
  return null;
}
