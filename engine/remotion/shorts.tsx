// The Shorts kit: the overlay pieces every Shorts template shares (1080x1920, one top-band slot, boxes, rings, chips, tags). Copied by
// render_windows.py to <video>/remotion/src/pipeline/shorts.tsx; a template's components.tsx imports from "./pipeline/shorts" and spreads KIT
// into its COMPONENTS. Transparent layer, no base video. Captions are NOT here: ASS (captions.py). Zoom is NOT here: ffmpeg.
//
// Rules the kit keeps: made text starts at y 120 or lower (the Shorts icons sit above); one text block at a
// time is the template's job (events do not overlap); every position is in output pixels of the 1080x1920 rough, measured from stills.
// ev.at / ev.end are seconds of the rough; ev.props is what make_overlays.py put in the event.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont as mont } from "@remotion/google-fonts/Montserrat";
import type { Ev } from "./types";

export const FONT = mont("normal", { weights: ["700", "800", "900"], subsets: ["latin"] }).fontFamily;
export const COL: Record<string, string> = { y: "#FFD84A", g: "#7ED957", r: "#FF6B5B", w: "#FFFFFF", o: "#FF8A3D", ink: "#10140f" };
export const SHADOW = "0 4px 0 rgba(0,0,0,.55), 0 0 26px rgba(0,0,0,.55)";
export const TOP = 120; // text never above this y (the Shorts icons sit above)
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeIn = (t: number, a: number, d: number) => interpolate(t, [a, a + d], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
export const fadeOut = (t: number, b: number, d = 0.15) => interpolate(t, [b - d, b], [1, 0], clamp);

/** The clock of the layer in seconds of the rough, and whether this event runs to the very end of the cut (its fade-out is skipped). */
export const useClock = (ev: Ev) => {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = f / fps;
  const last = ev.end >= durationInFrames / fps - 0.02;
  return { t, f, fps, last, out: last || ev.props.hold ? 1 : fadeOut(t, ev.end, ev.props.fade ?? 0.15) };
};

type Part = string | [string, string]; // "text" or ["text", "y"]
export type Line = { p: Part[]; size: number; after?: number; mt?: number; nowrap?: boolean; color?: string };
const parts = (p: Part[]) => p.map((x, i) => (typeof x === "string" ? <React.Fragment key={i}>{x}</React.Fragment> : <span key={i} style={{ color: COL[x[1]] ?? x[1] }}>{x[0]}</span>));

/** The top band: a dark fade from the top edge and centred bold lines. `enter` = slides and fades in (a hook on frame 0 does not). */
const BandBox: React.FC<{ ev: Ev; h: number; top?: number; enter?: boolean; children: React.ReactNode }> = ({ ev, h, top = 130, enter = true, children }) => {
  const { t, out } = useClock(ev);
  const o = Math.min(enter ? easeIn(t, ev.at, 0.18) : 1, out);
  const y = enter ? interpolate(easeIn(t, ev.at, 0.25), [0, 1], [-24, 0]) : 0;
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: top + h + 80, opacity: o, background: "linear-gradient(rgba(10,11,14,.88) 80%, rgba(10,11,14,0))" }} />
      <div style={{ position: "absolute", left: 50, top, width: 980, height: h, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", opacity: o, transform: `translateY(${y}px)`, fontFamily: FONT, fontWeight: 900, color: "white", textShadow: SHADOW }}>
        {children}
      </div>
    </>
  );
};

/** Hook / gloss / end text in the top band. props: {lines: [{p: ["AGENT 1", ...] | [["AGENT 1","y"], " DID"], size, after?: s after the event starts that this line lands, mt?, nowrap?}],
 *  h (band height, default 300), top (default 130), enter (default false: a hook is up on frame 0), chip?: {text, size, bg: "g", after}} */
export const Band: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t } = useClock(ev);
  const { lines = [], h = 300, top = 130, enter = false, chip } = ev.props as { lines: Line[]; h?: number; top?: number; enter?: boolean; chip?: { text: string; size?: number; bg?: string; after: number } };
  return (
    <BandBox ev={ev} h={h} top={top} enter={enter}>
      {lines.map((l, i) => {
        const k = l.after ? easeIn(t, ev.at + l.after, 0.3) : 1; // a later line lands once the first has been read
        return (
          <div key={i} style={{ fontSize: l.size, lineHeight: 1.05, marginTop: l.mt ?? 0, whiteSpace: l.nowrap ? "nowrap" : undefined, color: l.color ? COL[l.color] ?? l.color : undefined, opacity: k, transform: `translateY(${(1 - k) * 18}px)` }}>
            {parts(l.p)}
          </div>
        );
      })}
      {chip && t >= ev.at + chip.after ? <div style={{ height: 66, marginTop: 14, display: "flex", alignItems: "center" }}><Pill ev={ev} at={ev.at + chip.after} size={chip.size ?? 46} bg={chip.bg ?? "g"}>{chip.text}</Pill></div> : null}
    </BandBox>
  );
};

