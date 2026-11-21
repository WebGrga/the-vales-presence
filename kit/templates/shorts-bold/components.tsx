// shorts-bold: the overlay pieces of a vertical Short (1080x1920). A transparent layer with no base video: the engine renders only the
// stretches where one of these is on screen and lays them over the locked rough. Captions (ASS) and zooms (ffmpeg) are not drawn here.
// Most pieces come from the engine's Shorts kit (Band, Label, Pops, EndText, Box, Marker, Underline, Tag, Chips, Scrim, Flash: their props
// are in engine/remotion/shorts.tsx). This file adds Stat. ev.at / ev.end are seconds of the rough; ev.props is what make_overlays.py set.
import React from "react";
import { interpolate, spring } from "remotion";
import { KIT, FONT, COL, SHADOW, useClock, easeIn } from "./pipeline/shorts";
import type { Ev } from "./pipeline/types";

/** A big number with a short label under it, in the top band: the number springs in, the label follows.
 *  props: {value: "3x", label: "FASTER", top (160), color ("y"), size (220)} */
const Stat: React.FC<{ ev: Ev }> = ({ ev }) => {
  const { t, f, fps, out } = useClock(ev);
  const { value, label = "", top = 160, color = "y", size = 220 } = ev.props as { value: string; label?: string; top?: number; color?: string; size?: number };
  const s = spring({ frame: f - Math.round(ev.at * fps), fps, config: { damping: 14, stiffness: 180 } });
  const k = easeIn(t, ev.at + 0.25, 0.3);
  return (
    <div style={{ position: "absolute", left: 0, top, width: 1080, display: "flex", flexDirection: "column", alignItems: "center", opacity: out, fontFamily: FONT, fontWeight: 900, textShadow: SHADOW }}>
      <div style={{ fontSize: size, lineHeight: 1, color: COL[color] ?? color, transform: `scale(${interpolate(s, [0, 1], [0.6, 1])})`, opacity: Math.min(1, s * 1.5) }}>{value}</div>
      <div style={{ fontSize: 64, color: "white", marginTop: 6, opacity: k, transform: `translateY(${(1 - k) * 16}px)`, letterSpacing: 2 }}>{label}</div>
    </div>
  );
};

export const COMPONENTS: Record<string, React.FC<{ ev: Ev }>> = { ...KIT, Stat };
