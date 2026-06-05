// Turn centerline samples into Konva point arrays: a body outline polygon and
// the two recessed groove polylines.

import { type Pose } from "../geometry";
import { GROOVE_CENTER_OFFSET, TRACK_WIDTH } from "./constants";

const HALF = TRACK_WIDTH / 2;

function offsetPoint(p: Pose, off: number): [number, number] {
  const nx = -Math.sin(p.heading);
  const ny = Math.cos(p.heading);
  return [p.x + off * nx, p.y + off * ny];
}

/** Closed body outline as a flat [x0,y0,x1,y1,...] array. */
export function bodyPolygon(samples: Pose[]): number[] {
  const left: number[] = [];
  const right: number[] = [];
  for (const p of samples) {
    const [lx, ly] = offsetPoint(p, HALF);
    const [rx, ry] = offsetPoint(p, -HALF);
    left.push(lx, ly);
    right.unshift(ry); // build reversed
    right.unshift(rx);
  }
  return [...left, ...right];
}

/** A groove polyline (drawn as a thick dark stroke) offset from the centerline. */
export function groovePolyline(samples: Pose[], side: 1 | -1): number[] {
  const out: number[] = [];
  for (const p of samples) {
    const [x, y] = offsetPoint(p, side * GROOVE_CENTER_OFFSET);
    out.push(x, y);
  }
  return out;
}
