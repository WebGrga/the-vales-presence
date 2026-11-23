// longform-clean: the overlay pieces of a long video (1920x1080). A transparent layer with no base video: the engine renders only the
// stretches where one of these is on screen. Punch-ins (ffmpeg) and captions (ASS) are not drawn here.
// Pieces of the show kit (./show, copied from kit/show/show.tsx): Callout, Spotlight, Inset, Flow, Compare, Stat, Steps, Scoreboard.
// Pieces: Label (a lower-third card), Chapter (a numbered title card), Bars (a bar chart with values), Picture (an image from
// remotion/public with rings drawn round parts of it), End (two slots for the end-screen elements).
// ev.at / ev.end are seconds of the rough; ev.props is what make_overlays.py put in the event.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import type { Ev } from "./pipeline/types";
import { SHOW } from "./show";

const SANS = loadFont("normal", { weights: ["600", "800", "900"], subsets: ["latin"] }).fontFamily;
export const C = { paper: "#fbfbf8", ink: "#14161c", accent: "#4f8cff", warm: "#ffb547", red: "#ff5a4f", dim: "rgba(10,12,16,0.82)" };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return { f, fps, t: f / fps }; };
const pop = (f: number, fps: number, at: number) => spring({ frame: f - Math.round(at * fps), fps, config: { damping: 16, stiffness: 200 } });
const fadeIn = (t: number, at: number, d = 0.25) => interpolate(t, [at, at + d], [0, 1], { ...clamp, easing: ease });
const fadeOut = (t: number, end: number, d = 0.25) => interpolate(t, [end - d, end], [1, 0], clamp);

/** A lower-third card: an accent bar, a line of text that rises in word by word, an optional small line above it.
 *  props: {text, kicker?: "small line above", side ("left" | "right"), y (800), size (54)} */
const Label: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps } = useT();
  const { text, kicker, side = "left", y = 800, size = 54 } = ev.props as { text: string; kicker?: string; side?: string; y?: number; size?: number };
  const at = ev.at < 0.01 ? -2 : ev.at; // a label on frame 0 is already up on frame 0
  const slide = interpolate(fadeIn(t, at, 0.35), [0, 1], [side === "left" ? -40 : 40, 0]);
  const ws = text.split(" ");
  return (
    <div style={{ position: "absolute", top: y, [side === "left" ? "left" : "right"]: 96, opacity: Math.min(fadeIn(t, at, 0.2), fadeOut(t, ev.end)), transform: `translateX(${slide}px)` }}>
      <div style={{ display: "flex", background: C.paper, borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.35)", overflow: "hidden" }}>
        <div style={{ width: 12, background: C.accent }} />
        <div style={{ padding: "16px 30px 18px 24px", fontFamily: SANS, color: C.ink }}>
          {kicker ? <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 2, color: C.accent, textTransform: "uppercase", marginBottom: 4 }}>{kicker}</div> : null}
          <div style={{ fontSize: size, fontWeight: 900, whiteSpace: "nowrap" }}>
            {ws.map((w, i) => {
              const k = pop(f, fps, at + 0.12 + 0.06 * i);
              return <span key={i} style={{ display: "inline-block", marginRight: i < ws.length - 1 ? size * 0.28 : 0, opacity: k, transform: `translateY(${(1 - k) * 14}px)` }}>{w}</span>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/** A chapter card over a dimmed picture: a big number and a title. props: {n: 2, title: "Measure it", sub?: "a smaller line"} */
const Chapter: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps } = useT();
  const { n, title, sub } = ev.props as { n: number | string; title: string; sub?: string };
  const o = Math.min(fadeIn(t, ev.at, 0.3), fadeOut(t, ev.end, 0.3));
  const s = pop(f, fps, ev.at + 0.1);
  return (
    <AbsoluteFill style={{ background: C.dim, opacity: o, alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 6, color: C.accent, opacity: s }}>CHAPTER {n}</div>
      <div style={{ fontSize: 120, fontWeight: 900, color: "white", marginTop: 10, transform: `scale(${0.85 + 0.15 * s})` }}>{title}</div>
      {sub ? <div style={{ fontSize: 44, fontWeight: 600, color: "rgba(255,255,255,.75)", marginTop: 14, opacity: fadeIn(t, ev.at + 0.5, 0.3) }}>{sub}</div> : null}
    </AbsoluteFill>
  );
};

/** A bar chart: one bar per row, values on the bars, an optional total. props: {title?, rows: [["Before", 70], ["After", 6.7]], unit (""), total?: true, digits (1)} */
const Bars: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t } = useT();
  const { at, end } = ev;
  const { title, rows, unit = "", total, digits = 1 } = ev.props as { title?: string; rows: [string, number][]; unit?: string; total?: boolean; digits?: number };
  const max = Math.max(...rows.map((r) => r[1]), 1e-9);
  const sum = rows.reduce((a, r) => a + r[1], 0);
  const o = Math.min(fadeIn(t, at, 0.25), fadeOut(t, end));
  return (
    <AbsoluteFill style={{ background: C.dim, opacity: o }}>
      <div style={{ position: "absolute", left: 300, top: 170, width: 1320, background: C.paper, borderRadius: 22, boxShadow: "0 24px 70px rgba(0,0,0,.45)", padding: "40px 56px 36px", fontFamily: SANS, color: C.ink }}>
        {title ? <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 18 }}>{title}</div> : null}
        {rows.map(([name, v], i) => {
          const g = ease(interpolate(t, [at + 0.2 + i * 0.15, at + 0.8 + i * 0.15], [0, 1], clamp));
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", height: 96 }}>
              <div style={{ width: 300, fontSize: 40, fontWeight: 800 }}>{name}</div>
              <div style={{ height: 52, width: 700 * (v / max) * g, background: i % 2 ? C.warm : C.accent, borderRadius: 10 }} />
              <div style={{ marginLeft: 18, fontSize: 40, fontWeight: 900, opacity: g }}>{v.toFixed(digits)}{unit}</div>
            </div>
          );
        })}
        {total ? (
          <div style={{ borderTop: `4px solid ${C.ink}`, marginTop: 14, paddingTop: 14, display: "flex", justifyContent: "space-between", opacity: fadeIn(t, at + 0.9 + rows.length * 0.15, 0.3) }}>
            <div style={{ fontSize: 44, fontWeight: 900 }}>Total</div>
            <div style={{ fontSize: 48, fontWeight: 900, color: C.accent }}>{sum.toFixed(digits)}{unit}</div>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** A ring drawn round a part of a picture. */
const Ring: React.FC<{ cx: number; cy: number; rx: number; ry: number; at: number; color: string }> = ({ cx, cy, rx, ry, at, color }) => {
  const { t } = useT();
  const L = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) * 1.08;
  const p = ease(interpolate(t, [at, at + 0.45], [0, 1], clamp));
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - p)} transform={`rotate(-6 ${cx} ${cy})`} />;
};

