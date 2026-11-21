// The styles of the timeline's and viewer's edit tools (the inspector, blur boxes, their panels), put in the page once by the modules
// that use them, so these parts carry their own look. Colours are the palette's variables (web/style/base.css).
const CSS = `
.timeline { position: relative; }
.tl-insp { position: absolute; z-index: 5; bottom: 8px; width: 330px; max-width: calc(100% - 16px); max-height: 70vh; overflow: auto; background: var(--ink); color: var(--cream);
  box-shadow: 0 0 0 var(--px) var(--outline), 0 6px 18px rgba(0,0,0,.45); padding: 8px 10px; font-size: 12px; opacity: 0; transform: translateY(4px);
  transition: opacity var(--ease), transform var(--ease); }
.tl-insp.in { opacity: 1; transform: none; }
.tl-insp h3 { margin: 0 0 6px; font: 600 13px var(--text); display: flex; gap: 6px; align-items: center; }
.tl-insp h3 .grow { flex: 1; }
.tl-insp label { display: grid; grid-template-columns: 64px 1fr auto; gap: 6px; align-items: center; margin: 4px 0; color: var(--lgrey); }
.tl-insp textarea { grid-column: 2 / 4; min-height: 38px; resize: vertical; }
.tl-insp input[type=number] { width: 90px; }
.tl-insp .note { color: var(--lblue); margin: 6px 0 4px; line-height: 1.35; }
.tl-insp .row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.tl-insp .row .grow { flex: 1; }
.tl-insp .state { color: var(--grey); font-size: 11px; }
.tl-tools { display: inline-flex; gap: 4px; margin-left: 6px; }
.v-boxes { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.v-boxes.drawing { pointer-events: auto; cursor: crosshair; }
.v-box { position: absolute; pointer-events: auto; cursor: move; box-sizing: border-box; outline: 1px dashed rgba(245,239,224,.85);
  -webkit-backdrop-filter: blur(9px); backdrop-filter: blur(9px); transition: outline-color var(--ease), opacity var(--ease); }
.v-box.pixelate { -webkit-backdrop-filter: blur(5px) contrast(1.4); backdrop-filter: blur(5px) contrast(1.4); }
.v-box.fill { background: #000; }
.v-box.off { opacity: .45; -webkit-backdrop-filter: none; backdrop-filter: none; outline-style: dotted; }
.v-box.sel { outline: 2px solid var(--yellow); }
.v-box .lbl { position: absolute; left: 0; top: -17px; font-size: 11px; white-space: nowrap; background: rgba(27,27,42,.8); color: var(--cream); padding: 0 4px; pointer-events: none; }
.v-box .hd { position: absolute; width: 9px; height: 9px; background: var(--yellow); box-shadow: 0 0 0 1px var(--outline); }
.v-box .hd.nw { left: -5px; top: -5px; cursor: nwse-resize; } .v-box .hd.se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.v-box .hd.ne { right: -5px; top: -5px; cursor: nesw-resize; } .v-box .hd.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
.v-draft { position: absolute; outline: 2px dashed var(--yellow); pointer-events: none; }
.v-boxpanel { position: absolute; left: 8px; bottom: 8px; z-index: 3; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; max-width: calc(100% - 16px);
  background: rgba(27,27,42,.92); color: var(--cream); padding: 5px 8px; font-size: 12px; box-shadow: 0 0 0 var(--px) var(--outline); }
.v-boxpanel[hidden] { display: none; }
.v-boxpanel .state { color: var(--grey); }
.viewer button.on.blurtool { background: var(--yellow); color: var(--ink); }
`;

let done = false;
export function ensureStyle() {
  if (done || typeof document === 'undefined') return;
  done = true;
  const s = document.createElement('style');
  s.dataset.from = 'timeline-style.js';
  s.textContent = CSS;
  document.head.append(s);
}