/** A coloured pill that pops in (used inside the band or alone). */
const Pill: React.FC<{ ev: Ev; at: number; size: number; bg: string; children: React.ReactNode }> = ({ at, size, bg, children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const s = interpolate(t, [at, at + 0.25], [0.9, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  return (
    <div style={{ fontSize: size, whiteSpace: "nowrap", background: COL[bg] ?? bg, color: COL.ink, textShadow: "none", padding: "8px 30px", borderRadius: 16, boxShadow: "0 8px 22px rgba(0,0,0,.45)", opacity: easeIn(t, at, 0.2), transform: `scale(${s})` }}>
      {children}
    </div>
  );
};

/** A label pill in the top band. props: {text, size (60), bg ("g" | "y" | colour), top (130), noBand?: true (just the pill, no dark fade)} */
export const Label: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { text, size = 60, bg = "g", top = 130, noBand } = ev.props as { text: string; size?: number; bg?: string; top?: number; noBand?: boolean };
  if (noBand) {
    const o = Math.min(easeIn(t, ev.at, 0.18), out);
    return <div style={{ position: "absolute", top, left: 0, width: 1080, display: "flex", justifyContent: "center", fontFamily: FONT, fontWeight: 900, opacity: o }}><Pill ev={ev} at={ev.at} size={size} bg={bg}>{text}</Pill></div>;
  }
  return <BandBox ev={ev} h={150} top={top}><Pill ev={ev} at={ev.at} size={size} bg={bg}>{text}</Pill></BandBox>;
};

/** Kinetic title in the top band: words land 0.1 s apart. props: {lines: [{size, words: [["I"], ["STOPPED","y"]], step (0.12)}], h, top, enter} */
export const Pops: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t } = useClock(ev);
  const { lines, h = 300, top = 130, step = 0.12 } = ev.props as { lines: { size: number; words: [string, string?][] }[]; h?: number; top?: number; step?: number };
  let n = 0;
  return (
    <BandBox ev={ev} h={h} top={top}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: l.size, lineHeight: 1.05 }}>
          {l.words.map((w, j) => {
            const at = ev.at + step * n++;
            const p = easeIn(t, at, 0.14);
            const s = interpolate(t, [at, at + 0.22], [1.35, 1], { ...clamp, easing: Easing.out(Easing.back(2.2)) });
            return <span key={j} style={{ display: "inline-block", opacity: p, transform: `scale(${s})`, color: w[1] ? COL[w[1]] : "white", margin: "0 14px" }}>{w[0]}</span>;
          })}
        </div>
      ))}
    </BandBox>
  );
};

/** Big text over a dimmed screen (the end text). props: {lines: Line[], top (760), dim (.5)} */
export const EndText: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { lines, top = 760, dim = 0.5 } = ev.props as { lines: Line[]; top?: number; dim?: number };
  const o = Math.min(easeIn(t, ev.at, 0.25), out);
  const s = interpolate(t, [ev.at, ev.at + 0.35], [1.08, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, background: `rgba(8,9,12,${dim})`, opacity: o }} />
      <div style={{ position: "absolute", left: 60, top, width: 960, textAlign: "center", fontFamily: FONT, fontWeight: 900, lineHeight: 1.04, color: "white", textShadow: SHADOW, opacity: o, transform: `scale(${s})` }}>
        {lines.map((l, i) => <div key={i} style={{ fontSize: l.size }}>{parts(l.p)}</div>)}
      </div>
    </>
  );
};

/** A self-drawing rectangle round a real thing on the screen: the box (tint), the ring on a button (press = the second the click lands, a small squeeze).
 *  props: {box: [x, y, w, h], color ("y"), tint?: true, press?: s, draw (0.4 s), r (14), stroke (7)} */
export const Box: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { box, color = "y", tint, press, draw = 0.4, r = 14, stroke = 7 } = ev.props as { box: number[]; color?: string; tint?: boolean; press?: number; draw?: number; r?: number; stroke?: number };
  const c = COL[color] ?? color;
  const [x, y, w, h] = box;
  const d = easeIn(t, ev.at, draw);
  const per = 2 * (w + h);
  const sq = press ? 1 - 0.06 * Math.max(0, 1 - Math.abs(t - press) / 0.12) : 1;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: out }}>
      <g transform={`translate(${x + w / 2} ${y + h / 2}) scale(${sq}) translate(${-x - w / 2} ${-y - h / 2})`}>
        {tint ? <rect x={x} y={y} width={w} height={h} rx={r} fill={c} opacity={0.22 * d} style={{ mixBlendMode: "multiply" }} /> : null}
        <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke={c} strokeWidth={stroke} strokeDasharray={per} strokeDashoffset={per * (1 - d)} style={{ filter: `drop-shadow(0 0 8px ${c})` }} />
      </g>
    </svg>
  );
};

