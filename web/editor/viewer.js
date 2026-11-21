// The viewer: plays the working edit list live with two <video> elements, the next piece waiting (loaded and seeked)
// in the hidden one and swapped in at each piece edge, so nothing is rendered to preview a change.
// Modes: After (the edit), Before (the recording as it was, from the same moment, removed words and all), A/B (the
// current cut's own Before then After clips from video/out/work/cuts/), Final (the rendered video/out/final.mp4 with its
// overlays and captions, on the same clock as the rough; shown once there is one). Proxies are used when the server made them,
// else the footage itself. The maths (which piece plays when, source time) is in edl-map.js. Blur boxes are drawn on the picture
// by viewer-redact.js. A piece whose video is still seeking is shown only once its frame is there (no flash of another frame).
import { h, icon, button } from '../shell/dom.js';
import { toSource, toEdit, pieceAt } from './edl-map.js';
import { fmtTC } from './zoom.js';
import { createRedactor } from './viewer-redact.js';

export function createViewer(store, ui) {
  const S = store.S;
  const vids = [mkVideo(), mkVideo()];
  const card = h('div.v-card');
  const badge = h('div.v-badge.pixel');
  const note = h('div.v-note');
  const empty = h('div.v-empty', { hidden: true });
  const screen = h('div.v-screen', ...vids, card, badge, note, empty);
  const redactor = createRedactor(store, ui, screen);
  const playBtn = button('play', '', 'Play / pause (Space)', () => toggle());
  const tc = h('div.v-tc.pixel');
  const speedEl = h('span.v-speed.pixel');
  const TITLES = { ab: 'The current cut: its Before clip, then its After clip', before: 'The recording as it was (\\ switches)', after: 'Your edit, live (\\ switches)', final: 'The rendered final, with its overlays and captions' };
  const modes = h('div.seg', ...['before', 'after', 'ab', 'final'].map((m) => {
    const b = h('button.small', { type: 'button', 'data-m': m, title: TITLES[m], hidden: m === 'final' }, { ab: 'A/B', before: 'Before', after: 'After', final: 'Final' }[m]);
    b.addEventListener('click', () => setMode(m));
    return b;
  }));
  const bar = h('div.v-bar',
    button('cutprev', '', 'Previous cut (↑)', () => ui.act('prevCut')),
    button('frameprev', '', 'Back a frame (←)', () => step(-1)),
    playBtn,
    button('framenext', '', 'Forward a frame (→)', () => step(1)),
    button('cutnext', '', 'Next cut (↓)', () => ui.act('nextCut')),
    tc, speedEl, h('div.grow'), redactor.toolBtn, modes);
  const el = h('div.viewer', screen, bar);

  let act = 0, cur = -1, playing = false, mode = 'after', speed = 1, t = 0;
  let clock = null; // { t0 (edit time), at (performance.now()) } while a still or a card plays
  let before = null; // { media, time } in Before mode
  let ab = null;     // { cut, which: 'before'|'after' } in A/B mode
  let raf = 0;
  let finalSeen = null; // the final URL the viewer last switched to Final for

  function mkVideo() {
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.disablePictureInPicture = true;
    return v;
  }
  const fps = () => S.fps || 30;
  const urlOf = (media) => S.sources[media]?.proxy || S.sources[media]?.url || null;
  function load(v, url) { if (url && v.dataset.src !== url) { v.dataset.src = url; v.src = url; } }
  function showVid(k) { vids.forEach((v, n) => v.classList.toggle('on', n === k)); card.classList.remove('on'); }
  const near = (a, b) => Math.abs(a - b) < 0.5 / fps();

  // ------------------------------------------------------------------ After: the edit list
  function startPiece(i, offset, run) {
    const p = S.ps[i]; cur = i; clock = null;
    if (!p) return;
    let later = false; // the video is still seeking: the old picture stays until it lands, then the next piece is made ready
    if (p.type === 'card' || !urlOf(p.media)) {
      card.style.background = p.color || '#000'; card.classList.add('on'); vids.forEach((v) => { v.classList.remove('on'); v.pause(); });
      clock = { t0: p.at + offset, at: performance.now() };
    } else {
      const v = vids[act];
      load(v, urlOf(p.media));
      const want = p.in + offset * p.rate;
      if (!near(v.currentTime, want)) v.currentTime = want;
      v.muted = p.muted || ui.muted;
      v.playbackRate = Math.max(0.0625, Math.min(16, (p.rate || 1) * speed));
      if (v.seeking && vids[1 - act].classList.contains('on')) {
        later = true;
        const k = act;
        vids[1 - act].pause(); // the old picture holds still (it must not play on into what was cut)
        v.addEventListener('seeked', () => { if (act === k && cur === i) { showVid(k); prepare(i + 1); } }, { once: true });
      } else showVid(act);
      if (p.type === 'hold') { v.pause(); clock = { t0: p.at + offset, at: performance.now() }; }
      else if (run) v.play().catch(() => {});
      else v.pause();
    }
    badge.textContent = p.type === 'wait' ? `wait ×${+p.rate.toFixed(1)}` : p.type === 'hold' ? 'still' : p.type === 'card' ? 'card' : '';
    badge.hidden = !badge.textContent;
    if (!later) prepare(i + 1);
  }
  function prepare(j) {
    const p = S.ps[j], v = vids[1 - act];
    if (!p || !urlOf(p.media) || p.type === 'card') return;
    load(v, urlOf(p.media));
    v.pause();
    if (!near(v.currentTime, p.in)) v.currentTime = p.in;
  }
  function editTime() {
    const p = S.ps[cur];
    if (!p) return t;
    if (clock) return clock.t0 + ((performance.now() - clock.at) / 1000) * speed;
    return p.at + (vids[act].currentTime - p.in) / (p.rate || 1);
  }

  // ------------------------------------------------------------------ the loop
  function tick() {
    raf = 0;
    if (!playing) return;
    if (mode === 'after') {
      let now = editTime();
      const p = S.ps[cur];
      if (p && now >= p.end - 0.6 / fps()) {
        if (cur + 1 >= S.ps.length) { t = p.end; pause(); emitTime(); return; }
        act = 1 - act; startPiece(cur + 1, 0, true); now = S.ps[cur].at;
      }
      t = Math.max(0, now);
    } else if (mode === 'before') {
      before.time = vids[act].currentTime;
      const e = toEdit(S.ps, before.media, before.time);
      if (e != null) t = e;
    } else if (mode === 'final') {
      const v = vids[act];
      t = v.currentTime;
      if (v.ended) { pause(); }
    } else if (mode === 'ab' && ab) {
      const v = vids[act];
      if (v.ended || (v.duration && v.currentTime >= v.duration - 0.05)) {
        if (ab.which === 'before') playAbPart('after'); else { pause(); }
      }
    }
    emitTime();
    raf = requestAnimationFrame(tick);
  }
  function emitTime() {
    tc.textContent = mode === 'before' && before
      ? `${before.media} ${fmtTC(before.time, fps())}`
      : mode === 'ab' && ab ? `${ab.cut.id} · ${ab.which === 'before' ? 'A · before' : 'B · after'}`
        : `${fmtTC(t, fps())} / ${fmtTC(S.ps.length ? S.ps[S.ps.length - 1].end : 0, fps())}`;
    ui.onTime({ t, mode, src: mode === 'before' ? before?.media : null, srcT: mode === 'before' ? before?.time : null, playing });
    redactor.onTime(t, mode);
  }

  // ------------------------------------------------------------------ controls
  function play() {
    if (playing) return;
    if (mode === 'ab') { playAb(); return; }
    if (!S.ps.length) return;
    playing = true; playBtn.replaceChildren(icon('pause'));
    if (mode === 'after') {
      if (t >= S.ps[S.ps.length - 1].end - 0.01) t = 0;
      const i = pieceAt(S.ps, t);
      startPiece(i, t - S.ps[i].at, true);
    } else {
      const v = vids[act];
      v.playbackRate = speed; v.muted = ui.muted;
      v.play().catch(() => {});
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false; playBtn.replaceChildren(icon('play'));
    if (mode === 'after' && cur >= 0) t = Math.min(editTime(), S.ps[cur]?.end ?? t);
    vids.forEach((v) => v.pause()); clock = null;
    speed = 1; speedEl.textContent = '';
    emitTime();
  }
  const toggle = () => (playing ? pause() : play());

  function seek(x, opts = {}) {
    const total = S.ps.length ? S.ps[S.ps.length - 1].end : 0;
    t = Math.max(0, Math.min(total, x));
    if (mode === 'ab') setMode('after');
    if (mode === 'before') {
      const s = toSource(S.ps, t);
      if (s) seekSource(s.media, s.time);
    } else if (mode === 'final') {
      seekFinal();
    } else if (S.ps.length) {
      const i = pieceAt(S.ps, t);
      startPiece(i, t - S.ps[i].at, playing);
    }
    if (opts.play && !playing) play();
    emitTime();
  }
  function seekSource(media, time) {
    if (mode !== 'before') { mode = 'before'; paintMode(); }
    before = { media, time };
    const v = vids[act];
    load(v, urlOf(media)); v.currentTime = time; v.muted = ui.muted; showVid(act);
    badge.hidden = true;
    if (playing) v.play().catch(() => {}); else v.pause();
    const e = toEdit(S.ps, media, time); if (e != null) t = e;
    emitTime();
  }
  function seekFinal() {
    const v = vids[act];
    load(v, S.finalUrl); v.muted = ui.muted; v.playbackRate = speed; showVid(act);
    if (!near(v.currentTime, t)) v.currentTime = t;
    badge.textContent = 'final'; badge.hidden = false;
    if (playing) v.play().catch(() => {}); else v.pause();
  }
  function step(frames) {
    if (playing) pause();
    if (mode === 'before' && before) seekSource(before.media, Math.max(0, before.time + frames / fps()));
    else seek(t + frames / fps());
  }
  function shuttle(dir) {
    if (dir > 0) {
      if (playing && speed < 4) speed *= 2; else if (!playing) { speed = 1; play(); }
    } else if (playing && speed > 1) speed /= 2;
    else { const was = playing; if (was) pause(); seek(t - 3); play(); }
    vids.forEach((v) => { if (!v.paused) v.playbackRate = Math.max(0.0625, (S.ps[cur]?.rate || 1) * speed); });
    speedEl.textContent = speed > 1 ? `×${speed}` : '';
  }

  // ------------------------------------------------------------------ modes
  function setMode(m) {
    if (m === mode && m !== 'ab') return;
    const was = playing;
    if (playing) pause();
    if (m === 'before') {
      const s = toSource(S.ps, t);
      mode = 'before';
      if (s?.media) seekSource(s.media, s.time);
    } else if (m === 'after' || (m === 'final' && S.finalUrl)) {
      mode = m; before = null; ab = null; note.hidden = true;
      if (m === 'after') badge.hidden = true;
      seek(t);
    } else {
      mode = 'ab';
      const c = ui.currentCut() || nearestCut();
      if (!c) { note.textContent = 'No cut here to compare.'; note.hidden = false; mode = 'after'; }
      else { ab = { cut: c, which: 'before' }; playAb(); return paintMode(); }
    }
    paintMode();
    if (was && m !== 'ab') play();
  }
  function nearestCut() {
    let best = null;
    for (const c of S.cuts) if (!best || Math.abs(c.at - t) < Math.abs(best.at - t)) best = c;
    return best;
  }
  function playAb(cut) {
    if (cut) ab = { cut, which: 'before' };
    if (!ab) return;
    if (mode !== 'ab') { if (playing) pause(); mode = 'ab'; paintMode(); }
    playAbPart('before');
  }
  function playAbPart(which) {
    ab.which = which;
    const rel = store.clipUrl(ab.cut, which);
    const v = vids[act];
    if (!rel) { note.textContent = `No ${which} clip was made for ${ab.cut.id}.`; note.hidden = false; return; }
    note.hidden = true;
    load(v, rel); v.currentTime = 0; v.muted = ui.muted; v.playbackRate = 1; showVid(act);
    badge.textContent = which === 'before' ? 'A · before' : 'B · after'; badge.hidden = false;
    playing = true; playBtn.replaceChildren(icon('pause'));
    v.play().catch(() => {});
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function paintMode() {
    for (const b of modes.querySelectorAll('button')) { b.classList.toggle('on', b.dataset.m === mode); if (b.dataset.m === 'final') b.hidden = !S.finalUrl; }
    el.dataset.mode = mode;
    redactor.onTime(t, mode);
    if (mode !== 'ab' && badge.textContent.includes('·')) badge.hidden = true;
  }

  // ------------------------------------------------------------------ data changed
  function refresh() {
    empty.hidden = S.ps.length > 0;
    if (!S.ps.length) { empty.textContent = S.problem === 'no-edl' ? 'No rough cut yet. Drop your footage into Media, then press Go.' : S.loaded ? 'Nothing to play yet.' : 'Reading the edit…'; return; }
    paintMode();
    if (mode === 'final' && !S.finalUrl) { setMode('after'); return; }
    if (S.finalUrl && S.finalUrl !== finalSeen && !playing) { finalSeen = S.finalUrl; if (mode !== 'final') { setMode('final'); return; } } // a new final: show it
    if (mode === 'after' && !playing) seek(Math.min(t, S.ps[S.ps.length - 1].end));
    else if (mode === 'final') seek(t);
    else if (mode === 'after' && playing) { const i = pieceAt(S.ps, t); act = 1 - act; startPiece(i, t - S.ps[i].at, true); }
    else emitTime();
  }
  for (const v of vids) v.addEventListener('error', () => {
    if (v.classList.contains('on')) { note.textContent = 'This video could not play here. A proxy (made by the server) plays everywhere.'; note.hidden = false; }
  });

  paintMode();
  playBtn.replaceChildren(icon('play'));
  return {
    el, play, pause, toggle, seek, seekSource, step, shuttle, setMode, playAb, refresh, boxes: redactor,
    get t() { return t; }, get mode() { return mode; }, get playing() { return playing; },
    mute(m) { vids.forEach((v) => { v.muted = m || (mode === 'after' && S.ps[cur]?.muted); }); },
    dispose() { cancelAnimationFrame(raf); vids.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); },
  };
}
