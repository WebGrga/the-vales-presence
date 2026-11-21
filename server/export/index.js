// Export a project: the video (the final, else the rough), captions as SRT, the edit list as FCPXML or OTIO, YouTube chapters, and a .mp4 copy of
// recordings in containers other programs may not import (remux). Files go to <project>/export/.
// The writers are pure (fcpxml.js, otio.js, srt.js, chapters.js); this file only reads the project and writes the result.
import fs from 'node:fs';
import path from 'node:path';
import { toFcpxml } from './fcpxml.js';
import { toOtio } from './otio.js';
import { captionsSrt } from './srt.js';
import { slug } from './timeline.js';
import { describeSources } from './sources.js';
import { chapters } from './chapters.js';
import { remuxAll, needsRemux } from './remux.js';

export const KINDS = ['mp4', 'srt', 'fcpxml', 'otio', 'chapters', 'remux'];
const EXT = { srt: '.srt', fcpxml: '.fcpxml', otio: '.otio', chapters: '.chapters.txt' };

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const rel = (dir, f) => path.relative(dir, f).split(path.sep).join('/');
const fail = (status, message) => Object.assign(new Error(message), { status });

function paths(dir) {
  const out = path.join(dir, 'video', 'out');
  return {
    video: path.join(dir, 'video'), out,
    final: path.join(out, 'final.mp4'), rough: path.join(out, 'rough.mp4'),
    edl: path.join(out, 'edl.json'), words: path.join(out, 'rough-words.json'), events: path.join(out, 'events.json'),
    scenes: path.join(out, 'rough-scenes.json'), rough_json: path.join(out, 'rough.json'), chapters: path.join(out, 'chapters.json'),
    exportDir: path.join(dir, 'export'),
  };
}

function baseName(dir) {
  const p = readJson(path.join(dir, 'project.json'));
  return { title: p?.title || path.basename(dir), file: slug(p?.title, slug(path.basename(dir), 'export')) };
}

export async function exportProject(dir, kind) {
  if (!KINDS.includes(kind)) throw fail(400, `kind must be one of ${KINDS.join(', ')}`);
  const P = paths(dir);
  const t0 = Date.now();
  const name = baseName(dir);

  if (kind === 'mp4') {
    const which = fs.existsSync(P.final) ? 'final' : fs.existsSync(P.rough) ? 'rough' : null;
    if (!which) throw fail(404, 'there is no video yet: neither video/out/final.mp4 nor video/out/rough.mp4');
    const file = which === 'final' ? P.final : P.rough;
    return { kind, which, file: rel(dir, file), size: fs.statSync(file).size, ms: Date.now() - t0, note: which === 'final' ? 'the final, with the visuals' : 'the rough: there is no final yet' };
  }

  fs.mkdirSync(P.exportDir, { recursive: true });
  const target = path.join(P.exportDir, name.file + EXT[kind]);

  if (kind === 'srt') {
    const words = readJson(P.words)?.words || [];
    const events = readJson(P.events)?.events || [];
    if (!words.length && !events.some((e) => e.kind === 'caption')) throw fail(404, 'there are no words yet: video/out/rough-words.json is made when the rough is handed over');
    const r = captionsSrt({ events, words });
    fs.writeFileSync(target, r.srt, 'utf8');
    return { kind, file: rel(dir, target), size: fs.statSync(target).size, ms: Date.now() - t0, from: r.from, count: r.count, note: `${r.count} lines from ${r.from === 'captions' ? "the video's captions" : 'the spoken words'}` };
  }

  if (kind === 'chapters') {
    const c = chaptersFor(dir);
    if (!c.lines.length) throw fail(404, `no chapters: ${c.problems.join('; ') || 'nothing to make them from'}`);
    fs.writeFileSync(target, c.text + '\n', 'utf8');
    return { kind, file: rel(dir, target), size: fs.statSync(target).size, ms: Date.now() - t0, count: c.lines.length, text: c.text, from: c.from, problems: c.problems,
      note: `${c.lines.length} chapters ${c.from === 'chapters.json' ? 'from video/out/chapters.json' : 'drafted from the words: check the titles'}` };
  }

  const edl = readJson(P.edl);
  if (!edl?.items) throw fail(404, 'there is no edit list yet: video/out/edl.json is written by the rough cut');
  if (kind === 'remux') {
    const files = Object.values(edl.sources || {}).map((s) => (typeof s === 'string' ? s : s?.file)).filter(Boolean).map((r) => path.resolve(P.video, ...String(r).split(/[\\/]/)));
    const done = await remuxAll(dir, files);
    const bad = done.filter((d) => d.state === 'failed');
    if (!done.length) return { kind, file: null, ms: Date.now() - t0, count: 0, note: 'every recording is already in a container other programs import (.mp4 / .mov): nothing to copy' };
    if (bad.length) throw fail(422, `could not copy ${bad.map((d) => path.basename(d.file)).join(', ')} into .mp4 without re-encoding (${bad[0].error}); FCPXML and OTIO keep linking the original`);
    return { kind, file: rel(dir, done[0].out), ms: Date.now() - t0, count: done.length, size: done.reduce((s, d) => s + (d.size || 0), 0), files: done.map((d) => ({ file: rel(dir, d.out), state: d.state })),
      note: `${done.length} recording${done.length > 1 ? 's' : ''} copied to export/media/ as .mp4 (no re-encode); FCPXML and OTIO now link the copies` };
  }
  const sources = await describeSources(edl, P.video, dir);
  const missing = Object.entries(sources).filter(([, s]) => s.missing).map(([k]) => k);
  const opts = { title: name.title, sources };
  const text = kind === 'fcpxml' ? toFcpxml(edl, opts) : JSON.stringify(toOtio(edl, opts), null, 2) + '\n';
  fs.writeFileSync(target, text, 'utf8');
  const n = edl.items.length;
  const odd = Object.values(sources).filter((s) => s.container).map((s) => s.name);
  return {
    kind, file: rel(dir, target), size: fs.statSync(target).size, ms: Date.now() - t0, count: n, unlinkable: odd,
    note: `${n} pieces of the approved edit list, linked to the footage files where they are now${missing.length ? ` (not found: ${missing.join(', ')})` : ''}`
      + (odd.length ? `. ${odd.join(', ')} ${odd.length > 1 ? 'are' : 'is'} .${sources[Object.keys(sources).find((k) => sources[k].container)].container}, which some editing programs do not import: export "remux" first for a .mp4 copy (no re-encode), then export again` : ''),
  };
}

