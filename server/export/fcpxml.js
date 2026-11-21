// The edit list as FCPXML 1.10: one format, one asset per recording (referencing the footage file), one project with one sequence whose spine
// holds an asset-clip per piece. Picture from another source than the sound rides on lane 1 above it; a sped wait and a held still carry a timeMap;
// a blank card is a gap. Picture filters (`vf`, `crop`) and the overlays are not carried: this is the approved talk, cut for cut. Pure.
import { timelineOf, sourceLengths, videoSpan } from './timeline.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// frames -> an FCPXML time: "0s", "843/60s", "1001/30000s"
export function fcpTime(frames, frame) {
  const f = Math.round(frames);
  if (f === 0) return '0s';
  const n = f * frame.n, d = frame.d;
  const g = gcd(Math.abs(n), d);
  return d / g === 1 ? `${n / g}s` : `${n / g}/${d / g}s`;
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a || 1; }

const attrs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}="${esc(v)}"`).join(' ');

function formatName(w, h, fps) {
  const rate = Number.isInteger(fps) ? String(fps) : (Math.round(fps * 100) / 100).toString().replace('.', '');
  const std = { '1920x1080': '1080p', '1280x720': '720p', '3840x2160': '2160p' }[`${w}x${h}`];
  return std ? `FFVideoFormat${std}${rate}` : null; // a vertical or odd size has no named format: FCP reads width/height/frameDuration
}

// edl: the edit list; opts: { title, event, sources: { key: { url, name, hasVideo, hasAudio, duration (s), channels, rate } } }
export function toFcpxml(edl, opts = {}) {
  const sources = opts.sources || {};
  const tl = timelineOf(edl, sources);
  const T = (f) => fcpTime(f, tl.frame);
  const lens = sourceLengths(tl, sources);
  const title = opts.title || 'Edit';
  const ids = {};
  const res = [`    <format ${attrs({ id: 'r1', name: formatName(tl.width, tl.height, tl.fps), frameDuration: fcpTime(1, tl.frame), width: tl.width, height: tl.height, colorSpace: '1-1-1 (Rec. 709)' })}/>`];
  tl.used.forEach((k, i) => {
    const s = sources[k] || {};
    const id = `r${i + 2}`; ids[k] = id;
    const hasVideo = s.hasVideo !== false, hasAudio = s.hasAudio !== false;
    res.push(`    <asset ${attrs({
      id, name: s.name || k, uid: s.uid, start: '0s', duration: T(lens[k] || 1),
      hasVideo: hasVideo ? '1' : '0', format: hasVideo ? 'r1' : null,
      hasAudio: hasAudio ? '1' : '0', audioSources: hasAudio ? '1' : null, audioChannels: hasAudio ? (s.channels || 2) : null, audioRate: hasAudio ? (s.rate || 48000) : null,
    })}>`);
    res.push(`      <media-rep ${attrs({ kind: 'original-media', src: s.url || `file:///${k}` })}/>`);
    res.push('    </asset>');
  });

  const nameOf = (k) => sources[k]?.name || k;
  const timeMap = (p) => {
    const a = p.video.start;
    const b = p.video.freeze ? a : a + videoSpan(p);
    return [
      '          <timeMap>',
      `            <timept ${attrs({ time: T(a), value: T(a), interp: 'linear' })}/>`,
      `            <timept ${attrs({ time: T(a + p.dur), value: T(b), interp: 'linear' })}/>`,
      '          </timeMap>',
    ];
  };
  const clip = (k, offset, start, dur, { name, ...rest } = {}) => attrs({ ref: ids[k], offset: T(offset), name: name || nameOf(k), start: T(start), duration: T(dur), ...rest });

  const spine = [];
  for (const p of tl.pieces) {
    const name = p.name || nameOf(p.audio?.src || p.video?.src);
    if (!p.video && !p.audio) { spine.push(`        <gap ${attrs({ name: p.color ? `card ${p.color}` : 'Gap', offset: T(p.offset), start: '0s', duration: T(p.dur) })}/>`); continue; }
    const together = p.video && p.audio && p.video.src === p.audio.src && p.video.start === p.audio.start && !p.video.speed && !p.video.freeze;
    if (together) { spine.push(`        <asset-clip ${clip(p.audio.src, p.offset, p.audio.start, p.dur, { name, tcFormat: 'NDF' })}/>`); continue; }
    if (p.audio && !p.video) { spine.push(`        <asset-clip ${clip(p.audio.src, p.offset, p.audio.start, p.dur, { name, srcEnable: 'audio' })}/>`); continue; }
    if (p.video && !p.audio) {
      const timed = p.video.speed || p.video.freeze;
      if (!timed) { spine.push(`        <asset-clip ${clip(p.video.src, p.offset, p.video.start, p.dur, { name, srcEnable: 'video' })}/>`); continue; }
      spine.push(`        <asset-clip ${clip(p.video.src, p.offset, p.video.start, p.dur, { name, srcEnable: 'video' })}>`, ...timeMap(p), '        </asset-clip>');
      continue;
    }
    // sound from one place, picture from another: the sound is the spine clip, the picture is connected above it (its offset is in the parent's time)
    spine.push(`        <asset-clip ${clip(p.audio.src, p.offset, p.audio.start, p.dur, { name, srcEnable: 'audio' })}>`);
    const lane = { lane: '1', srcEnable: 'video', name: `${name} picture` };
    if (p.video.speed || p.video.freeze) {
      spine.push(`          <asset-clip ${clip(p.video.src, p.audio.start, p.video.start, p.dur, lane)}>`, ...timeMap(p).map((l) => '  ' + l), '          </asset-clip>');
    } else spine.push(`          <asset-clip ${clip(p.video.src, p.audio.start, p.video.start, p.dur, lane)}/>`);
    spine.push('        </asset-clip>');
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.10">',
    '  <resources>',
    ...res,
    '  </resources>',
    '  <library>',
    `    <event ${attrs({ name: opts.event || title })}>`,
    `      <project ${attrs({ name: title })}>`,
    `        <sequence ${attrs({ format: 'r1', duration: T(tl.length), tcStart: '0s', tcFormat: 'NDF', audioLayout: 'stereo', audioRate: '48k' })}>`,
    '          <spine>',
    ...spine.map((l) => '    ' + l),
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    '',
  ].join('\n');
}
