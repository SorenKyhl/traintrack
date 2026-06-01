// Turn centerline samples into Konva point arrays: a body outline polygon and
// the two recessed groove polylines.

import { type Pose } from "../geometry";
import { GROOVE_CENTER_OFFSET, TRACK_WIDTH } from "./constants";

const HALF = TRACK_WIDTH / 2;

function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Combined switch body as a convex hull over all lane outlines — flat [x0,y0,...] array. */
export function switchBodyHull(allSamples: Pose[][]): number[] {
  const pts: Array<[number, number]> = [];
  for (const samples of allSamples) {
    const body = bodyPolygon(samples);
    for (let i = 0; i < body.length; i += 2) pts.push([body[i], body[i + 1]]);
  }
  return convexHull(pts).flatMap(([x, y]) => [x, y]);
}

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
