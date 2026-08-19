// Renderer-neutral visual geometry for a track piece. Both the interactive
// Konva canvas and the SVG palette thumbnails consume this model so visual
// details cannot drift between them.

import { poseAlong, sampleChain, totalLength, type Pose } from "../geometry";
import { portsForDef, type TrackDef } from "./defs";
import { CONN, headCenterX, neckCorners } from "./connector";
import { bodyPolygon, groovePolyline, unionBodyPolygons } from "./render";

/**
 * Visual semantics shared by every renderer. Backends may scale these world-mm
 * values, but must not choose alternate caps, widths, or marker dimensions.
 */
export const PIECE_VISUAL_STYLE = {
  body: { strokeWidth: 2 },
  groove: { strokeWidth: 6, lineCap: "butt", lineJoin: "round" },
  chevron: { strokeWidth: 2.5, lineCap: "round", lineJoin: "round", opacity: 0.7 },
  switchMarker: { width: 28, height: 10, cornerRadius: 4, strokeWidth: 1.5 },
  connector: {
    male: { strokeWidth: 2, lineJoin: "round", highlightOffset: [-1.5, -1.5], highlightRadius: 0.4 },
    female: { strokeWidth: 1.2, lineJoin: "round" },
  },
} as const;

export interface LaneVisual {
  body: number[];
  grooves: [number[], number[]];
  active: boolean;
  start: Pose;
  end: Pose;
}

export interface SwitchMarkerVisual {
  x: number;
  y: number;
  heading: number;
}

export interface PieceVisual {
  lanes: LaneVisual[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  switchBody?: number[];
  switchMarker?: SwitchMarkerVisual;
  chevrons: number[][];
}

/**
 * All geometry and state-dependent visual choices for a track piece.
 * Rendering backends only need to map the returned paths and styles to their
 * own primitives.
 */
export function pieceVisual(def: TrackDef, switchState = 0): PieceVisual {
  const activeLane = def.switchLanes?.[switchState];
  const samples = def.lanes.map((lane) => sampleChain(lane.segments, lane.start));
  const lanes = def.lanes.map((lane, index) => {
    const length = totalLength(lane.segments);
    return {
      body: bodyPolygon(samples[index]),
      grooves: [groovePolyline(samples[index], 1), groovePolyline(samples[index], -1)] as [number[], number[]],
      active: activeLane === undefined || activeLane === index,
      start: lane.start,
      end: poseAlong(lane.segments, lane.start, length),
    };
  });

  const markerLane = activeLane ?? 0;
  const marker = def.category === "switch" ? def.lanes[markerLane] : undefined;
  const markerLength = marker ? totalLength(marker.segments) : 0;
  const markerPose = marker ? poseAlong(marker.segments, marker.start, markerLength * 0.25) : undefined;

  const chevrons = def.category === "ascender"
    ? [0.32, 0.5, 0.68].map((fraction) => chevronAt(def.lanes[0], fraction))
    : [];

  return {
    lanes,
    bounds: visualBounds(lanes, def),
    switchBody: def.category === "switch" ? unionBodyPolygons(samples) : undefined,
    switchMarker: markerPose && { x: markerPose.x, y: markerPose.y, heading: markerPose.heading },
    chevrons,
  };
}

/** Bounds include connector heads as well as the wooden body. */
function visualBounds(lanes: LaneVisual[], def: TrackDef) {
  const points: [number, number][] = [];
  for (const lane of lanes) {
    for (let i = 0; i < lane.body.length; i += 2) points.push([lane.body[i], lane.body[i + 1]]);
  }
  for (const port of portsForDef(def)) {
    const c = Math.cos(port.angle);
    const s = Math.sin(port.angle);
    const map = (x: number, y: number): [number, number] => [port.pos.x + x * c - y * s, port.pos.y + x * s + y * c];
    for (const [x, y] of neckCorners(port.gender)) points.push(map(x, y));
    const [headX, headY] = map(headCenterX(port.gender), 0);
    points.push([headX - CONN.headR, headY - CONN.headR], [headX + CONN.headR, headY + CONN.headR]);
  }
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function chevronAt(lane: TrackDef["lanes"][number], fraction: number): number[] {
  const length = totalLength(lane.segments);
  const p = poseAlong(lane.segments, lane.start, length * fraction);
  const dx = Math.cos(p.heading);
  const dy = Math.sin(p.heading);
  const px = -Math.sin(p.heading);
  const py = Math.cos(p.heading);
  return [
    p.x - dx * 5 + px * 9, p.y - dy * 5 + py * 9,
    p.x + dx * 7, p.y + dy * 7,
    p.x - dx * 5 - px * 9, p.y - dy * 5 - py * 9,
  ];
}
