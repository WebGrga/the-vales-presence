// Media of a project: safe paths inside it (linked footage resolves to the real file, footage.js), and the screen's live-preview helpers: 540p proxies of every source
// (video/out/work/proxy/<src>.mp4) and waveform peaks (video/out/work/peaks/<src>.json: { rate: 100, peaks: [0..1] }).
// <src> is the edit list's source key (r1, ...); footage not in the edit list goes by its file name without extension.
// The rough gets peaks too (peaks/rough.json). Made once, remade when the source is newer; one job per project at a time.
// Encoders are probed once: NVENC, Quick Sync, AMF, VideoToolbox, then libx264 (no GPU is assumed).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { safeJoin } from './http.js';
import { resolveFootage, listFootage } from './footage.js';

export const PEAK_RATE = 100;      // peaks per second
const SAMPLE_RATE = 8000;          // the sound is read at this rate for peaks
export const ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'libx264'];
const VIDEO_EXT = /\.(mp4|mkv|mov|m4v|webm|avi|mts|m2ts|ts|flv|wmv|mxf)$/i;
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;

// pure: the encoder's arguments for a 540p proxy
export function encoderArgs(enc) {
  switch (enc) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '28', '-b:v', '0'];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-global_quality', '28', '-preset', 'faster'];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '26', '-qp_p', '28'];
    case 'h264_videotoolbox': return ['-c:v', 'h264_videotoolbox', '-b:v', '2500k'];
    default: return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'];
  }
}

// pure: what to make proxies of. edl: edl.json or null; files: names in video/footage.
// -> [{ src, file (relative to video/), track, audioOnly }]
export function proxyPlan(edl, files) {
  const out = [], seen = new Set();
  for (const [src, s] of Object.entries(edl?.sources || {})) {
    if (!s || typeof s.file !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(src)) continue;
    const file = s.file.replace(/\\/g, '/');
    if (path.isAbsolute(file) || file.split('/').includes('..')) continue;
    if (!VIDEO_EXT.test(file) && !AUDIO_EXT.test(file)) continue;
    out.push({ src, file, track: Number.isInteger(s.track) ? s.track : 0, audioOnly: AUDIO_EXT.test(file) });
    seen.add(path.posix.basename(file));
  }
  const keys = new Set(out.map((x) => x.src));
  for (const f of files || []) {
    if (seen.has(f) || !(VIDEO_EXT.test(f) || AUDIO_EXT.test(f))) continue;
    let key = f.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'footage';
    while (keys.has(key)) key += '-2';
    keys.add(key);
    out.push({ src: key, file: 'footage/' + f, track: 0, audioOnly: AUDIO_EXT.test(f) });
  }
  return out;
}

// pure: is a made file still good for its source? (both { mtimeMs, size } or null)
export const fresh = (src, made) => !!(src && made && made.size > 0 && made.mtimeMs >= src.mtimeMs);

// pure: 16-bit mono samples -> peaks 0..1, one per `per` samples (the loudest sample of each bin)
export function reducePeaks(samples, per) {
  const n = Math.ceil(samples.length / per), out = new Array(n);
  for (let b = 0; b < n; b++) {
    let m = 0;
    const end = Math.min(samples.length, (b + 1) * per);
    for (let i = b * per; i < end; i++) { const v = samples[i] < 0 ? -samples[i] : samples[i]; if (v > m) m = v; }
    out[b] = Math.round((m / 32768) * 1000) / 1000;
  }
  return out;
}

// a streaming version: feed Buffers of s16le, get the peaks at the end (never the whole sound in memory)
export function peakFolder(per) {
  const peaks = []; let m = 0, k = 0, carry = null;
  return {
    push(buf) {
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      const even = buf.length - (buf.length % 2);
      if (even < buf.length) carry = buf.subarray(even);
      for (let i = 0; i < even; i += 2) {
        let v = buf.readInt16LE(i); if (v < 0) v = -v;
        if (v > m) m = v;
        if (++k === per) { peaks.push(Math.round((m / 32768) * 1000) / 1000); m = 0; k = 0; }
      }
    },
    end() { if (k > 0) peaks.push(Math.round((m / 32768) * 1000) / 1000); return peaks; },
  };
}