// YouTube chapters of a project: { chapters, lines, text, from, problems } (chapters.js), from video/out/chapters.json or the rough's words
export function chaptersFor(dir) {
  const P = paths(dir);
  const words = readJson(P.words);
  const duration = Number(readJson(P.rough_json)?.duration) || Number(words?.duration) || 0;
  const given = readJson(P.chapters);
  return chapters({ duration, words: Array.isArray(words?.words) ? words.words : [], scenes: readJson(P.scenes)?.times || [], given: Array.isArray(given?.chapters) ? given.chapters : Array.isArray(given) ? given : null });
}

// what exists: the files already exported and what each export needs
export function listExports(dir) {
  const P = paths(dir);
  const files = [];
  try {
    for (const f of fs.readdirSync(P.exportDir)) {
      const ext = f.endsWith('.chapters.txt') ? 'chapters' : path.extname(f).slice(1).toLowerCase();
      if (!EXT[ext]) continue;
      const st = fs.statSync(path.join(P.exportDir, f));
      files.push({ kind: ext, file: `export/${f}`, size: st.size, mtime: st.mtime.toISOString() });
    }
  } catch {}
  // the .mp4 copies of recordings (remux)
  try {
    for (const f of fs.readdirSync(path.join(P.exportDir, 'media'))) {
      if (!f.endsWith('.mp4') || f.endsWith('.part.mp4')) continue;
      const st = fs.statSync(path.join(P.exportDir, 'media', f));
      files.push({ kind: 'remux', file: `export/media/${f}`, size: st.size, mtime: st.mtime.toISOString() });
    }
  } catch {}
  for (const which of ['final', 'rough']) {
    try { const st = fs.statSync(P[which]); files.push({ kind: 'mp4', which, file: rel(dir, P[which]), size: st.size, mtime: st.mtime.toISOString() }); } catch {}
  }
  const ch = chaptersFor(dir);
  const edl = readJson(P.edl);
  const has = {
    final: fs.existsSync(P.final), rough: fs.existsSync(P.rough), edl: fs.existsSync(P.edl),
    words: fs.existsSync(P.words), captions: (readJson(P.events)?.events || []).some((e) => e.kind === 'caption'),
    chapters: ch.lines.length > 0,
    remux: Object.values(edl?.sources || {}).some((s) => needsRemux(typeof s === 'string' ? s : s?.file)),
  };
  // why a format that is not ready is not (only what the file names cannot say)
  const why = {};
  if (!has.chapters) why.chapters = ch.problems.join('; ');
  return { files, has, why };
}
