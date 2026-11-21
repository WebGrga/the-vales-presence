// The edit list as OpenTimelineIO JSON (.otio): a Timeline with one video track (V1) and one audio track (A1), a Clip per piece with its source range
// and an external reference to the footage, a Gap where a track has nothing. A sped wait carries a LinearTimeWarp, a held still a FreezeFrame. Pure.
import { timelineOf, sourceLengths } from './timeline.js';

const RT = (value, rate) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
const TR = (start, dur, rate) => ({ OTIO_SCHEMA: 'TimeRange.1', duration: RT(dur, rate), start_time: RT(start, rate) });

function gap(dur, rate) {
  return { OTIO_SCHEMA: 'Gap.1', metadata: {}, name: '', source_range: TR(0, dur, rate), effects: [], markers: [], enabled: true };
}

function clip(name, part, dur, rate, ref, extra = {}) {
  const effects = [];
  if (part.speed) effects.push({ OTIO_SCHEMA: 'LinearTimeWarp.1', metadata: {}, name: '', effect_name: 'LinearTimeWarp', time_scalar: part.speed });
  if (part.freeze) effects.push({ OTIO_SCHEMA: 'FreezeFrame.1', metadata: {}, name: '', effect_name: 'FreezeFrame', time_scalar: 0 });
  return {
    OTIO_SCHEMA: 'Clip.2', metadata: extra, name, source_range: TR(part.start, dur, rate), effects, markers: [], enabled: true,
    media_references: { DEFAULT_MEDIA: ref }, active_media_reference_key: 'DEFAULT_MEDIA',
  };
}

// consecutive gaps become one
function pushGap(list, dur, rate) {
  const last = list[list.length - 1];
  if (last?.OTIO_SCHEMA === 'Gap.1') last.source_range.duration.value += dur;
  else list.push(gap(dur, rate));
}

// edl: the edit list; opts: { title, sources: { key: { url, name, hasVideo, hasAudio, duration } } }
export function toOtio(edl, opts = {}) {
  const sources = opts.sources || {};
  const tl = timelineOf(edl, sources);
  const rate = tl.fps;
  const lens = sourceLengths(tl, sources);
  const ref = (k) => ({
    OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name: sources[k]?.name || k,
    available_range: TR(0, lens[k] || 0, rate), available_image_bounds: null, target_url: sources[k]?.url || k,
  });
  const v = [], a = [];
  for (const p of tl.pieces) {
    const nameOf = (k) => p.name || sources[k]?.name || k;
    if (p.video) v.push(clip(nameOf(p.video.src), p.video, p.dur, rate, ref(p.video.src), { presence: { src: p.video.src } }));
    else pushGap(v, p.dur, rate);
    if (p.audio) a.push(clip(nameOf(p.audio.src), p.audio, p.dur, rate, ref(p.audio.src), { presence: { src: p.audio.src } }));
    else pushGap(a, p.dur, rate);
  }
  const track = (name, kind, children) => ({ OTIO_SCHEMA: 'Track.1', metadata: {}, name, source_range: null, effects: [], markers: [], enabled: true, children, kind });
  return {
    OTIO_SCHEMA: 'Timeline.1',
    metadata: { presence: { width: tl.width, height: tl.height, fps: rate } },
    name: opts.title || 'Edit',
    global_start_time: RT(0, rate),
    tracks: {
      OTIO_SCHEMA: 'Stack.1', metadata: {}, name: 'tracks', source_range: null, effects: [], markers: [], enabled: true,
      children: [track('V1', 'Video', v), track('A1', 'Audio', a)],
    },
  };
}

// the length of a track in frames (for checks)
export function trackLength(track) {
  return track.children.reduce((s, c) => s + c.source_range.duration.value, 0);
}
