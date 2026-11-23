// The "show" kit: pieces that point at, explain, count or compare something real on the screen. Shared by every template (copy this file
// next to components.tsx and spread SHOW into COMPONENTS). Same conventions as the templates: a transparent layer, ev.at / ev.end are seconds
// of the rough, ev.props is what the events file carries, and the frame is whatever size the cut is (1920x1080 long-form, 1080x1920 Shorts):
// every x, y, w, h in props is a pixel of the frame, read off a still of the footage at that moment, never guessed.
//
// Times inside props (`at`, `at2`) are ABSOLUTE seconds of the rough, like ev.at (so they can come straight from rough-words.json). Each piece
// enters and leaves with motion, then sits still between its moves, so the engine's still-hold draws the held stretches once. `avoid`
// ({x, y, w, h}, optional on every piece) is a rectangle that must stay clear, normally the face-cam corner: a piece that would cover it
// moves to the nearest free side of it (or, for Callout, puts its label on another side).
// Pieces: Callout, Spotlight, Inset, Flow, Compare, Stat, Steps, Scoreboard.
import React from "react";
import { AbsoluteFill, continueRender, delayRender, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import type { Ev } from "./pipeline/types";

const FONT = loadFont("normal", { weights: ["600", "800", "900"], subsets: ["latin"] });
const SANS = FONT.fontFamily;
// no frame is drawn before every weight is in (a tab's first frames would otherwise show the fallback face and move a pixel later, and the engine's still-hold would see a change)
const fontWait = delayRender("show kit: fonts");
FONT.waitUntilDone().then(() => continueRender(fontWait), () => continueRender(fontWait));
const K = { paper: "#fbfbf8", ink: "#14161c", accent: "#4f8cff", warm: "#ffb547", red: "#ff5a4f", green: "#37c887", dim: "rgba(10,12,16,0.82)", glass: "rgba(16,18,24,0.93)", mute: "rgba(20,22,28,0.45)" };
const SHADOW = "0 18px 50px rgba(0,0,0,.35)";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const easeOut = Easing.out(Easing.cubic);
type Rect = { x: number; y: number; w: number; h: number };
type Side = "left" | "right" | "top" | "bottom";

/** the clock and the frame: s scales text for a vertical frame (a Short is read on a phone, so it scales less than the width does) */
const useBox = () => {
  const f = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  return { f, fps, t: f / fps, W, H, s: W >= H ? 1 : 0.8 };
};
// a spring's last 0.1 % is snapped to its end value: a scale of 1.0000000002 makes Chrome re-draw text a pixel lower, and the still-hold sees a change
const pop = (f: number, fps: number, at: number) => {
  const v = spring({ frame: f - Math.round(at * fps), fps, config: { damping: 16, stiffness: 200 } });
  return Math.abs(v - 1) < 0.002 ? 1 : v;
};
const fadeIn = (t: number, at: number, d = 0.3) => interpolate(t, [at, at + d], [0, 1], { ...clamp, easing: ease });
const fadeOut = (t: number, end: number, d = 0.3) => interpolate(t, [end - d, end], [1, 0], { ...clamp, easing: ease });
const prog = (t: number, a: number, d: number) => interpolate(t, [a, a + d], [0, 1], { ...clamp, easing: ease });
const life = (t: number, ev: Ev, d = 0.3) => Math.min(fadeIn(t, ev.at, d), fadeOut(t, ev.end, d));

const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inside = (r: Rect, W: number, H: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
/** Move a box off a rectangle that must stay clear: the nearest free side of it that still fits in the frame. */
const dodge = (b: Rect, a: Rect | undefined, W: number, H: number, pad = 28): Rect => {
  if (!a || !hits(b, a)) return b;
  const c = [{ ...b, y: a.y - b.h - pad }, { ...b, y: a.y + a.h + pad }, { ...b, x: a.x - b.w - pad }, { ...b, x: a.x + a.w + pad }].filter((r) => inside(r, W, H));
  if (!c.length) return b;
  c.sort((p, q) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y) - (Math.abs(q.x - b.x) + Math.abs(q.y - b.y)));
  return c[0];
};

/** A paper card: the kit's look (paper, rounded, deep soft shadow, an accent bar on the left). */
const Card: React.FC<{ r: Rect; style?: React.CSSProperties; bar?: string | null; children?: React.ReactNode }> = ({ r, style, bar = K.accent, children }) => (
  <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, display: "flex", background: K.paper, borderRadius: 18, boxShadow: SHADOW, overflow: "hidden", fontFamily: SANS, color: K.ink, ...style }}>
    {bar ? <div style={{ width: 12, flex: "none", background: bar }} /> : null}
    <div style={{ flex: 1, minWidth: 0, position: "relative" }}>{children}</div>
  </div>
);