/** A marker sweep behind a real line of text (multiply keeps the ink readable). props: {box, color ("y"), alpha (.75), draw (.45)} */
export const Marker: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { box, color = "y", alpha = 0.75, draw = 0.45 } = ev.props as { box: number[]; color?: string; alpha?: number; draw?: number };
  const [x, y, w, h] = box;
  const p = easeIn(t, ev.at + 0.1, draw);
  return <div style={{ position: "absolute", left: x, top: y, width: w * p, height: h, background: COL[color] ?? color, opacity: alpha * out, mixBlendMode: "multiply", borderRadius: 6 }} />;
};

/** A hand-drawn underline that grows left to right. props: {line: [x, y, w, h], color ("y"), draw (.5)} */
export const Underline: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { line, color = "y", draw = 0.5 } = ev.props as { line: number[]; color?: string; draw?: number };
  const [x, y, w, h] = line;
  const c = COL[color] ?? color;
  return <div style={{ position: "absolute", left: x, top: y, width: w * easeIn(t, ev.at, draw), height: h, background: c, borderRadius: h, boxShadow: `0 0 10px ${c}`, opacity: out }} />;
};

/** A tag in the top-left corner that slides in ("8 MINUTES EARLIER"). props: {p: Part[], size (58), left (40), top (130)} */
export const Tag: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { p, size = 58, left = 40, top = 130 } = ev.props as { p: Part[]; size?: number; left?: number; top?: number };
  const o = Math.min(easeIn(t, ev.at, 0.18), out);
  const x = interpolate(easeIn(t, ev.at, 0.3), [0, 1], [-30, 0]);
  return (
    <div style={{ position: "absolute", left, top, opacity: o, transform: `translateX(${x}px)`, background: "rgba(10,11,14,.9)", borderRadius: 16, padding: "12px 26px", fontFamily: FONT, fontWeight: 900, fontSize: size, color: "white", boxShadow: "0 8px 22px rgba(0,0,0,.45)", whiteSpace: "nowrap" }}>
      {parts(p)}
    </div>
  );
};

/** Chips that land one after another as each item is said, two per row. props: {items: [{t, at}], top (760), w (470), h (84), size (40), color ("y"), left (40), width (1000)} */
export const Chips: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { items, top = 760, w = 470, h = 84, size = 40, color = "y", left = 40, width = 1000 } = ev.props as { items: { t: string; at: number }[]; top?: number; w?: number; h?: number; size?: number; color?: string; left?: number; width?: number };
  return (
    <div style={{ position: "absolute", left, top, width, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "18px 18px", opacity: out }}>
      {items.map((c, i) => {
        if (t < c.at) return <div key={i} style={{ width: w, height: h }} />;
        const sc = interpolate(t, [c.at, c.at + 0.25], [0.7, 1], { ...clamp, easing: Easing.out(Easing.back(2.2)) });
        return (
          <div key={i} style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", background: "#14161b", border: `4px solid ${COL[color] ?? color}`, borderRadius: h / 2, fontFamily: FONT, fontWeight: 900, fontSize: size, color: "white", opacity: easeIn(t, c.at, 0.22), transform: `scale(${sc})`, boxShadow: "0 8px 22px rgba(0,0,0,.5)" }}>
            {c.t}
          </div>
        );
      })}
    </div>
  );
};

/** A dark scrim over a rectangle or the whole frame (dims the picture while text sits on it). props: {box?: [x,y,w,h], a (.5)} */
export const Scrim: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, out } = useClock(ev);
  const { box = [0, 0, 1080, 1920], a = 0.5 } = ev.props as { box?: number[]; a?: number };
  return <div style={{ position: "absolute", left: box[0], top: box[1], width: box[2], height: box[3], background: `rgba(8,9,12,${a})`, opacity: Math.min(easeIn(t, ev.at, 0.25), out) }} />;
};

/** A white flash on a cut. props: {a (.5), dur (.15)} */
export const Flash: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t } = useClock(ev);
  const { a = 0.5, dur = 0.15 } = ev.props as { a?: number; dur?: number };
  return <AbsoluteFill style={{ background: "white", opacity: a * interpolate(t, [ev.at, ev.at + dur], [1, 0], clamp) }} />;
};

export const KIT: Record<string, React.FC<{ ev: Ev }>> = { Band, Label, Pops, EndText, Box, Marker, Underline, Tag, Chips, Scrim, Flash };
