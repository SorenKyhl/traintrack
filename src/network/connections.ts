// Connection graph + elastic snapping. Two ports connect when they are opposite
// gender, same level, positionally close, and anti-parallel — within generous
// tolerances that reproduce the real BRIO joint "play" (wiggle room).

import {
  JOINT_ANGLE_TOLERANCE_DEG,
  JOINT_GAP_TOLERANCE,
  SNAP_ANGLE_WEIGHT,
  SNAP_CAPTURE_RADIUS,
  SNAP_RELEASE_FACTOR,
  SNAP_STICKY_ADVANTAGE,
} from "../track/constants";
import { angleDiff, DEG, dist } from "../geometry";
import { portsForDef } from "../track/defs";
import { defOf, worldPorts, type PlacedPiece, type WorldPort } from "../track/placed";

export function portKey(pieceId: string, portId: string): string {
  return `${pieceId}::${portId}`;
}

/** True if two world ports may join (opposite gender, close, anti-parallel). */
function portsConnect(a: WorldPort, b: WorldPort): { ok: boolean; cost: number } {
  if (a.gender === b.gender) return { ok: false, cost: Infinity };
  const gap = dist(a.pos, b.pos);
  if (gap > JOINT_GAP_TOLERANCE) return { ok: false, cost: Infinity };
  // anti-parallel: a.angle ~= b.angle + PI
  const angErr = Math.abs(angleDiff(a.angle, b.angle + Math.PI));
  if (angErr > JOINT_ANGLE_TOLERANCE_DEG * DEG) return { ok: false, cost: Infinity };
  return { ok: true, cost: gap + angErr * 30 };
}

export type ConnectionMap = Map<string, { pieceId: string; portId: string }>;

/** Build the global connection graph via greedy nearest-compatible matching. */
export function buildConnections(pieces: PlacedPiece[]): ConnectionMap {
  const ports: WorldPort[] = pieces.flatMap((p) => worldPorts(p));
  const pairs: { i: number; j: number; cost: number }[] = [];
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      if (ports[i].pieceId === ports[j].pieceId) continue;
      const { ok, cost } = portsConnect(ports[i], ports[j]);
      if (ok) pairs.push({ i, j, cost });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const used = new Set<number>();
  const map: ConnectionMap = new Map();
  for (const { i, j } of pairs) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i);
    used.add(j);
    map.set(portKey(ports[i].pieceId, ports[i].id), { pieceId: ports[j].pieceId, portId: ports[j].id });
    map.set(portKey(ports[j].pieceId, ports[j].id), { pieceId: ports[i].pieceId, portId: ports[i].id });
  }
  return map;
}

function rot(x: number, y: number, r: number): { x: number; y: number } {
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

export interface SnapCandidate {
  x: number;
  y: number;
  rotation: number;
  /** Stable identity of this mating (dragged port -> target port), used for drag hysteresis. */
  key: string;
  /** World position of the target port, for preview highlighting. */
  targetPos: { x: number; y: number };
  score: number;
}

/**
 * Find the best snap pose for a dragged piece: align one of its ports onto a
 * nearby free, compatible port of another piece. Candidates are scored by
 * gap + required rotation change, so the mating that respects how the user is
 * currently holding the piece wins over a merely-nearer port.
 *
 * Pass the previous result's `key` as `stickyKey` for hysteresis during a drag:
 * the held target stays captured out to SNAP_RELEASE_FACTOR × captureRadius and
 * only loses to a challenger that beats its score decisively
 * (SNAP_STICKY_ADVANTAGE), so the snap never flickers between rival ports.
 */
export function findSnap(
  piece: PlacedPiece,
  others: PlacedPiece[],
  opts?: { captureRadius?: number; stickyKey?: string },
): SnapCandidate | null {
  const captureRadius = opts?.captureRadius ?? SNAP_CAPTURE_RADIUS;
  const releaseRadius = captureRadius * SNAP_RELEASE_FACTOR;
  const occupied = new Set<string>();
  const conns = buildConnections(others);
  for (const k of conns.keys()) occupied.add(k);

  const targets: WorldPort[] = others
    .flatMap((p) => worldPorts(p))
    .filter((t) => !occupied.has(portKey(t.pieceId, t.id)));

  const draggedWorld = worldPorts(piece);
  const defPorts = portsForDef(defOf(piece));

  let best: SnapCandidate | null = null;
  let sticky: SnapCandidate | null = null;

  for (let idx = 0; idx < draggedWorld.length; idx++) {
    const dw = draggedWorld[idx];
    const local = defPorts[idx]; // local pos/angle (pre-flip)
    let ly = local.pos.y;
    let lh = local.angle;
    const lx = local.pos.x;
    if (piece.flipped) {
      ly = -ly;
      lh = -lh;
    }
    for (const t of targets) {
      if (dw.gender === t.gender) continue;
      const key = `${dw.id}->${portKey(t.pieceId, t.id)}`;
      const isSticky = key === opts?.stickyKey;
      const d = dist(dw.pos, t.pos);
      if (d > (isSticky ? releaseRadius : captureRadius)) continue;
      // Solve transform so the dragged port lands exactly anti-parallel on t.
      const rotation = t.angle + Math.PI - lh;
      const offset = rot(lx, ly, rotation);
      const score = d + Math.abs(angleDiff(rotation, piece.rotation)) * SNAP_ANGLE_WEIGHT;
      const cand: SnapCandidate = {
        x: t.pos.x - offset.x,
        y: t.pos.y - offset.y,
        rotation,
        key,
        targetPos: { x: t.pos.x, y: t.pos.y },
        score,
      };
      if (isSticky) sticky = cand;
      if (!best || score < best.score) best = cand;
    }
  }

  if (sticky && best && best.key !== sticky.key && best.score >= sticky.score * SNAP_STICKY_ADVANTAGE) {
    return sticky;
  }
  return best;
}
