import { angleDiff, dist, type Vec2 } from "../geometry";
import {
  FLEX_CAPTURE_RADIUS,
  FLEX_CAPTURE_ANGLE_DEG,
  RELAX_ITERATIONS,
} from "../track/constants";
import { worldPorts, type PlacedPiece, type WorldPort } from "../track/placed";
import { buildConnections, type ConnectionMap } from "./connections";

/** A pair of ports the solver should try to bring into a mate. */
export interface FlexJoint {
  a: { pieceId: string; portId: string };
  b: { pieceId: string; portId: string };
}

/**
 * Find every pair of ports that "wants" to be joined: opposite gender, near, and
 * roughly anti-parallel. Tolerances are far looser than a real connection so that
 * a not-quite-closing loop is still captured; the relaxation pass then decides if
 * it can actually be pulled shut. Each port is matched to at most one partner
 * (its closest), so a junction never tries to mate two ways at once.
 */
export function intendedJoints(ports: WorldPort[]): FlexJoint[] {
  const maxAngle = (FLEX_CAPTURE_ANGLE_DEG * Math.PI) / 180;
  const cand: { i: number; j: number; score: number }[] = [];
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      const a = ports[i];
      const b = ports[j];
      if (a.pieceId === b.pieceId) continue;
      if (a.gender === b.gender) continue;
      const gap = dist(a.pos, b.pos);
      if (gap > FLEX_CAPTURE_RADIUS) continue;
      const anti = Math.abs(angleDiff(a.angle + Math.PI, b.angle));
      if (anti > maxAngle) continue;
      cand.push({ i, j, score: gap + anti * 60 }); // weight 1rad of skew ~ 60mm of gap
    }
  }
  cand.sort((x, y) => x.score - y.score);
  const used = new Set<number>();
  const joints: FlexJoint[] = [];
  for (const c of cand) {
    if (used.has(c.i) || used.has(c.j)) continue;
    used.add(c.i);
    used.add(c.j);
    joints.push({
      a: { pieceId: ports[c.i].pieceId, portId: ports[c.i].id },
      b: { pieceId: ports[c.j].pieceId, portId: ports[c.j].id },
    });
  }
  return joints;
}

/** Rigidly move a piece: rotate by dAngle about `pivot`, then translate by (dx, dy). */
function applyCorrection(p: PlacedPiece, pivot: Vec2, dx: number, dy: number, dAngle: number): PlacedPiece {
  const c = Math.cos(dAngle);
  const s = Math.sin(dAngle);
  const vx = p.x - pivot.x;
  const vy = p.y - pivot.y;
  const rx = vx * c - vy * s;
  const ry = vx * s + vy * c;
  return { ...p, x: pivot.x + rx + dx, y: pivot.y + ry + dy, rotation: p.rotation + dAngle };
}

/**
 * Gauss-Seidel relaxation: repeatedly nudge each joint's two pieces toward a
 * shared mating frame (coincident, anti-parallel), splitting the correction
 * between them by inverse "mass" (pinned pieces don't move). Iterating over the
 * whole joint graph spreads any closure error evenly around a loop, so the
 * assembly visibly flexes into place instead of leaving one impossible gap.
 */
export function relax(
  pieces: PlacedPiece[],
  joints: FlexJoint[],
  pinned: Set<string>,
  iterations: number = RELAX_ITERATIONS,
): PlacedPiece[] {
  const byId = new Map(pieces.map((p) => [p.id, { ...p }]));
  const portWorld = (pieceId: string, portId: string): WorldPort | undefined =>
    worldPorts(byId.get(pieceId)!).find((wp) => wp.id === portId);

  for (let iter = 0; iter < iterations; iter++) {
    for (const j of joints) {
      const a = portWorld(j.a.pieceId, j.a.portId);
      const b = portWorld(j.b.pieceId, j.b.portId);
      if (!a || !b) continue;
      const wa = pinned.has(j.a.pieceId) ? 0 : 1;
      const wb = pinned.has(j.b.pieceId) ? 0 : 1;
      const tot = wa + wb;
      if (tot === 0) continue;
      const fa = wa / tot;
      const fb = wb / tot;
      const phi = angleDiff(b.angle + Math.PI, a.angle); // rotation that makes A anti-parallel to B
      const gx = b.pos.x - a.pos.x;
      const gy = b.pos.y - a.pos.y;
      if (fa > 0) {
        byId.set(j.a.pieceId, applyCorrection(byId.get(j.a.pieceId)!, a.pos, gx * fa, gy * fa, phi * fa));
      }
      if (fb > 0) {
        byId.set(j.b.pieceId, applyCorrection(byId.get(j.b.pieceId)!, b.pos, -gx * fb, -gy * fb, -phi * fb));
      }
    }
  }
  return pieces.map((p) => byId.get(p.id)!);
}

// ConnectionMap holds one entry per connected port (each joint appears twice);
// the count is only used to compare before vs. after a relaxation pass.
function connectionCount(m: ConnectionMap): number {
  return m.size;
}

/**
 * Try to close near-miss joints by flexing the layout. `pinnedId` (the piece the
 * user is holding) stays put while everything else relaxes around it. The relaxed
 * result is only kept if it actually formed a new connection within the strict
 * joint-play limits -- otherwise the layout is left exactly as dropped, so a drag
 * that wasn't trying to close anything never disturbs other pieces.
 */
export function closeWithFlex(pieces: PlacedPiece[], pinnedId: string): PlacedPiece[] {
  const before = connectionCount(buildConnections(pieces));
  const ports = pieces.flatMap((p) => worldPorts(p));
  const joints = intendedJoints(ports);
  if (joints.length === 0) return pieces;
  const relaxed = relax(pieces, joints, new Set([pinnedId]));
  const after = connectionCount(buildConnections(relaxed));
  return after > before ? relaxed : pieces;
}
