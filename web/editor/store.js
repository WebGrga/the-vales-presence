// The editor's data for one project, and saving it: the engine's edit list (video/out/edl.json), the cuts and the
// user's choices on them (GET/POST /api/cuts/:id), the user's struck stretches and the working edit list they make
// (POST /api/cuts/:id { working }), the words, the overlays, and proxies with waveform peaks when the server has them.
// Every choice is sent at once (a note 400 ms after typing stops) and sent again if it fails; nothing waits for a
// button. on('change', fn) hears { what: 'all'|'review'|'working'|'peaks'|'proxy' }.
import { fetchJson, fetchText } from '../shell/api.js';
import { pieces, sourceFile, wordsFile } from './edl-map.js';
import { workingEdl, baseMark, restorable, cleanStrikes, cleanTrims, cleanBlades } from './edl-edit.js';
import { readItems } from './timeline-marks.js';
import { restoredIds } from './cuts-order.js';
import { parseTsv, fromRoughWords } from './words.js';
import { emptyHistory, push, undo as undoH, redo as redoH } from './history.js';

export function createStore(app, id) {
  const enc = encodeURIComponent;
  const media = (rel) => app.media(rel);
  const fns = new Set();
  const S = {
    id, loaded: false, problem: null, edl: null, basePs: [], cuts: [], review: {}, strikes: [], working: null, ps: [],
    words: {}, events: [], sources: {}, peaks: {}, fps: 30, staleWorking: false, cutsFrom: null,
    trims: [], blades: [], redactions: null, eventEdits: null, reviewItems: [], editsState: null,
  };
  let hist = emptyHistory();
  const dirty = new Set(), ver = {}; // cut ids waiting to be saved, and their versions
  let workingDirty = false, saveTimer = null, workTimer = null, retryTimer = null;

  const emit = (what) => { for (const fn of fns) { try { fn({ what }); } catch (e) { console.error(e); } } };
  const status = (s) => { S.saveState = s; emit('saved'); };

  // ------------------------------------------------------------------ reading
  async function load() {
    const edl = await fetchJson(media('video/out/edl.json'));
    if (!edl || !Array.isArray(edl.items)) { S.problem = 'no-edl'; S.loaded = true; emit('all'); return; }
    S.edl = edl; S.fps = Number(edl.fps) || 30; S.basePs = pieces(edl);
    const [cutsData, working, rough, events, finalUrl] = await Promise.all([
      readCuts(), readWorking(), fetchJson(media('video/out/rough-words.json')), fetchJson(media('video/out/events.json')), readFinal(), readEdits(),
    ]);
    S.finalUrl = finalUrl;
    S.cuts = cutsData.cuts; S.review = cutsData.review;
    S.strikes = []; S.trims = []; S.blades = [];
    S.staleWorking = false;
    if (working?.working) {
      if (working.working.base === baseMark(edl)) {
        S.strikes = cleanStrikes(working.working.strikes); S.trims = cleanTrims(working.working.trims); S.blades = cleanBlades(working.working.blades);
      } else S.staleWorking = true; // made from an older rough: its strikes do not fit this one
    }
    S.events = Array.isArray(events?.events) ? events.events : Array.isArray(events) ? events : [];
    S.sources = {};
    const keys = Object.keys(edl.sources || {});
    await Promise.all(keys.map(async (k) => {
      S.sources[k] = { key: k, file: sourceFile(edl, k), url: media(sourceFile(edl, k)), proxy: null };
      const text = await fetchText(media(wordsFile(edl, k)));
      const list = text ? parseTsv(text) : [];
      S.words[k] = list.length ? list : fromRoughWords(rough, k);
    }));
    recompute();
    S.loaded = true; S.problem = null;
    emit('all');
    loadProxy();
  }

  // the rendered final (video/out/final.mp4) when there is one: its URL with its time, so a new render plays fresh
  async function readFinal() {
    try {
      const r = await fetch(media('video/out/final.mp4'), { method: 'HEAD', cache: 'no-cache' });
      return r.ok ? `${media('video/out/final.mp4')}?v=${encodeURIComponent(r.headers.get('last-modified') || Date.now())}` : null;
    } catch { return null; }
  }

  // your visual edits (redactions.json, event-edits.json) and the review items the stages wrote; a missing file is null
  async function readEdits() {
    const [red, ed, items] = await Promise.all([
      fetchJson(media('video/out/redactions.json')), fetchJson(media('video/out/event-edits.json')),
      app.api(`/api/projects/${enc(id)}/review-items`).catch(() => fetchJson(media('video/out/review-items.json'))),
    ]);
    if (!editsDirty.redactions) S.redactions = red;
    if (!editsDirty['event-edits']) S.eventEdits = ed;
    S.reviewItems = readItems(items);
  }
  // save one of them at once (POST /api/edits/:id); sent again if it fails
  const editsDirty = {};
  function saveEdits(file, data) {
    if (file === 'redactions') S.redactions = data; else S.eventEdits = data;
    editsDirty[file] = (editsDirty[file] || 0) + 1;
    const v = editsDirty[file];
    emit('edits');
    const send = () => app.api(`/api/edits/${enc(id)}`, { file, data })
      .then(() => { if (editsDirty[file] === v) delete editsDirty[file]; S.editsState = Object.keys(editsDirty).length ? 'saving' : 'saved'; emit('saved'); return true; })
      .catch((e) => {
        S.editsState = e.status === 404 ? 'not saved: the server has no /api/edits route yet' : `not saved yet (${e.message}), trying again`;
        emit('saved');
        if (e.status !== 404 && e.status !== 400) setTimeout(() => { if (editsDirty[file] === v) send(); }, 3000);
        if (e.status === 400) app.toast?.(`Not saved: ${e.message}`, 'error');
        return false;
      });
    S.editsState = 'saving'; emit('saved');
    return send();
  }

  // the working list through the cuts route (no 404 when there is none), else the file itself
  async function readWorking() {
    try { const d = await app.api(`/api/cuts/${enc(id)}/working`); return d?.working ?? null; } catch { return fetchJson(media('video/out/edl.working.json')); }
  }

  async function readCuts() {
    try {
      const d = await app.api(`/api/cuts/${enc(id)}`);
      if (Array.isArray(d?.cuts)) { S.cutsFrom = 'api'; return { cuts: d.cuts.filter((c) => c && c.id), review: d.review || {} }; }
      if (d && d.cuts === null) return { cuts: [], review: {} };
    } catch (e) { if (e.status !== 404) console.warn('cuts:', e.message); }
    // no cuts route yet: read the files themselves (choices then live only in this browser until the route exists)
    S.cutsFrom = 'files';
    const c = await fetchJson(media('video/out/cuts.json'));
    const r = await fetchJson(media('video/out/cuts-review.json'));
    return { cuts: (c?.cuts || []).filter((x) => x && x.id), review: r || {} };
  }

  async function reloadCuts() {
    const d = await readCuts();
    const before = JSON.stringify([S.cuts.map((c) => c.id), S.review]);
    S.cuts = d.cuts;
    for (const [cid, r] of Object.entries(d.review)) if (!dirty.has(cid)) S.review[cid] = r; // what is still being saved stands
    for (const cid of Object.keys(S.review)) if (!dirty.has(cid) && !(cid in d.review)) delete S.review[cid];
    if (JSON.stringify([S.cuts.map((c) => c.id), S.review]) === before) return; // our own choice coming back
    recompute(); emit('review'); emit('working');
  }

  // proxies and peaks: asked without waiting (the server starts making what is missing and says 'proxy' ready later)
  async function loadProxy() {
    let d = null;
    try { d = await app.api(`/api/projects/${enc(id)}/proxy?nowait=1`); } catch { return; }
    const map = d?.sources || {};
    let changed = false;
    for (const [k, v] of Object.entries(map)) {
      if (!S.sources[k] || !v || typeof v !== 'object') continue;
      const purl = v.proxy && v.proxyReady !== false ? (v.url && /proxy/.test(v.url) ? v.url : media(v.proxy)) : null;
      if (purl && purl !== S.sources[k].proxy) { S.sources[k].proxy = purl; changed = true; }
      if (v.peaks && v.peaksReady !== false && !S.peaks[k]) {
        const pk = await fetchJson(v.peaksUrl || media(v.peaks));
        if (Array.isArray(pk?.peaks)) { S.peaks[k] = { rate: Number(pk.rate) || 100, peaks: pk.peaks }; changed = true; }
      }
    }
    S.proxyMaking = !!d?.making;
    if (changed) emit('proxy');
  }

  // a cut clip's url (cuts.json paths are relative to video/; the server may hand the urls itself)
  const clipUrl = (c, which) => c?.urls?.[which] || (c?.clips?.[which] ? media('video/' + String(c.clips[which]).replace(/^\.?\//, '')) : null);

  function recompute() {
    const restored = restoredIds(S.cuts, S.review).filter((cid) => restorable(S.edl.items, S.cuts.find((c) => c.id === cid)));
    S.working = workingEdl(S.edl, S.cuts, { restored, strikes: S.strikes, trims: S.trims, blades: S.blades });
    S.ps = pieces(S.working);
    S.changed = restored.length > 0 || S.strikes.length > 0 || S.trims.length > 0 || S.blades.length > 0;
  }

  // ------------------------------------------------------------------ saving
  function saveSoon(ms) { clearTimeout(saveTimer); saveTimer = setTimeout(() => flush(), ms); }
  function flush(leaving) {
    clearTimeout(saveTimer); saveTimer = null;
    if (S.cutsFrom !== 'api') { if (dirty.size || workingDirty) status('kept in this browser only: the server has no cuts route yet'); return; }
    for (const cid of [...dirty]) {
      const v = ver[cid], r = S.review[cid] || {};
      status('saving');
      app.api(`/api/cuts/${enc(id)}`, { cut: cid, keep: r.keep === undefined ? null : r.keep, note: r.note || '' })
        .then(() => { if (ver[cid] === v) dirty.delete(cid); if (!dirty.size && !workingDirty) status('saved'); })
        .catch(failed);
    }
    if (workingDirty) saveWorking(leaving);
  }
  function failed() { status('not saved yet, trying again'); clearTimeout(retryTimer); retryTimer = setTimeout(() => flush(), 3000); }
  function saveWorking(leaving) {
    clearTimeout(workTimer); workTimer = null;
    const body = { working: S.changed ? S.working : null };
    const mark = JSON.stringify(S.working.working);
    status('saving');
    const send = leaving
      ? fetch(`/api/cuts/${enc(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
      : app.api(`/api/cuts/${enc(id)}`, body);
    Promise.resolve(send).then(() => { if (JSON.stringify(S.working.working) === mark) workingDirty = false; if (!dirty.size && !workingDirty) status('saved'); }).catch(failed);
  }
  const workingSoon = () => { workingDirty = true; clearTimeout(workTimer); workTimer = setTimeout(() => flush(), 300); };
  const onLeave = () => { if (dirty.size || workingDirty) flushLeaving(); };
  function flushLeaving() {
    for (const cid of dirty) { const r = S.review[cid] || {}; fetch(`/api/cuts/${enc(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, keepalive: true, body: JSON.stringify({ cut: cid, keep: r.keep ?? null, note: r.note || '' }) }); }
    if (workingDirty) saveWorking(true);
  }
  addEventListener('pagehide', onLeave);

  // ------------------------------------------------------------------ changes
  const snapshot = () => ({ keeps: Object.fromEntries(Object.entries(S.review).filter(([, r]) => typeof r.keep === 'boolean').map(([k, r]) => [k, r.keep])), strikes: S.strikes.map((s) => [...s]),
    trims: S.trims.map((t) => ({ ...t })), blades: S.blades.map((b) => [...b]) });

  function setReview(cid, patch) {
    const e = { ...(S.review[cid] || {}), ...patch };
    if (e.keep == null) delete e.keep;
    if (!String(e.note || '').trim()) delete e.note;
    if (Object.keys(e).length) S.review[cid] = e; else delete S.review[cid];
    dirty.add(cid); ver[cid] = (ver[cid] || 0) + 1;
  }

  // keep: true (Keep), false (Restore), null (undecided); a second click on the same choice clears it
  function choose(cid, keep) {
    const was = S.review[cid]?.keep;
    hist = push(hist, snapshot());
    setReview(cid, { keep: was === keep ? null : keep });
    recompute(); emit('review');
    if ((was === false) !== (S.review[cid]?.keep === false)) { workingSoon(); emit('working'); }
    saveSoon(0);
  }
  function note(cid, text) { setReview(cid, { note: text }); emit('note'); saveSoon(400); }

  function strike(ranges, unstrikeFn) {
    if (!ranges.length) return;
    hist = push(hist, snapshot());
    S.strikes = unstrikeFn ? ranges.reduce((acc, [src, a, b]) => unstrikeFn(acc, src, a, b), S.strikes) : cleanStrikes([...S.strikes, ...ranges]);
    recompute(); workingSoon(); emit('working');
  }

  function apply(state) {
    const keeps = state.keeps || {};
    for (const cid of new Set([...Object.keys(keeps), ...Object.keys(S.review)])) {
      const want = cid in keeps ? keeps[cid] : null, have = S.review[cid]?.keep ?? null;
      if (want !== have) setReview(cid, { keep: want });
    }
    S.strikes = cleanStrikes(state.strikes); S.trims = cleanTrims(state.trims); S.blades = cleanBlades(state.blades);
    recompute(); workingSoon(); emit('review'); emit('working'); saveSoon(0);
  }

  // a timeline edit of the working list (trims, blades): fn(S) changes S.trims / S.blades; undo takes it back
  function editWorking(fn) {
    hist = push(hist, snapshot());
    fn(S);
    S.trims = cleanTrims(S.trims); S.blades = cleanBlades(S.blades);
    recompute(); workingSoon(); emit('working');
  }
  function undo() { const r = undoH(hist, snapshot()); if (!r.state) return false; hist = r.h; apply(r.state); return true; }
  function redo() { const r = redoH(hist, snapshot()); if (!r.state) return false; hist = r.h; apply(r.state); return true; }

  // start over from the engine's list: every strike and every Restore dropped (Keep and notes stay)
  function resetWorking() {
    hist = push(hist, snapshot());
    S.strikes = []; S.trims = []; S.blades = [];
    for (const [cid, r] of Object.entries(S.review)) if (r.keep === false) setReview(cid, { keep: null });
    recompute(); workingSoon(); emit('review'); emit('working'); saveSoon(0);
  }

  // the server said something changed
  const offs = [
    app.on('cuts', (m) => { if (!m.project || m.project === id) reloadCuts(); }),
    app.on('files', (m) => {
      if (m.project && m.project !== id) return;
      const paths = (m.paths || []).map((p) => String(p).replace(/\\/g, '/'));
      if (paths.some((p) => /out\/(edl\.json|rough-words\.json|events\.json)$/.test(p))) load();
      else if (paths.some((p) => /out\/(redactions|event-edits|review-items)\.json$/.test(p))) readEdits().then(() => emit('edits'));
      else if (paths.some((p) => /out\/cuts(-review)?\.json$/.test(p))) reloadCuts();
      else if (paths.some((p) => /work\/(proxy|peaks)\//.test(p))) loadProxy();
    }),
    app.on('proxy', (m) => { if ((!m.project || m.project === id) && m.state === 'ready') loadProxy(); }),
    app.on('review-items', (m) => { if ((!m.project || m.project === id) && !m.short) readEdits().then(() => emit('edits')); }),
  ];

  return {
    S, load, choose, note, strike, undo, redo, resetWorking, flush, clipUrl, editWorking, saveEdits,
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    restorable: (cid) => !!S.edl && restorable(S.edl.items, S.cuts.find((c) => c.id === cid)),
    media,
    dispose() { onLeave(); removeEventListener('pagehide', onLeave); offs.forEach((o) => o()); clearTimeout(saveTimer); clearTimeout(workTimer); clearTimeout(retryTimer); fns.clear(); },
  };
}
