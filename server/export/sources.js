// What each recording of an edit list is: its file (as a file:// URL), whether it has picture and sound, its length. ffprobe, once per export.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { freshCopy, needsRemux } from './remux.js';

// pure: ffprobe's JSON -> { hasVideo, hasAudio, duration, channels, rate }
export function probeInfo(j) {
  const streams = j?.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition?.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(j?.format?.duration) || Number(v?.duration) || Number(a?.duration) || null;
  return { hasVideo: !!v, hasAudio: !!a, duration, channels: a ? Number(a.channels) || 2 : null, rate: a ? Number(a.sample_rate) || 48000 : null };
}

function ffprobe(file) {
  return new Promise((done) => {
    let out = '';
    let p;
    try { p = spawn('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true }); } catch { return done(null); }
    const t = setTimeout(() => { try { p.kill(); } catch {} done(null); }, 20000);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(t); done(null); });
    p.on('close', () => { clearTimeout(t); try { done(JSON.parse(out)); } catch { done(null); } });
  });
}

const AUDIO_ONLY = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus']);

// edl.sources (paths relative to video/) -> { key: { url, name, file, hasVideo, hasAudio, duration, channels, rate, missing?, remuxed?, container? } }
// projectDir given: a fresh .mp4 copy of a recording (remux.js, in export/media/) is linked instead of the recording itself
export async function describeSources(edl, videoDir, projectDir = null) {
  const out = {};
  await Promise.all(Object.entries(edl?.sources || {}).map(async ([k, s]) => {
    const rel = typeof s === 'string' ? s : s?.file;
    if (!rel) return;
    const orig = path.resolve(videoDir, ...String(rel).split(/[\\/]/));
    const copy = projectDir ? freshCopy(projectDir, orig) : null;
    const file = copy || orig;
    const name = path.basename(file);
    const how = copy ? { remuxed: true, original: orig } : needsRemux(orig) ? { container: path.extname(orig).slice(1).toLowerCase() } : {};
    const base = { url: pathToFileURL(file).href, name, file, uid: null, ...how };
    if (!fs.existsSync(file)) { out[k] = { ...base, missing: true, hasVideo: !AUDIO_ONLY.has(path.extname(file).toLowerCase()), hasAudio: true }; return; }
    const j = await ffprobe(file);
    out[k] = j ? { ...base, ...probeInfo(j) } : { ...base, hasVideo: !AUDIO_ONLY.has(path.extname(file).toLowerCase()), hasAudio: true };
  }));
  return out;
}
