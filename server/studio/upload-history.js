// The upload history of a project: studio/upload-history.json, one entry per finished upload (or dry run), newest first when read.
// upload.json keeps only the last state, so each finish is also appended here. A project whose only record is an older upload.json
// still shows it (legacy). The pure parts (entryOf, merge) are tested in upload-history.test.js.
import path from 'node:path';
import { readJson, writeJson } from './files.js';

const FILE = (dir) => path.join(dir, 'studio', 'upload-history.json');

// pure: the entry for a finished upload state, with the thumbnail that was set (an option { id, file } or null)
export function entryOf(state, thumb) {
  return {
    at: state.at, dry: !!state.dry, videoId: state.videoId || null, url: state.url || null, studio: state.studio || null,
    title: state.title || '', privacy: state.privacy || '', bytes: state.bytes || state.total || 0, ms: state.ms || null,
    thumb: thumb ? { id: thumb.id, file: thumb.file } : null, thumbNote: state.thumbNote || null,
  };
}

// pure: the saved list plus the last state when it is not in the list yet -> newest first
export function merge(list, last) {
  const out = [...(Array.isArray(list) ? list : [])];
  if (last?.status === 'done' && last.at && !out.some((e) => e.at === last.at)) out.push(entryOf(last, null));
  return out.filter((e) => e?.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export async function addUpload(dir, entry) {
  const list = await readJson(FILE(dir), []);
  list.push(entry);
  await writeJson(FILE(dir), list.slice(-200));
}
export async function readUploads(dir, last) { return merge(await readJson(FILE(dir), []), last); }
