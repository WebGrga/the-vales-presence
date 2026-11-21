// The edit list (engine/README.md, edl.json v2) as a list of timeline pieces in whole frames, the shape both FCPXML and OTIO are written from. Pure.
//
// A piece: { name, offset, dur } in frames of the timeline, plus
//   video: { src, start, speed?, freeze? } | null   (start in frames of that source)
//   audio: { src, start } | null
// Items are back to back: offset = round(at * fps), dur = round((at + len) * fps) - offset, so rounding never opens a gap or an overlap.

// the frame rate as a rational frame duration: 60 -> 1/60, 59.94 -> 1001/60000
export function frameDuration(fps) {
  const f = Number(fps) || 30;
  for (const base of [24, 30, 48, 60, 120]) {
    const ntsc = (base * 1000) / 1001;
    if (Math.abs(f - ntsc) < 0.01) return { n: 1001, d: base * 1000, fps: ntsc };
  }
  if (Number.isInteger(f) || Math.abs(f - Math.round(f)) < 1e-6) return { n: 1, d: Math.round(f), fps: Math.round(f) };
  return { n: 1000, d: Math.round(f * 1000), fps: f };
}

export const toFrames = (sec, fps) => Math.round((Number(sec) || 0) * fps);

const num = (x) => (x == null || x === '' ? null : Number(x));

// one edl item -> what plays: sound from `src` at `src_in`; picture from `pic_src` (else `src`) at `pic_in` (else `src_in`)
export function pieceOf(item, fps, sources = {}) {
  const at = num(item.at) ?? 0, len = num(item.len) ?? 0;
  const offset = toFrames(at, fps);
  const dur = Math.max(0, toFrames(at + len, fps) - offset);
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null; // null: the writers name a clip after its recording's file
  let audio = null, video = null;
  const srcIn = num(item.src_in);
  if (item.src && srcIn != null) audio = { src: item.src, start: toFrames(srcIn, fps) };
  const picSrc = item.pic_src || item.src || null;
  const picIn = num(item.pic_in) ?? (item.pic_src ? null : srcIn);
  const speed = num(item.speed);
  const hasVideo = (s) => sources[s]?.hasVideo !== false;
  if (picSrc && picIn != null && hasVideo(picSrc)) {
    video = { src: picSrc, start: toFrames(picIn, fps) };
    if (speed && speed !== 1) video.speed = speed;
    else if (!item.src && num(item.pic_out) == null) video.freeze = true; // a held still: one picture for the whole piece
  }
  if (!audio && !video) return { name, offset, dur, video: null, audio: null, gap: true, color: item.color || null };
  return { name, offset, dur, video, audio };
}

// the whole edit list -> { fps, frame, width, height, total, length (frames the pieces fill), pieces, used } (used = the source keys the pieces need)
export function timelineOf(edl, sources = {}) {
  if (!edl || !Array.isArray(edl.items)) throw new Error('not an edit list: no items');
  const frame = frameDuration(edl.fps);
  const items = [...edl.items].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  // back to back: a hole becomes a gap, an overlap is trimmed off the later piece's head
  const pieces = [];
  let end = 0;
  for (const p of items.map((it) => pieceOf(it, frame.fps, sources))) {
    if (p.offset > end) pieces.push({ name: 'Gap', offset: end, dur: p.offset - end, video: null, audio: null, gap: true, color: null });
    else if (p.offset < end) {
      const cut = end - p.offset;
      p.offset = end; p.dur -= cut;
      if (p.audio) p.audio.start += cut;
      if (p.video && !p.video.freeze) p.video.start += Math.round(cut * (p.video.speed || 1));
    }
    if (p.dur <= 0) continue;
    pieces.push(p);
    end = p.offset + p.dur;
  }
  const total = Math.max(end, toFrames(edl.total || 0, frame.fps));
  const used = [...new Set(pieces.flatMap((p) => [p.video?.src, p.audio?.src]).filter(Boolean))];
  return { fps: frame.fps, frame, width: edl.width || 1920, height: edl.height || 1080, total, length: end, pieces, used };
}

// how many source frames a piece's picture runs over (a sped wait reads speed x its length)
export function videoSpan(p) {
  if (!p.video) return 0;
  if (p.video.freeze) return 1;
  return Math.round(p.dur * (p.video.speed || 1));
}

// the length of each used source in frames, from what the pieces reach when the probe gave nothing
export function sourceLengths(tl, sources = {}) {
  const out = {};
  for (const k of tl.used) {
    const known = sources[k]?.duration;
    let reach = 0;
    for (const p of tl.pieces) {
      if (p.video?.src === k) reach = Math.max(reach, p.video.start + videoSpan(p));
      if (p.audio?.src === k) reach = Math.max(reach, p.audio.start + p.dur);
    }
    out[k] = Math.max(reach, known ? toFrames(known, tl.fps) : 0);
  }
  return out;
}

// "my-title" from a title, for file names
export function slug(s, fallback = 'export') {
  const t = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return t || fallback;
}
