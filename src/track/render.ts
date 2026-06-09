// Turn centerline samples into Konva point arrays: a body outline polygon and
// the two recessed groove polylines.

import { union as polyUnion } from "polygon-clipping";
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

/**
 * Union of multiple lane body polygons as a single flat [x,y,...] array.
 * Used for switch/split pieces to stroke only the exterior boundary.
 */
export function unionBodyPolygons(allSamples: Pose[][]): number[] {
  const rings = allSamples.map((samples) => {
    const pts = bodyPolygon(samples);
    const ring: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 2) ring.push([pts[i], pts[i + 1]]);
    return [ring]; // Polygon = Ring[]
  });
  const [first, ...rest] = rings;
  const result = polyUnion(first, ...rest);
  if (!result.length || !result[0].length) return [];
  // result[0][0] = outer ring of the first (and only) output polygon
  return result[0][0].flatMap(([x, y]) => [x, y]);
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