// ------------------------------------------------------------------------------------------------------------------------------ Callout

/** An arrow and a short label pointing at a point or a box on the screen: the box gets a rounded highlight (a ring round a point), the arrow
 *  draws on, then the label pops. Moves for the first 0.9 s only, then holds.
 *  props: {x, y, w?, h?, text, side?: "left"|"right"|"top"|"bottom" (where the label sits; default above, below near the top edge),
 *          color? ("#ff5a4f"), size? (42), avoid?: {x,y,w,h}}
 *  x, y: the point (when w and h are left out) or the top-left of the box, in frame pixels. */
const Callout: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { x: number; y: number; w?: number; h?: number; text: string; side?: Side; color?: string; size?: number; avoid?: Rect };
  const { text, color = K.red } = p;
  const size = (p.size ?? 42) * s;
  const box = p.w && p.h;
  const tb: Rect = box ? { x: p.x, y: p.y, w: p.w!, h: p.h! } : { x: p.x - 38, y: p.y - 38, w: 76, h: 76 };
  const cx = tb.x + tb.w / 2, cy = tb.y + tb.h / 2;
  const lw = Math.min(W - 80, text.length * size * 0.55 + 70), lh = size * 1.2 + 34, g = 130 * s;
  const place = (side: Side) => {
    let L: Rect, a: [number, number], e: [number, number];
    if (side === "top" || side === "bottom") {
      const lx = Math.max(40, Math.min(W - 40 - lw, cx - lw / 2));
      const ay = side === "top" ? tb.y - g : tb.y + tb.h + g;
      L = { x: lx, y: side === "top" ? ay - lh : ay, w: lw, h: lh };
      a = [Math.max(lx + 36, Math.min(lx + lw - 36, cx)), ay + (side === "top" ? 6 : -6)];
      e = [cx, side === "top" ? tb.y - 12 : tb.y + tb.h + 12];
    } else {
      const ax = side === "left" ? tb.x - g : tb.x + tb.w + g;
      L = { x: side === "left" ? ax - lw : ax, y: Math.max(30, Math.min(H - 30 - lh, cy - lh / 2)), w: lw, h: lh };
      a = [ax + (side === "left" ? 6 : -6), Math.max(L.y + 30, Math.min(L.y + lh - 30, cy))];
      e = [side === "left" ? tb.x - 12 : tb.x + tb.w + 12, cy];
    }
    return { L, a, e, side };
  };
  const first: Side = p.side ?? (tb.y > 300 ? "top" : "bottom");
  const opp: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const order: Side[] = [first, opp[first], "right", "left", "top", "bottom"];
  const ok = (o: ReturnType<typeof place>) => inside(o.L, W, H) && !(p.avoid && hits(o.L, p.avoid));
  const lay = order.map(place).find(ok) ?? place(first);
  const { L, a, e } = lay;
  // a gentle bow in the arrow
  const mx = (a[0] + e[0]) / 2, my = (a[1] + e[1]) / 2, dx = e[0] - a[0], dy = e[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const bow = 0.16 * len;
  const q: [number, number] = [mx - (dy / len) * bow, my + (dx / len) * bow];
  const ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
  const head = (da: number) => `${e[0] - 30 * Math.cos(ang + da)},${e[1] - 30 * Math.sin(ang + da)}`;
  const o = fadeOut(t, ev.end, 0.3);
  const ring = prog(t, ev.at, 0.45), arrow = prog(t, ev.at + 0.35, 0.4), hd = prog(t, ev.at + 0.7, 0.15), lab = pop(f, fps, ev.at + 0.7);
  const dashed = (v: number) => ({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - v });
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, filter: `drop-shadow(0 0 14px ${color}99)` }}>
        {box ? (
          <>
            <rect x={tb.x - 8} y={tb.y - 8} width={tb.w + 16} height={tb.h + 16} rx={16} fill={color} fillOpacity={0.1 * ring} />
            <rect x={tb.x - 8} y={tb.y - 8} width={tb.w + 16} height={tb.h + 16} rx={16} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" {...dashed(ring)} />
          </>
        ) : (
          <ellipse cx={cx} cy={cy} rx={36} ry={34} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" transform={`rotate(-6 ${cx} ${cy})`} {...dashed(ring)} />
        )}
        <path d={`M ${a[0]} ${a[1]} Q ${q[0]} ${q[1]} ${e[0]} ${e[1]}`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" {...dashed(arrow)} />
        <polyline points={`${head(-0.5)} ${e[0]},${e[1]} ${head(0.5)}`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={hd} />
      </svg>
      <Card r={L} bar={color} style={{ transform: `scale(${0.6 + 0.4 * lab})`, opacity: Math.min(1, lab * 1.6), transformOrigin: `${a[0] - L.x}px ${a[1] - L.y}px` }}>
        <div style={{ fontSize: size, fontWeight: 900, whiteSpace: "nowrap", padding: "0 30px 0 22px", lineHeight: 1.1, display: "flex", alignItems: "center", height: lh }}>{text}</div>
      </Card>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Spotlight

/** Dims everything except a box; the box edge glows softly. For "look here" on a busy screen. The dim closes in on the box in 0.5 s, then holds.
 *  props: {x, y, w, h, text? (a card under the box, above it when there is no room), dim? (0.72), radius? (18), avoid?: {x,y,w,h}} */
const Spotlight: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { x: number; y: number; w: number; h: number; text?: string; dim?: number; radius?: number; avoid?: Rect };
  const { text, dim = 0.72, radius = 18 } = p;
  const e = easeOut(interpolate(t, [ev.at, ev.at + 0.5], [0, 1], clamp));
  const o = life(t, ev, 0.35);
  const grow = (1 - e) * 110, x = p.x - grow, y = p.y - grow, w = p.w + 2 * grow, h = p.h + 2 * grow;
  const id = `spot-${ev.id}`;
  const size = 40 * s, lw = text ? Math.min(W - 80, text.length * size * 0.55 + 70) : 0, lh = size * 1.2 + 34;
  const below = p.y + p.h + 36 + lh < H - 20;
  let L: Rect = { x: Math.max(40, Math.min(W - 40 - lw, p.x + p.w / 2 - lw / 2)), y: below ? p.y + p.h + 36 : p.y - 36 - lh, w: lw, h: lh };
  L = dodge(L, p.avoid, W, H);
  const lab = pop(f, fps, ev.at + 0.45);
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <filter id={`${id}-b`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={9} /></filter>
          <mask id={id}>
            <rect width={W} height={H} fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={radius} fill="black" filter={`url(#${id}-b)`} />
          </mask>
        </defs>
        <rect width={W} height={H} fill={`rgba(6,8,12,${dim})`} mask={`url(#${id})`} />
        <rect x={x} y={y} width={w} height={h} rx={radius} fill="none" stroke="rgba(255,255,255,.9)" strokeWidth={3} style={{ filter: `drop-shadow(0 0 18px ${K.accent}) drop-shadow(0 0 6px ${K.accent})` }} />
      </svg>
      {text ? (
        <Card r={L} style={{ transform: `translateY(${(1 - lab) * (below ? -14 : 14)}px)`, opacity: Math.min(1, lab * 1.5) }}>
          <div style={{ fontSize: size, fontWeight: 900, whiteSpace: "nowrap", padding: "0 30px 0 22px", display: "flex", alignItems: "center", height: lh }}>{text}</div>
        </Card>
      ) : null}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Inset

/** A picture-in-picture: a still taken from the footage (or any image in remotion/public) in a framed card with a caption, sliding in from a side.
 *  props: {src: "moment.png", label? (the caption), w? (640), h? (w*9/16: the image is cropped to fit), x?, y? (top-left; default the top corner on `from`'s side),
 *          from?: "left"|"right" ("right"), avoid?: {x,y,w,h}} */
const Inset: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, W, H, s } = useBox();
  const p = ev.props as { src: string; label?: string; w?: number; h?: number; x?: number; y?: number; from?: "left" | "right"; avoid?: Rect };
  const from = p.from ?? "right";
  const w = Math.min(p.w ?? 640, W - 120), ih = p.h ?? Math.round((w * 9) / 16), cap = p.label ? 64 * s : 0;
  const pad = 12;
  const base: Rect = { x: p.x ?? (from === "right" ? W - w - 2 * pad - 80 : 80), y: p.y ?? 110, w: w + 2 * pad, h: ih + 2 * pad + cap };
  const r = dodge(base, p.avoid, W, H);
  const kx = easeOut(interpolate(t, [ev.at, ev.at + 0.45], [0, 1], clamp));
  const o = Math.min(fadeIn(t, ev.at, 0.3), fadeOut(t, ev.end, 0.3));
  const dir = from === "right" ? 1 : -1;
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, opacity: o, transform: `translateX(${(1 - kx) * 140 * dir}px)`, background: K.paper, borderRadius: 20, boxShadow: "0 22px 60px rgba(0,0,0,.45)", padding: pad, boxSizing: "border-box", fontFamily: SANS }}>
      <div style={{ width: w, height: ih, borderRadius: 12, overflow: "hidden", background: K.ink }}>
        <Img src={staticFile(p.src)} style={{ width: w, height: ih, objectFit: "cover" }} />
      </div>
      {p.label ? (
        <div style={{ height: cap, display: "flex", alignItems: "center", gap: 12, fontSize: 30 * s, fontWeight: 800, color: K.ink, padding: "0 6px" }}>
          <div style={{ width: 10, height: 28 * s, borderRadius: 5, background: K.accent }} />{p.label}
        </div>
      ) : null}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Flow

