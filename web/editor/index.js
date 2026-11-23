// The Edit tab: laid out like a video editor. Left the media bin and the transcript, centre the viewer, right the
// Cuts list and the agent, bottom the timeline; every bar between them drags. Keys are data in keys.json (the Cuts
// list's scope wins while it is the active panel; a focused text box keeps its keys).
import { editorState } from '../shell/save-state.js';
import { h, icon, button } from '../shell/dom.js';
import { split, restoreSizes } from '../shell/split.js';
import { createStore } from './store.js';
import { createViewer } from './viewer.js';
import { createTimeline } from './timeline.js';
import { createTranscript } from './transcript.js';
import { createCutsList } from './cuts-list.js';
import { createAgentPanel } from './agent-panel.js';
import { createMediaBin } from './media-bin.js';
import { createLiveLine } from './live-line.js';
import { comboOf, actionFor, ownsKeys } from './keys.js';
import { stepCut, notesWithChoices } from './cuts-order.js';
import { editRangeStrikes } from './edl-edit.js';
import { toEdit } from './edl-map.js';

const SIZES = { left: 300, right: 380, tl: 270, bin: 120, agent: 220 };
const SNAP = 'presence.snap';

const panel = (cls, ic, title, ...extra) => {
  const body = h('div.panel-body');
  const el = h(`section.panel.${cls}`, h('header.panel-head', icon(ic, true), h('h2', title), h('div.grow'), ...extra), body);
  return { el, body };
};