function run(cmd, args, { onStdout, timeoutMs = 0 } = {}) {
  return new Promise((ok) => {
    let err = '';
    const p = spawn(cmd, args, { windowsHide: true });
    const t = timeoutMs ? setTimeout(() => p.kill(), timeoutMs) : null;
    p.stdout.on('data', (d) => onStdout?.(d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => { if (t) clearTimeout(t); ok({ code: -1, err: e.message }); });
    p.on('close', (code) => { if (t) clearTimeout(t); ok({ code, err }); });
  });
}

export function createMedia(ctx) {
  let encoder = null; // probed once
  const jobs = {};    // project id -> the running proxy job (a promise)
  const state = {};   // project id -> { state, done, total, error }

  // a file of a project by its relative path (never outside it)
  // a footage name that is a link plays from where the real file is
  function fileOf(id, rel) {
    const f = safeJoin(ctx.projectDir(id), rel);
    const m = f && /^video[\\/]footage[\\/]([^\\/]+)$/.exec(path.relative(ctx.projectDir(id), f));
    return m ? resolveFootage(ctx.projectDir(id), 'footage/' + m[1]) : f;
  }

  async function probeEncoder() {
    if (encoder) return encoder;
    const forced = process.env.PRESENCE_ENCODER === 'cpu' ? 'libx264' : process.env.PRESENCE_ENCODER; // the engine's own switch: cpu = libx264
    for (const enc of ENCODERS.includes(forced) ? [forced] : ENCODERS) {
      const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:r=30:d=0.2', ...encoderArgs(enc), '-f', 'null', '-'], { timeoutMs: 20000 });
      if (r.code === 0) { encoder = enc; ctx.log?.('proxy encoder:', enc); return enc; }
    }
    encoder = 'libx264';
    return encoder;
  }

  const stat = (f) => { try { const s = fs.statSync(f); return { mtimeMs: s.mtimeMs, size: s.size }; } catch { return null; } };

  async function makeProxy(input, out, track, audioOnly) {
    const tmp = out.replace(/\.mp4$/, '.part.mp4');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tries = audioOnly ? [null] : [await probeEncoder(), 'libx264'].filter((x, i, a) => a.indexOf(x) === i);
    let last = '';
    for (const enc of tries) {
      const v = audioOnly ? ['-vn'] : ['-map', '0:v:0', '-vf', 'scale=-2:540:flags=bicubic,format=yuv420p', ...encoderArgs(enc), '-g', '30', '-bf', '0'];
      const args = ['-hide_banner', '-v', 'error', '-y', '-i', input, ...v, '-map', `0:a:${track}?`, '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', tmp];
      const r = await run('ffmpeg', args);
      if (r.code === 0) { fs.renameSync(tmp, out); return; }
      last = r.err; try { fs.rmSync(tmp, { force: true }); } catch {}
      if (enc === encoder && enc !== 'libx264') ctx.log?.('proxy: encoder', enc, 'failed, falling back');
    }
    throw new Error('ffmpeg could not make the proxy: ' + last.trim().split('\n').slice(-2).join(' '));
  }

  async function makePeaks(input, out, track) {
    const fold = peakFolder(SAMPLE_RATE / PEAK_RATE);
    const r = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', input, '-map', `0:a:${track}?`, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { onStdout: (d) => fold.push(d) });
    if (r.code !== 0) throw new Error('ffmpeg could not read the sound: ' + r.err.trim().split('\n').slice(-1)[0]);
    const peaks = fold.end();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = out + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ rate: PEAK_RATE, duration: peaks.length / PEAK_RATE, peaks }));
    fs.renameSync(tmp, out);
  }

  // what exists now, without making anything
  function list(id) {
    const dir = ctx.projectDir(id), video = path.join(dir, 'video');
    let edl = null; try { edl = JSON.parse(fs.readFileSync(path.join(video, 'out', 'edl.json'), 'utf8')); } catch {}
    const files = listFootage(dir).map((f) => f.name); // links too: they may not be in the folder itself
    const plan = proxyPlan(edl, files);
    const rel = (...p) => ['video', ...p].join('/');
    const sources = {};
    for (const s of plan) {
      const src = stat(resolveFootage(dir, s.file));
      const proxy = path.join(video, 'out', 'work', 'proxy', `${s.src}.mp4`), peaks = path.join(video, 'out', 'work', 'peaks', `${s.src}.json`);
      sources[s.src] = { file: s.file, track: s.track, audioOnly: s.audioOnly, present: !!src,
        proxyPath: s.audioOnly ? null : rel('out', 'work', 'proxy', `${s.src}.mp4`), peaksPath: rel('out', 'work', 'peaks', `${s.src}.json`),
        proxyReady: s.audioOnly ? true : fresh(src, stat(proxy)), peaksReady: fresh(src, stat(peaks)) };
      const x = sources[s.src];
      // proxy / peaks: the path inside the project once the file is made, else null (play the footage itself meanwhile)
      x.proxy = !s.audioOnly && x.proxyReady ? x.proxyPath : null;
      x.peaks = x.peaksReady ? x.peaksPath : null;
      x.url = x.proxy ? `/api/media/${id}/${x.proxy}` : null;
      x.peaksUrl = x.peaks ? `/api/media/${id}/${x.peaks}` : null;
    }
    const roughSrc = stat(path.join(video, 'out', 'rough.mp4'));
    const roughPeaks = roughSrc && fresh(roughSrc, stat(path.join(video, 'out', 'work', 'peaks', 'rough.json')));
    const rough = roughSrc ? { file: 'out/rough.mp4', url: `/api/media/${id}/video/out/rough.mp4`, peaksPath: rel('out', 'work', 'peaks', 'rough.json'),
      peaks: roughPeaks ? rel('out', 'work', 'peaks', 'rough.json') : null, peaksUrl: roughPeaks ? `/api/media/${id}/${rel('out', 'work', 'peaks', 'rough.json')}` : null, peaksReady: !!roughPeaks } : null;
    const ready = Object.values(sources).every((s) => !s.present || (s.proxyReady && s.peaksReady)) && (!rough || rough.peaksReady);
    return { sources, rough, ready, encoder, job: state[id] || null, plan };
  }

  // make whatever is missing; one job per project. -> the list when done
  function make(id) {
    if (jobs[id]) return jobs[id];
    const job = (async () => {
      const dir = ctx.projectDir(id), video = path.join(dir, 'video');
      const now = list(id);
      const todo = [];
      for (const [key, s] of Object.entries(now.sources)) {
        if (!s.present) continue;
        const input = resolveFootage(dir, s.file);
        if (!s.proxyReady) todo.push({ what: `proxy ${key}`, path: s.proxyPath, run: () => makeProxy(input, path.join(video, 'out', 'work', 'proxy', `${key}.mp4`), s.track, s.audioOnly) });
        if (!s.peaksReady) todo.push({ what: `peaks ${key}`, path: s.peaksPath, run: () => makePeaks(input, path.join(video, 'out', 'work', 'peaks', `${key}.json`), s.track) });
      }
      if (now.rough && !now.rough.peaksReady) todo.push({ what: 'peaks rough', path: now.rough.peaksPath, run: () => makePeaks(path.join(video, 'out', 'rough.mp4'), path.join(video, 'out', 'work', 'peaks', 'rough.json'), 0) });
      state[id] = { state: 'making', done: 0, total: todo.length, started: Date.now() };
      const errors = [], made = [];
      for (const t of todo) {
        ctx.broadcast({ type: 'proxy', project: id, state: 'making', what: t.what, done: state[id].done, total: todo.length });
        const t0 = Date.now();
        try { await t.run(); made.push(t.path); ctx.log?.(`${id}: ${t.what} in ${((Date.now() - t0) / 1000).toFixed(1)} s`); } catch (e) { errors.push(`${t.what}: ${e.message}`); }
        state[id].done++;
      }
      state[id] = { state: errors.length ? 'error' : 'ready', done: todo.length, total: todo.length, ms: Date.now() - state[id].started, errors: errors.length ? errors : undefined };
      if (made.length) ctx.broadcast({ type: 'files', project: id, paths: made });
      ctx.broadcast({ type: 'proxy', project: id, state: state[id].state, errors: errors.length ? errors : undefined });
      return list(id);
    })().finally(() => { delete jobs[id]; });
    jobs[id] = job;
    return job;
  }

  return { fileOf, list, make, probeEncoder, busy: (id) => !!jobs[id] };
}
