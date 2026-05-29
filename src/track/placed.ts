// A PlacedPiece is an instance of a TrackDef positioned in the world.
// Helpers here transform local-frame geometry (defs.ts) into world space.

import { poseAlong, sampleChain, totalLength, type Pose } from "../geometry";
import { DEF_BY_ID, portsForDef, type PortGeom, type TrackDef } from "./defs";

export interface PlacedPiece {
  id: string;
  defId: string;
  x: number;
  y: number;
  rotation: number; // radians
  flipped: boolean;
  switchState: number; // index into def.switchLanes (which through-route is active)
}

export interface WorldPort extends PortGeom {
  pieceId: string;
}

/** Transform a local pose into world space, applying flip, rotation, translation. */
export function transformPose(piece: PlacedPiece, p: Pose): Pose {
  let { x, y } = p;
  let h = p.heading;
  if (piece.flipped) {
    y = -y;
    h = -h;
  }
  const c = Math.cos(piece.rotation);
  const s = Math.sin(piece.rotation);
  return {
    x: piece.x + x * c - y * s,
    y: piece.y + x * s + y * c,
    heading: h + piece.rotation,
  };
}

export function defOf(piece: PlacedPiece): TrackDef {
  return DEF_BY_ID[piece.defId];
}

/** World-space ports for a placed piece. */
export function worldPorts(piece: PlacedPiece): WorldPort[] {
  const def = defOf(piece);
  return portsForDef(def).map((port) => {
    const tp = transformPose(piece, { x: port.pos.x, y: port.pos.y, heading: port.angle });
    return {
      ...port,
      pos: { x: tp.x, y: tp.y },
      angle: tp.heading,
      pieceId: piece.id,
    };
  });
}

/** World-space centerline samples for one lane (for rendering). */
export function worldLaneSamples(piece: PlacedPiece, laneIndex: number): Pose[] {
  const def = defOf(piece);
  const lane = def.lanes[laneIndex];
  return sampleChain(lane.segments, lane.start).map((p) => transformPose(piece, p));
}

/** World pose at arc-length s along a lane (for placing/animating trains). */
export function worldPoseAlongLane(piece: PlacedPiece, laneIndex: number, s: number): Pose {
  const def = defOf(piece);
  const lane = def.lanes[laneIndex];
  return transformPose(piece, poseAlong(lane.segments, lane.start, s));
}

export function laneLength(piece: PlacedPiece, laneIndex: number): number {
  return totalLength(defOf(piece).lanes[laneIndex].segments);
}