/** An image from remotion/public on a dimmed picture, with rings drawn round parts of it (in the image's own pixels at the shown size).
 *  props: {src: "picture.png", w (1500), h (844), rings: [{cx, cy, rx, ry, after (s)}], color ("#ff5a4f")} */
const Picture: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t } = useT();
  const { src, w = 1500, h = 844, rings = [], color = C.red } = ev.props as { src: string; w?: number; h?: number; rings?: { cx: number; cy: number; rx: number; ry: number; after: number }[]; color?: string };
  const s = interpolate(t, [ev.at, ev.at + 0.35], [0.95, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ background: C.dim, opacity: Math.min(fadeIn(t, ev.at), fadeOut(t, ev.end)) }}>
      <div style={{ position: "absolute", left: (1920 - w) / 2, top: (1080 - h) / 2, width: w, height: h, transform: `scale(${s})`, borderRadius: 12, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,.6)" }}>
        <Img src={staticFile(src)} style={{ width: w, height: h, objectFit: "cover" }} />
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
          {rings.map((r, i) => <Ring key={i} cx={r.cx} cy={r.cy} rx={r.rx} ry={r.ry} at={ev.at + r.after} color={color} />)}
        </svg>
      </div>
    </AbsoluteFill>
  );
};

/** The end card: a line and two empty slots where the end-screen elements go. props: {text ("WATCH NEXT")} */
const End: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps } = useT();
  const { text = "WATCH NEXT" } = ev.props as { text?: string };
  const s = pop(f, fps, ev.at + 0.1);
  return (
    <AbsoluteFill style={{ background: "#101217", opacity: fadeIn(t, ev.at, 0.3), alignItems: "center", fontFamily: SANS }}>
      <div style={{ marginTop: 130, fontSize: 92, fontWeight: 900, color: "white", transform: `scale(${0.8 + 0.2 * s})` }}>{text}</div>
      <div style={{ display: "flex", gap: 80, marginTop: 80 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ width: 640, height: 360, border: "5px dashed rgba(255,255,255,.35)", borderRadius: 18, opacity: pop(f, fps, ev.at + 0.3 + i * 0.15) }} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// the registry the engine's Layer draws from: events.json "comp" names
export const COMPONENTS: Record<string, React.FC<{ ev: Ev }>> = { ...SHOW, Label, Chapter, Bars, Picture, End };