export async function mount(root, app) {
  const p = app.project();
  if (!p) {
    root.replaceChildren(h('div.ed-none', icon('film'), h('h2', 'No project open'), h('p.muted', 'Pick a project at the top, or start a new one.')));
    return {};
  }
  const keys = await fetch('/editor/keys.json').then((r) => r.json()).catch(() => ({ scopes: {} }));
  const store = createStore(app, p.id);
  const S = store.S;

  // ------------------------------------------------------------------ ui state shared by the panels
  let curCut = null, snap = localStorage.getItem(SNAP) !== '0';
  const ui = {
    muted: false, marks: { in: null, out: null }, scope: 'editor',
    get snap() { return snap; },
    time: () => viewer.t,
    toast: (t, k) => app.toast(t, k),
    onTime(info) { timeline.follow(info.t); transcript.onTime(info); },
    seek: (t, o) => viewer.seek(t, o),
    seekSource: (src, s) => viewer.seekSource(src, s),
    currentCut: () => S.cuts.find((c) => c.id === curCut) || null,
    selectCut(id, o = {}) {
      curCut = id; cutsList.reveal(id); timeline.draw();
      const c = ui.currentCut();
      if (c && o.seek) {
        const back = S.review[c.id]?.keep === false && store.restorable(c.id);
        const at = toEdit(S.ps, c.src, back ? Number(c.from) : Number(c.to)) ?? Number(c.at);
        viewer.seek(Math.max(0, at - (o.lead ?? 1)), { play: !!o.play });
      }
    },
    restoreCut: (id) => cutsList.restore(id),
    selectBox: (id) => viewer.boxes.pick(id),               // a blur box picked on V2 (viewer-redact.js)
    selectedBox: () => viewer.boxes.picked,
    boxesChanged: () => timeline.draw(),
    setScope(s) { ui.scope = s; root.querySelector('.ed')?.setAttribute('data-scope', s); },
    act: (name) => act(name),
  };

  // ------------------------------------------------------------------ the panels
  const viewer = createViewer(store, ui);
  const timeline = createTimeline(store, ui);
  const transcript = createTranscript(store, ui);
  const cutsList = createCutsList(store, ui);
  const agent = createAgentPanel(app, p.id);
  const bin = createMediaBin(app, store, ui);

  const P = {
    bin: panel('p-bin', 'folder', 'Media'),
    tr: panel('p-tr', 'text', 'Transcript'),
    view: panel('p-view', 'film', 'Viewer'),
    cuts: panel('p-cuts', 'scissors', 'Cuts', h('span.dim.cut-keys', '↑↓ move · C keep cut · R restore words')),
    agent: panel('p-agent', 'agent', 'Agent'),
    tl: panel('p-tl', 'film', 'Timeline'),
  };
  P.bin.body.append(bin.el); P.tr.body.append(transcript.el); P.view.body.append(viewer.el);
  P.cuts.body.append(cutsList.el); P.agent.body.append(agent.el); P.tl.body.append(timeline.el);
  const bars = { left: h('div'), right: h('div'), tl: h('div'), bin: h('div'), agent: h('div') };
  const left = h('div.ed-left', P.bin.el, bars.bin, P.tr.el);
  const right = h('div.ed-right', P.cuts.el, bars.agent, P.agent.el);
  const ed = h('div.ed', { 'data-scope': 'editor' }, left, bars.left, P.view.el, bars.right, right, bars.tl, P.tl.el);
  const stale = h('div.ed-stale', { hidden: true });
  const liveLine = createLiveLine(app, p.id);
  root.replaceChildren(stale, liveLine.el, ed);
  app.hooks.watch = () => viewer.watchResult();
  restoreSizes(ed, SIZES);
  const redraw = () => timeline.draw();
  split(bars.left, { host: ed, name: 'left', axis: 'x', min: 200, max: 700, onMove: redraw });
  split(bars.right, { host: ed, name: 'right', axis: 'x', min: 260, max: 800, invert: true, onMove: redraw });
  split(bars.tl, { host: ed, name: 'tl', axis: 'y', min: 150, max: 600, invert: true, onMove: redraw });
  split(bars.bin, { host: ed, name: 'bin', axis: 'y', min: 60, max: 600 });
  split(bars.agent, { host: ed, name: 'agent', axis: 'y', min: 120, max: 900, invert: true });
  bin.dropZone(root);
  for (const el of [P.view.el, P.tl.el, P.tr.el, P.bin.el]) el.addEventListener('pointerdown', () => ui.setScope('editor'));
  timeline.paintSnap();

  // the send-back notes carry the cut choices; the stage bar asks through app.hooks
  app.hooks.notes = (typed) => notesWithChoices(typed, S.cuts, S.review, S.strikes);
  app.hooks.flush = () => store.flush();

  // ------------------------------------------------------------------ data
  store.on(({ what }) => {
    if (what === 'saved') { cutsList.saved(S.saveState); app.save?.report('editor', editorState(S.saveState, S.editsState), S.saveState); viewer.boxes.paint(); return; }
    if (what === 'edits') { timeline.rebuild(); viewer.boxes.paint(true); return; }
    if (what === 'note') { cutsList.paint(); return; }
    if (what === 'all') {
      stale.hidden = !S.staleWorking;
      stale.replaceChildren(icon('question', true), h('span', 'Your earlier strikes were made on an older rough, so they are not applied to this one.'));
      cutsList.render(); transcript.render(); timeline.rebuild(); viewer.refresh(); bin.render();
      return;
    }
    if (what === 'review') { cutsList.paint(); }
    if (what === 'working' || what === 'review') { transcript.render(); timeline.rebuild(); }
    if (what === 'working') viewer.refresh();
    if (what === 'proxy') { viewer.refresh(); timeline.draw(); }
  });
  store.load();

  // ------------------------------------------------------------------ actions
  const order = () => cutsList.order();
  function act(name) {
    const c = ui.currentCut();
    switch (name) {
      case 'playPause': viewer.toggle(); break;
      case 'pause': viewer.pause(); break;
      case 'shuttleForward': viewer.shuttle(1); break;
      case 'shuttleBack': viewer.shuttle(-1); break;
      case 'frameBack': viewer.step(-1); break;
      case 'frameForward': viewer.step(1); break;
      case 'secondBack': viewer.step(-(S.fps || 30)); break;
      case 'secondForward': viewer.step(S.fps || 30); break;
      case 'toStart': viewer.seek(0); break;
      case 'toEnd': viewer.seek(S.ps.length ? S.ps[S.ps.length - 1].end : 0); break;
      case 'markIn': if (viewer.boxes.mark('in')) break; ui.marks.in = viewer.t; timeline.paintIO(); break;   // a picked blur box takes I and O
      case 'markOut': if (viewer.boxes.mark('out')) break; ui.marks.out = viewer.t; timeline.paintIO(); break;
      case 'rippleDelete': timeline.ripple(); break;
      case 'blade': timeline.blade(); break;
      case 'trimBack': timeline.nudge(-1); break;
      case 'trimForward': timeline.nudge(1); break;
      case 'cancelBox': if (!viewer.boxes.cancel()) timeline.inspector.close(); break;
      case 'clearMarks': ui.marks = { in: null, out: null }; timeline.paintIO(); break;
      case 'prevCut': case 'nextCut': {
        const n = stepCut(order(), curCut, name === 'nextCut' ? 1 : -1);
        if (n) { ui.setScope('cuts'); ui.selectCut(n.id, { seek: true }); }
        break;
      }
      case 'keep': if (c) cutsList.keep(c.id); break;
      case 'restore': if (c) cutsList.restore(c.id); else app.toast('Pick a cut first (↑ ↓ or click one).'); break;
      case 'note': if (c) cutsList.note(c.id); break;
      case 'playCut': if (c) cutsList.play(c.id); break;
      case 'beforeAfter': viewer.setMode(viewer.mode === 'before' ? 'after' : 'before'); break;
      case 'strikeSelection': {
        if (transcript.hasSelection()) { transcript.strikeSel(); break; }
        if (viewer.boxes.picked && viewer.boxes.remove()) break;
        const { in: a, out: b } = ui.marks;
        if (a != null && b != null && Math.abs(b - a) > 0.05) {
          const r = editRangeStrikes(S.ps, a, b);
          if (r.length) { store.strike(r); ui.marks = { in: null, out: null }; timeline.paintIO(); app.toast('Cut from In to Out (Ctrl+Z undoes).'); }
        } else app.toast('Select words in the transcript, or mark In (I) and Out (O), then Delete.');
        break;
      }
      case 'zoomIn': timeline.zoomBy(1.5); break;
      case 'zoomOut': timeline.zoomBy(1 / 1.5); break;
      case 'zoomFit': timeline.fit(); break;
      case 'toggleSnap': snap = !snap; try { localStorage.setItem(SNAP, snap ? '1' : '0'); } catch {} timeline.paintSnap(); break;
      case 'undo': if (!store.undo()) app.toast('Nothing to undo.'); break;
      case 'redo': if (!store.redo()) app.toast('Nothing to redo.'); break;
      case 'resetWorking': store.resetWorking(); app.toast('Back to the agent’s edit list (Ctrl+Z undoes).'); break;
      case 'rebuild': rebuild(); break;
      default: return false;
    }
    return true;
  }
  async function rebuild() {
    store.flush();
    if (!confirm('Ask the agent to build the rough from your working edit list (video/out/edl.working.json)? This is an agent turn: it takes time and uses your Claude plan.')) return;
    try {
      await app.api(`/api/projects/${encodeURIComponent(p.id)}/say`, { text: 'Rebuild the rough from video/out/edl.working.json: it is edl.json with my choices applied (cuts I restored, words I struck). Make it the new video/out/edl.json, then delete video/out/rough.json (build_rough.py refuses while a handed-over rough is there), build out/rough.mp4 from it in the background, and run handover.py again so rough.json and cuts.json are fresh.' });
      app.toast('Asked the agent to rebuild the rough.', 'ok');
    } catch (e) { app.toast('Could not ask: ' + e.message, 'error'); }
  }

  if (window.presence) window.presence.editor = { store, viewer, timeline, ui }; // for the console

  // ------------------------------------------------------------------ keys
  const onKey = (e) => {
    if (!root.isConnected || root.closest('[hidden]')) return;
    if (ownsKeys(e.target) || e.altKey) return;
    if (e.target?.closest?.('.popover')) return;
    const name = actionFor(keys, comboOf(e), ui.scope);
    if (!name) return;
    if (name === 'playPause' && e.target?.tagName === 'BUTTON') e.target.blur();
    if (act(name) !== false) { e.preventDefault(); e.stopPropagation(); }
  };
  addEventListener('keydown', onKey, true);

  return {
    unmount() {
      removeEventListener('keydown', onKey, true);
      liveLine.dispose(); delete app.hooks.watch; timeline.inspector.flush(); store.flush(); store.dispose(); viewer.dispose(); agent.dispose(); bin.dispose(); transcript.dispose();
      if (app.hooks.notes) { delete app.hooks.notes; delete app.hooks.flush; }
    },
  };
}
