// shorts-calm: the overlay pieces of a calm vertical Short (1080x1920): a light card for the title and for a label (one block of text at a
// time), thin accent strokes under real lines of text on screen, and the kit's soft Marker. A transparent layer with no base video.
// Captions are ASS (a whole line at once in a dark pill, set in make_overlays.py); zooms are ffmpeg. Neither is drawn here.
// ev.at / ev.end are seconds of the rough; ev.props is what make_overlays.py put in the event.
import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { KIT, FONT, clamp } from "./pipeline/shorts";
import type { Ev } from "./pipeline/types";

const INK = "#14161c";
const PAPER = "#fbfbf8";
const ACCENT = "#4f8cff";
const fade = (t: number, a: number, b: number, d = 0.18) => Math.min(interpolate(t, [a, a + d], [0, 1], clamp), interpolate(t, [b - d, b], [1, 0], clamp));
const draw = (t: number, a: number, d: number) => interpolate(t, [a, a + d], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
const useT = () => { const f = useCurrentFrame(); const { fps } = useVideoConfig(); return f / fps; };

/** The card: lines of text in the top band, sliding down 24 px as it fades in.
 *  props: {lines: string[], size (58), type?: true (types on over 0.3 s), top (120), accent ("#4f8cff")} */
const Card: React.FC<{ ev: Ev }> = ({ ev }) => {
  const t = useT();
  const { lines, size = 58, type, top = 120, accent = ACCENT } = ev.props as { lines: string[]; size?: number; type?: boolean; top?: number; accent?: string };
  const o = fade(t, ev.at, ev.end, 0.2);
  const y = interpolate(t, [ev.at, ev.at + 0.3], [-24, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const all = lines.join("\n");
  const n = type ? Math.round(interpolate(t, [ev.at, ev.at + 0.3], [0, all.length], clamp)) : all.length;
  const shown = all.slice(0, n).split("\n");
  return (
    <div style={{ position: "absolute", top, left: 50, width: 980, display: "flex", justifyContent: "center", opacity: o, transform: `translateY(${y}px)` }}>
      <div style={{ background: PAPER, borderRadius: 24, borderBottom: `8px solid ${accent}`, boxShadow: "0 16px 44px rgba(0,0,0,.40)", padding: "20px 36px", textAlign: "center", fontFamily: FONT, fontWeight: 800, color: INK, lineHeight: 1.12 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: size, minHeight: size * 1.1, maxWidth: 880 }}>
            <span>{shown[i] ?? ""}</span>
            <span style={{ visibility: "hidden" }}>{l.slice((shown[i] ?? "").length)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Thin strokes under real lines of text on screen, drawn left to right one after another.
 *  props: {strokes: [{x, y, w, at (s after the event starts)}], color ("#4f8cff"), h (7)} */
const Strokes: React.FC<{ ev: Ev }> = ({ ev }) => {
  const t = useT();
  const { strokes, color = ACCENT, h = 7 } = ev.props as { strokes: { x: number; y: number; w: number; at: number }[]; color?: string; h?: number };
  const o = fade(t, ev.at, ev.end, 0.15);
  return (
    <>
      {strokes.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: s.x, top: s.y, height: h, borderRadius: h / 2, background: color, opacity: o, width: s.w * draw(t, ev.at + s.at, 0.25) }} />
      ))}
    </>
  );
};

export const COMPONENTS: Record<string, React.FC<{ ev: Ev }>> = { Card, Strokes, Marker: KIT.Marker };
