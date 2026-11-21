import React from "react";
import { Composition } from "remotion";
import { Layer } from "./Layer";
import type { LayerProps } from "./types";

const DEFAULT: LayerProps = { meta: { fps: 60, width: 1920, height: 1080, duration: 10 }, events: [] };

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Overlay"
    component={Layer}
    defaultProps={DEFAULT}
    durationInFrames={600}
    fps={60}
    width={1920}
    height={1080}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.round(props.meta.duration * props.meta.fps)),
      fps: props.meta.fps,
      width: props.meta.width,
      height: props.meta.height,
    })}
  />
);