/** A diagram of boxes and arrows that builds up as it is said: each node pops in at its time, each arrow draws on at its time, the newest node is lit.
 *  props: {nodes: [{id, text, at}], edges?: [{from, to, at?, label?}] (default: each node to the next, at the next node's time; a "cycle" also closes),
 *          layout?: "row"|"column"|"cycle" (row in a wide frame, column in a vertical one), title?, x?, y?, w? (the panel's top-left and width),
 *          avoid?: {x,y,w,h}}
 *  `at` is in seconds of the rough. */
type FNode = { id: string; text: string; at: number };
type FEdge = { from: string; to: string; at?: number; label?: string };
const Flow: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { nodes: FNode[]; edges?: FEdge[]; layout?: "row" | "column" | "cycle"; title?: string; x?: number; y?: number; w?: number; avoid?: Rect };
  const nodes = p.nodes, n = nodes.length;
  const layout = p.layout ?? (W >= H ? "row" : "column");
  const pad = 44, head = p.title ? 84 * s : 0;
  const pw = Math.min(p.w ?? (layout === "cycle" ? 1100 : layout === "row" ? 1700 : 760), W - 100);
  let ph: number, nw: number, nh: number;
  const pos: Record<string, Rect> = {};
  if (layout === "row") {
    const gap = Math.max(p.edges?.some((d) => d.label) ? 150 : 70, Math.min(110, ((pw - 2 * pad) / n) * 0.34));
    nw = Math.min(330, (pw - 2 * pad - (n - 1) * gap) / n); nh = 150 * s; ph = nh + 2 * pad + head;
    const used = n * nw + (n - 1) * gap; // centre the row
    nodes.forEach((d, i) => (pos[d.id] = { x: pad + (pw - 2 * pad - used) / 2 + i * (nw + gap), y: head + pad, w: nw, h: nh }));
  } else if (layout === "column") {
    nh = 100 * s; nw = Math.min(pw - 2 * pad, 640);
    const gap = Math.max(34, Math.min(80, (H - 200 - head - 2 * pad - n * nh) / Math.max(1, n - 1)));
    ph = n * nh + (n - 1) * gap + 2 * pad + head;
    nodes.forEach((d, i) => (pos[d.id] = { x: (pw - nw) / 2, y: head + pad + i * (nh + gap), w: nw, h: nh }));
  } else {
    nw = 290 * s; nh = 104 * s; ph = Math.min(H - 160, pw * 0.72) + head;
    const rx = (pw - nw) / 2 - pad, ry = (ph - head - nh) / 2 - pad;
    nodes.forEach((d, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pos[d.id] = { x: pw / 2 + rx * Math.cos(a) - nw / 2, y: head + (ph - head) / 2 + ry * Math.sin(a) - nh / 2, w: nw, h: nh };
    });
  }
  const edges: FEdge[] = p.edges ?? nodes.slice(1).map((d, i) => ({ from: nodes[i].id, to: d.id })).concat(layout === "cycle" && n > 2 ? [{ from: nodes[n - 1].id, to: nodes[0].id }] : []);
  const base: Rect = { x: p.x ?? (W - pw) / 2, y: p.y ?? (H - ph) / 2, w: pw, h: ph };
  const R = dodge(base, p.avoid, W, H);
  const o = life(t, ev, 0.35);
  const sorted = [...nodes].sort((a, b) => a.at - b.at);
  const byId = Object.fromEntries(nodes.map((d) => [d.id, d]));
  const enter = easeOut(interpolate(t, [ev.at, ev.at + 0.4], [0, 1], clamp));
  const edgeAt = (d: FEdge) => d.at ?? byId[d.to]?.at ?? ev.at;
  return (
    <div style={{ position: "absolute", left: R.x, top: R.y, width: R.w, height: R.h, opacity: o, transform: `translateY(${(1 - enter) * 30}px)`, background: K.glass, borderRadius: 26, boxShadow: "0 26px 80px rgba(0,0,0,.5)", border: "1px solid rgba(255,255,255,.09)", fontFamily: SANS }}>
      {p.title ? <div style={{ position: "absolute", left: pad, top: 26 * s, fontSize: 30 * s, fontWeight: 800, letterSpacing: 3, color: K.accent, textTransform: "uppercase" }}>{p.title}</div> : null}
      <svg width={R.w} height={R.h} style={{ position: "absolute", left: 0, top: 0 }}>
        {edges.map((d, i) => {
          const A = pos[d.from], B = pos[d.to];
          if (!A || !B) return null;
          const ca = [A.x + A.w / 2, A.y + A.h / 2], cb = [B.x + B.w / 2, B.y + B.h / 2];
          const dx = cb[0] - ca[0], dy = cb[1] - ca[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
          const reach = (Z: Rect, gap: number) => Math.min(Math.abs(ux) > 1e-6 ? Z.w / 2 / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-6 ? Z.h / 2 / Math.abs(uy) : 1e9) + gap;
          const a = [ca[0] + ux * reach(A, 12), ca[1] + uy * reach(A, 12)], e = [cb[0] - ux * reach(B, 14), cb[1] - uy * reach(B, 14)];
          const at = edgeAt(d), v = prog(t, at, 0.4), hd = prog(t, at + 0.3, 0.12), th = Math.atan2(uy, ux);
          const hx = (da: number) => `${e[0] - 22 * Math.cos(th + da)},${e[1] - 22 * Math.sin(th + da)}`;
          return (
            <g key={i}>
              <line x1={a[0]} y1={a[1]} x2={e[0]} y2={e[1]} stroke={K.accent} strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - v} />
              <polyline points={`${hx(-0.5)} ${e[0]},${e[1]} ${hx(0.5)}`} fill="none" stroke={K.accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={hd} />
            </g>
          );
        })}
      </svg>
      {edges.map((d, i) => {
        const A = pos[d.from], B = pos[d.to];
        if (!A || !B || !d.label) return null;
        return <div key={i} style={{ position: "absolute", left: (A.x + A.w / 2 + B.x + B.w / 2) / 2, top: (A.y + A.h / 2 + B.y + B.h / 2) / 2, transform: "translate(-50%,-50%)", opacity: fadeIn(t, edgeAt(d) + 0.25, 0.25), background: K.ink, border: `2px solid ${K.accent}`, color: "white", borderRadius: 999, padding: "4px 16px", fontSize: 24 * s, fontWeight: 800, whiteSpace: "nowrap" }}>{d.label}</div>;
      })}
      {nodes.map((d) => {
        const r = pos[d.id], k = pop(f, fps, d.at);
        const next = sorted.find((x) => x.at > d.at)?.at;
        // lit from its own arrival until the next node arrives, eased over 0.3 s
        const hot = fadeIn(t, d.at, 0.3) * (next === undefined ? 1 : 1 - prog(t, next, 0.3));
        return (
          <div key={d.id} style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, opacity: Math.min(1, k * 1.6), transform: `scale(${0.7 + 0.3 * k})`, borderRadius: 18, boxSizing: "border-box", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontWeight: 900, fontSize: (layout === "row" ? 32 : 42) * s, lineHeight: 1.12, background: hot > 0.5 ? K.accent : K.paper, color: hot > 0.5 ? "white" : K.ink, boxShadow: hot > 0.5 ? "0 0 0 4px rgba(79,140,255,.35), 0 10px 30px rgba(0,0,0,.4)" : "0 10px 30px rgba(0,0,0,.4)" }}>{d.text}</div>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Compare

/** Two sides, before/after or A versus B, on a dimmed picture: the left card arrives with the event, the right one at `at2`.
 *  props: {left: {title, src?, lines?}, right: {title, src?, lines?}, at2? (seconds of the rough; default 40% into the event), vs? ("VS"; "" for none),
 *          colors? ["#ffb547", "#4f8cff"], avoid?: {x,y,w,h}}
 *  src: an image in remotion/public; lines: short facts under it (3 at most read well). A wide frame puts the cards side by side, a vertical one stacks them. */
type Side2 = { title: string; src?: string; lines?: string[] };
const Compare: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { left: Side2; right: Side2; at2?: number; vs?: string; colors?: [string, string]; avoid?: Rect };
  const at2 = p.at2 ?? ev.at + (ev.end - ev.at) * 0.4;
  const cols = p.colors ?? [K.warm, K.accent];
  const wide = W >= H, gap = wide ? 110 : 56, m = wide ? 90 : 50;
  const cw = wide ? (W - 2 * m - gap) / 2 : W - 2 * m, maxH = wide ? H - 200 : (H - 2 * m - gap - 380) / 2;
  const sides = [p.left, p.right];
  // the card is as tall as its content: header, a 16:9 picture (cut down to fit), and the lines
  const nLines = Math.max(...sides.map((d) => d.lines?.length ?? 0)), hasImg = sides.some((d) => d.src);
  const headH = 92 * s, linesH = nLines ? 44 * s + nLines * (hasImg ? 58 : 84) * s : 0;
  const imgH = hasImg ? Math.min(cw * 0.5625, maxH - headH - linesH) : 0;
  const chh = Math.min(maxH, headH + imgH + Math.max(linesH, hasImg ? 0 : 200));
  const rects: Rect[] = [0, 1].map((i) => ({ x: wide ? m + i * (cw + gap) : m, y: wide ? (H - chh) / 2 : 200 + i * (chh + gap), w: cw, h: chh }));
  const times = [ev.at + 0.1, at2];
  const o = life(t, ev, 0.3);
  const vs = p.vs ?? "VS", v = pop(f, fps, at2 + 0.2);
  const c = wide ? [W / 2, H / 2] : [W / 2, rects[0].y + rects[0].h + gap / 2];
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ background: K.dim, opacity: fadeIn(t, ev.at, 0.3) }} />
      {sides.map((sd, i) => {
        const r = dodge(rects[i], p.avoid, W, H), k = easeOut(interpolate(t, [times[i], times[i] + 0.5], [0, 1], clamp));
        const dirx = wide ? (i ? 1 : -1) * 90 : 0, diry = wide ? 0 : (i ? 1 : -1) * 70;
        return (
          <div key={i} style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, opacity: k, transform: `translate(${(1 - k) * dirx}px, ${(1 - k) * diry}px)`, background: K.paper, borderRadius: 24, boxShadow: "0 26px 80px rgba(0,0,0,.55)", overflow: "hidden", fontFamily: SANS, color: K.ink, display: "flex", flexDirection: "column" }}>
            <div style={{ background: cols[i], height: headH, boxSizing: "border-box", display: "flex", alignItems: "center", padding: "0 32px", fontSize: 46 * s, fontWeight: 900, color: cols[i] === K.warm ? K.ink : "white", letterSpacing: 1, flex: "none" }}>{sd.title}</div>
            {sd.src ? <div style={{ height: imgH, flex: "none", background: K.ink }}><Img src={staticFile(sd.src)} style={{ width: "100%", height: imgH, objectFit: "cover" }} /></div> : null}
            {sd.lines?.length ? (
              <div style={{ padding: `${22 * s}px 32px 0`, display: "flex", flexDirection: "column", gap: 12 * s, justifyContent: hasImg ? "flex-start" : "center", flex: 1 }}>
                {sd.lines.map((l, j) => (
                  <div key={j} style={{ display: "flex", gap: 16, alignItems: "baseline", fontSize: (hasImg ? 34 : 50) * s, fontWeight: 800, lineHeight: 1.15, opacity: fadeIn(t, times[i] + 0.35 + j * 0.15, 0.3) }}>
                    <div style={{ width: 14, height: 14, borderRadius: 7, background: cols[i], flex: "none", transform: "translateY(-4px)" }} />{l}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {vs !== "" ? (
        <div style={{ position: "absolute", left: c[0], top: c[1], width: 108, height: 108, marginLeft: -54, marginTop: -54, borderRadius: 54, background: K.ink, border: "5px solid white", color: "white", fontFamily: SANS, fontWeight: 900, fontSize: 40, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SHADOW, transform: `scale(${v})`, opacity: Math.min(1, v * 1.5) }}>{vs}</div>
      ) : null}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Stat

/** One real number counting up to its value (1.4 s, then still), with a unit and a short label. Only for a number that is said or shown.
 *  props: {value: 12480, unit? ("%", "x", "ms"), label: "games played", from? (0), decimals? (0), x?, y? (top-left; default top right, top centre in a Short),
 *          color? ("#4f8cff"), avoid?: {x,y,w,h}} */
const Stat: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { value: number; unit?: string; label: string; from?: number; decimals?: number; x?: number; y?: number; color?: string; avoid?: Rect };
  const { value, unit = "", label, from = 0, decimals = 0, color = K.accent } = p;
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const num = 124 * s, w = Math.min(W - 100, Math.max(460, (fmt(value).length + unit.length * 0.7) * num * 0.6 + 110)), h = num * 1.1 + 96 * s;
  const base: Rect = { x: p.x ?? (W >= H ? W - w - 96 : (W - w) / 2), y: p.y ?? 110, w, h };
  const r = dodge(base, p.avoid, W, H);
  const cur = from + (value - from) * easeOut(interpolate(t, [ev.at + 0.2, ev.at + 1.6], [0, 1], clamp));
  const k = pop(f, fps, ev.at), o = Math.min(1, k * 1.5, fadeOut(t, ev.end, 0.3));
  return (
    <Card r={r} bar={color} style={{ opacity: o, transform: `translateY(${(1 - k) * 30}px) scale(${0.92 + 0.08 * k})` }}>
      <div style={{ position: "absolute", left: 30, top: 10 * s, display: "flex", alignItems: "baseline", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        <span style={{ fontSize: num, fontWeight: 900, lineHeight: 1.1, letterSpacing: -2 }}>{fmt(cur)}</span>
        {unit ? <span style={{ fontSize: num * 0.48, fontWeight: 900, color, marginLeft: 10 }}>{unit}</span> : null}
      </div>
      <div style={{ position: "absolute", left: 32, bottom: 20 * s, fontSize: 30 * s, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase", color: K.mute, opacity: fadeIn(t, ev.at + 0.3, 0.3), whiteSpace: "nowrap" }}>{label}</div>
    </Card>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Steps

/** A checklist that ticks item by item as each is said: the whole list is there from the start, each item lights up and gets its tick at its time.
 *  props: {title?, items: [{text, at}] (seconds of the rough), x?, y? (top-left; default top left), w? (fits the longest item), avoid?: {x,y,w,h}} */
const Steps: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { title?: string; items: { text: string; at: number }[]; x?: number; y?: number; w?: number; avoid?: Rect };
  const rowH = 88 * s, head = p.title ? 62 * s : 0, pad = 28;
  const w = Math.min(p.w ?? Math.max(...p.items.map((i) => i.text.length)) * 40 * s * 0.6 + 170, W - 100), h = head + p.items.length * rowH + pad * 2 - 6;
  const r = dodge({ x: p.x ?? (W >= H ? 96 : 50), y: p.y ?? 110, w, h }, p.avoid, W, H);
  const k = pop(f, fps, ev.at), o = Math.min(1, k * 1.5, fadeOut(t, ev.end, 0.3));
  return (
    <Card r={r} style={{ opacity: o, transform: `translateX(${(1 - k) * -50}px)` }}>
      {p.title ? <div style={{ position: "absolute", left: 30, top: 24 * s, fontSize: 30 * s, fontWeight: 800, letterSpacing: 3, color: K.accent, textTransform: "uppercase" }}>{p.title}</div> : null}
      {p.items.map((it, i) => {
        const d = prog(t, it.at, 0.35), b = pop(f, fps, it.at), top = pad + head + i * rowH;
        return (
          <div key={i} style={{ position: "absolute", left: 28, right: 24, top, height: rowH, display: "flex", alignItems: "center", gap: 22 * s }}>
            <div style={{ width: 50 * s, height: 50 * s, flex: "none", borderRadius: 14 * s, boxSizing: "border-box", border: `4px solid ${d > 0.5 ? K.green : "rgba(20,22,28,.22)"}`, background: d > 0.5 ? K.green : "transparent", transform: `scale(${d > 0 ? 0.85 + 0.15 * b : 1})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={30 * s} height={30 * s} viewBox="0 0 30 30"><path d="M5 16 L12 23 L25 7" fill="none" stroke="white" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - d} /></svg>
            </div>
            <div style={{ fontSize: 40 * s, fontWeight: 800, color: K.ink, opacity: 0.38 + 0.62 * d, whiteSpace: "nowrap", lineHeight: 1.1 }}>{it.text}</div>
          </div>
        );
      })}
    </Card>
  );
};

// ------------------------------------------------------------------------------------------------------------------------------ Scoreboard

/** Two or more named rows with a score that changes at given times (a match, a race, an A/B test). Bars grow to the share of the biggest score;
 *  the leader is lit. A score eases to its next value over 0.6 s.
 *  props: {rows: [{name, score: [[at, value], ...]}] (seconds of the rough, the value from that time on), title?, max? (the full bar; default the biggest score in any row),
 *          decimals? (0), unit? (""), x?, y? (top-left; default top right), w? (700), colors?: [...], avoid?: {x,y,w,h}} */
const Scoreboard: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, W, H, s } = useBox();
  const p = ev.props as { rows: { name: string; score: [number, number][] }[]; title?: string; max?: number; decimals?: number; unit?: string; x?: number; y?: number; w?: number; colors?: string[]; avoid?: Rect };
  const { rows, decimals = 0, unit = "" } = p;
  const cols = p.colors ?? [K.accent, K.warm, K.red, K.green];
  const valueAt = (r: { score: [number, number][] }) => {
    let v = 0, prev = 0, last = -1e9;
    for (const [at, val] of r.score) if (t >= at) { prev = v; v = val; last = at; }
    const m = easeOut(interpolate(t, [last, last + 0.6], [0, 1], clamp));
    return { shown: prev + (v - prev) * m, final: v, last };
  };
  const vals = rows.map(valueAt);
  const top = Math.max(1e-9, p.max ?? Math.max(...rows.flatMap((r) => r.score.map((x) => x[1])), 1));
  const lead = Math.max(...vals.map((v) => v.final));
  const rowH = 104 * s, head = p.title ? 62 * s : 0, pad = 26;
  const w = Math.min(p.w ?? 700, W - 100), h = head + rows.length * rowH + pad * 2 - 18;
  const r = dodge({ x: p.x ?? (W >= H ? W - w - 96 : (W - w) / 2), y: p.y ?? 110, w, h }, p.avoid, W, H);
  const k = pop(f, fps, ev.at), o = Math.min(1, k * 1.5, fadeOut(t, ev.end, 0.3));
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const barW = w - 12 - 2 * 30;
  return (
    <Card r={r} style={{ opacity: o, transform: `translateY(${(1 - k) * -30}px)` }}>
      {p.title ? <div style={{ position: "absolute", left: 30, top: 22 * s, fontSize: 30 * s, fontWeight: 800, letterSpacing: 3, color: K.accent, textTransform: "uppercase" }}>{p.title}</div> : null}
      {rows.map((row, i) => {
        const v = vals[i], c = cols[i % cols.length], isLead = v.final === lead && lead > 0;
        const bump = 1 + 0.12 * Math.max(0, 1 - (t - v.last) / 0.4) * (t >= v.last ? 1 : 0);
        return (
          <div key={i} style={{ position: "absolute", left: 30, right: 30, top: pad + head + i * rowH, height: rowH }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", height: 50 * s }}>
              <div style={{ fontSize: 36 * s, fontWeight: 900, whiteSpace: "nowrap", opacity: isLead ? 1 : 0.7 }}>{row.name}</div>
              <div style={{ fontSize: 46 * s, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: isLead ? c : K.ink, transform: `scale(${bump})`, transformOrigin: "right center" }}>{fmt(v.shown)}{unit}</div>
            </div>
            <div style={{ height: 20 * s, borderRadius: 10 * s, background: "rgba(20,22,28,.10)", overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: Math.min(1, v.shown / top) * barW, height: "100%", borderRadius: 10 * s, background: c, opacity: isLead ? 1 : 0.55 }} />
            </div>
          </div>
        );
      })}
    </Card>
  );
};

/** What the templates spread into their COMPONENTS. */
export const SHOW: Record<string, React.FC<{ ev: Ev }>> = { Callout, Spotlight, Inset, Flow, Compare, Stat, Steps, Scoreboard };
