// The overlay layer: NO base video, a transparent background. Each event of the window draws itself with the component
// named in its "comp" (exported by the template's src/components.tsx) while the clock is inside [at, end).
// Times are seconds of the rough: render_windows.py renders a frame range of this one composition (absolute frame numbers).
import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { COMPONENTS } from "../components";
import type { LayerProps } from "./types";

export const Layer: React.FC<LayerProps> = ({ events }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  return (
    <AbsoluteFill>
      {events.filter((e) => t >= e.at - 1e-6 && t < e.end).map((e) => {
        const C = COMPONENTS[e.comp];
        if (!C) throw new Error(`event ${e.id}: no component "${e.comp}" in components.tsx (has: ${Object.keys(COMPONENTS).join(", ")})`);
        return <C key={e.id} ev={{ ...e, props: e.props ?? {} }} />;
      })}
    </AbsoluteFill>
  );
};
