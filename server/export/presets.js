// The export presets and the pure decisions around them: the ffmpeg arguments of a preset, the file name of a render, how far a render is
// (ffmpeg's -progress lines), and the order of the history. Tested in presets.test.js.
import path from 'node:path';
import { slug } from './timeline.js';

// width x height, video quality (crf or a bitrate), audio bitrate. fit: 'contain' keeps the whole picture (bars if the shape differs),
// 'cover' fills the frame and crops what overflows (a wide video made into a Short is cut to its middle).
export const PRESETS = {
  youtube: { id: 'youtube', name: 'YouTube 1080p', about: 'Full HD, 16:9, good quality for uploading.', w: 1920, h: 1080, fit: 'contain', crf: 18, abr: '192k', speed: 'medium' },
  shorts: { id: 'shorts', name: 'Shorts 1080x1920', about: 'Vertical 9:16, full HD, for Shorts, Reels and TikTok. A wide video is cut to its middle.', w: 1080, h: 1920, fit: 'cover', crf: 19, abr: '192k', speed: 'medium' },
  preview: { id: 'preview', name: 'Small preview 720p', about: 'Small file at 720p and a low bitrate, to send for a quick look.', w: 1280, h: 720, fit: 'contain', vbr: '1200k', abr: '96k', speed: 'veryfast' },
};
export const presetList = () => Object.values(PRESETS);

// pure: the video filter that gives exactly w x h
export function scaleFilter(p) {
  const { w, h } = p;
  return p.fit === 'cover'
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,format=yuv420p`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
}

// pure: the whole ffmpeg command line (without the program name) for a preset. -progress goes to stdout.
export function presetArgs(p, input, output) {
  const quality = p.vbr ? ['-b:v', p.vbr, '-maxrate', p.vbr, '-bufsize', String(parseInt(p.vbr, 10) * 2) + 'k'] : ['-crf', String(p.crf)];
  return ['-hide_banner', '-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', scaleFilter(p),
    '-c:v', 'libx264', '-preset', p.speed || 'medium', ...quality, '-c:a', 'aac', '-b:a', p.abr, '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output];
}

const stamp = (d) => { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };

// pure: a file name that never overwrites an older version: <title>-<preset>-<date and time>.mp4
export function renderName(title, presetId, at = new Date(), taken = []) {
  const base = `${slug(title, 'export')}-${presetId}-${stamp(at)}`;
  let name = `${base}.mp4`;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}.mp4`;
  return name;
}

// pure: ffmpeg's -progress text so far -> seconds done (the last out_time), or null
export function progressSeconds(text) {
  let last = null;
  for (const m of String(text).matchAll(/out_time_(?:us|ms)=(\d+)/g)) last = Number(m[1]) / 1e6;
  return last;
}
export const fraction = (seconds, duration) => (duration > 0 && seconds != null ? Math.max(0, Math.min(1, seconds / duration)) : 0);

// pure: a folder the user typed -> an absolute folder path or { error }
export function cleanFolder(text) {
  const s = String(text ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!s) return { error: 'Type the folder to export to.' };
  if (!path.isAbsolute(s)) return { error: 'Give the whole path of the folder, from the drive or the root.' };
  return { folder: path.normalize(s) };
}

// pure: history entries -> newest first, an older version marked (`older`: a newer entry of the same preset and Short exists)
export function orderHistory(entries) {
  const list = [...(entries || [])].filter((e) => e && e.file).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const seen = new Set();
  return list.map((e) => { const k = `${e.short || ''}:${e.preset}`; const older = seen.has(k); seen.add(k); return { ...e, older }; });
}
