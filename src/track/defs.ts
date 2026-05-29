// The track piece library. Geometry uses real wooden-railway dimensions (constants.ts).
// Each piece is one or more "lanes" (drivable paths) plus typed ports.
//
// `levelOffset` is RELATIVE within a piece, not absolute: flat pieces have all
// ports at offset 0, and an ascender goes from 0 to +1. The absolute elevation
// of each placed piece is computed by propagating these offsets across joints
// out from ground (see network/levels.ts), so any flat piece can sit on a
// raised level just by being connected to a ramp.

import {
  CURVE_RADIUS,
  CURVE_SWEEP_DEG,
  STRAIGHT_A,
  STRAIGHT_A1,
  STRAIGHT_D,
  STRAIGHT_A2,
} from "./constants";
import {
  poseAlong,
  totalLength,
  type Pose,
  type Segment,
} from "../geometry";

export type Gender = "M" | "F";
export type Category = "straight" | "curve" | "switch" | "ascender" | "connector";

export interface PortDef {
  id: string;
  gender: Gender;
  levelOffset: number; // elevation relative to the piece's base (0 = base, 1 = one level up)
}

export interface LaneDef {
  from: string; // port id at lane start
  to: string; // port id at lane end
  start: Pose; // local start pose
  segments: Segment[];
}

export interface TrackDef {
  id: string;
  name: string;
  category: Category;
  ports: PortDef[];
  lanes: LaneDef[];
  /** For switches: ids of lanes selectable as the through route from the single end. */
  switchLanes?: number[];
}

const ORIGIN: Pose = { x: 0, y: 0, heading: 0 };

function straight(id: string, name: string, len: number): TrackDef {
  return {
    id,
    name,
    category: "straight",
    ports: [
      { id: "p0", gender: "F", levelOffset: 0 },
      { id: "p1", gender: "M", levelOffset: 0 },
    ],
    lanes: [{ from: "p0", to: "p1", start: ORIGIN, segments: [{ kind: "line", length: len }] }],
  };
}

const curveSeg: Segment = { kind: "arc", radius: CURVE_RADIUS, sweepDeg: CURVE_SWEEP_DEG, sign: 1 };

export const DEFS: TrackDef[] = [
  straight("straight-a", `Straight (${STRAIGHT_A}mm)`, STRAIGHT_A),
  straight("straight-a1", `Short straight (${STRAIGHT_A1}mm)`, STRAIGHT_A1),
  straight("straight-d", `Long straight (${STRAIGHT_D}mm)`, STRAIGHT_D),
  {
    id: "curve",
    name: "Curve (45°)",
    category: "curve",
    ports: [
      { id: "p0", gender: "F", levelOffset: 0 },
      { id: "p1", gender: "M", levelOffset: 0 },
    ],
    lanes: [{ from: "p0", to: "p1", start: ORIGIN, segments: [curveSeg] }],
  },
  {
    id: "switch-fmm",
    name: "Switch (1 female → 2 male)",
    category: "switch",
    ports: [
      { id: "p0", gender: "F", levelOffset: 0 }, // single end
      { id: "p1", gender: "M", levelOffset: 0 }, // straight branch
      { id: "p2", gender: "M", levelOffset: 0 }, // curved branch
    ],
    lanes: [
      { from: "p0", to: "p1", start: ORIGIN, segments: [{ kind: "line", length: STRAIGHT_A }] },
      { from: "p0", to: "p2", start: ORIGIN, segments: [curveSeg] },
    ],
    switchLanes: [0, 1],
  },
  {
    id: "switch-mff",
    name: "Switch (1 male → 2 female)",
    category: "switch",
    ports: [
      { id: "p0", gender: "M", levelOffset: 0 },
      { id: "p1", gender: "F", levelOffset: 0 },
      { id: "p2", gender: "F", levelOffset: 0 },
    ],
    lanes: [
      { from: "p0", to: "p1", start: ORIGIN, segments: [{ kind: "line", length: STRAIGHT_A }] },
      { from: "p0", to: "p2", start: ORIGIN, segments: [curveSeg] },
    ],
    switchLanes: [0, 1],
  },
  {
    id: "ascender",
    name: "Ascender ramp",
    category: "ascender",
    ports: [
      { id: "p0", gender: "F", levelOffset: 0 },
      { id: "p1", gender: "M", levelOffset: 1 }, // rises one level (reverse it for a descent)
    ],
    lanes: [{ from: "p0", to: "p1", start: ORIGIN, segments: [{ kind: "line", length: STRAIGHT_D }] }],
  },
  {
    id: "double-male",
    name: "Double-male adapter",
    category: "connector",
    ports: [
      { id: "p0", gender: "M", levelOffset: 0 },
      { id: "p1", gender: "M", levelOffset: 0 },
    ],
    lanes: [{ from: "p0", to: "p1", start: ORIGIN, segments: [{ kind: "line", length: STRAIGHT_A2 }] }],
  },
  {
    id: "double-female",
    name: "Double-female adapter",
    category: "connector",
    ports: [
      { id: "p0", gender: "F", levelOffset: 0 },
      { id: "p1", gender: "F", levelOffset: 0 },
    ],
    lanes: [{ from: "p0", to: "p1", start: ORIGIN, segments: [{ kind: "line", length: STRAIGHT_A2 }] }],
  },
];

export const DEF_BY_ID: Record<string, TrackDef> = Object.fromEntries(DEFS.map((d) => [d.id, d]));

// --- Derived geometry ---

export interface PortGeom {
  id: string;
  gender: Gender;
  levelOffset: number;
  pos: { x: number; y: number };
  angle: number; // outward tangent (radians), points away from the piece
}

const portCache = new Map<string, PortGeom[]>();

/** Local-frame port geometry for a def (position + outward angle), derived from its lanes. */
export function portsForDef(def: TrackDef): PortGeom[] {
  const cached = portCache.get(def.id);
  if (cached) return cached;

  const byId = new Map<string, PortGeom>();
  for (const p of def.ports) {
    byId.set(p.id, { id: p.id, gender: p.gender, levelOffset: p.levelOffset, pos: { x: 0, y: 0 }, angle: 0 });
  }
  for (const lane of def.lanes) {
    const from = byId.get(lane.from)!;
    from.pos = { x: lane.start.x, y: lane.start.y };
    from.angle = lane.start.heading + Math.PI; // points back out of the piece

    const endPose = poseAlong(lane.segments, lane.start, totalLength(lane.segments));
    const to = byId.get(lane.to)!;
    to.pos = { x: endPose.x, y: endPose.y };
    to.angle = endPose.heading; // points forward out of the piece
  }
  const result = def.ports.map((p) => byId.get(p.id)!);
  portCache.set(def.id, result);
  return result;
}
