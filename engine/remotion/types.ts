// What a template component receives. `props` is whatever make_overlays.py put in the event's "props".
export type Ev<P = any> = { id: string; kind: string; comp: string; at: number; end: number; props: P; [k: string]: any };
export type Meta = { fps: number; width: number; height: number; duration: number };
export type LayerProps = { meta: Meta; events: Ev[] };
