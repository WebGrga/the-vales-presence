// "This video could not play" says which recording (pure, tested in viewer-fail.test.js). src is the address of the video
// element that failed; files is GET /api/projects/:id/footage ({ name, missing, link }).
const GENERIC = 'This video could not play here. A proxy made by the server plays everywhere: wait for it, or reload the page.';

// the file name at the end of a media address
export function nameOf(src) {
  try { return decodeURIComponent(String(src || '').split('?')[0].split('/').pop() || ''); } catch { return ''; }
}

export function failWords(src, files) {
  const name = nameOf(src);
  const list = Array.isArray(files) ? files : [];
  const lost = list.filter((f) => f.missing);
  const hit = list.find((f) => f.name === name);
  if (hit?.missing) return `This video could not play: the recording “${hit.name}” is missing. It was linked from outside the project and has moved or been deleted. Find it again in Media (its row says missing).`;
  if (lost.length) return `This video could not play. ${lost.length === 1 ? `The recording “${lost[0].name}” is` : `These recordings are: ${lost.map((f) => `“${f.name}”`).join(', ')}`} missing (linked footage that moved or was deleted): find ${lost.length === 1 ? 'it' : 'them'} again in Media. ${name ? `The one that failed is “${name}”.` : ''}`.trim();
  return name ? `This video could not play here (“${name}”). ${GENERIC}` : GENERIC;
}
