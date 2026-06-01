import { angleDiff, dist } from "../geometry";
import {
  FLEX_CAPTURE_RADIUS,
  FLEX_CAPTURE_ANGLE_DEG,
  FLEX_GN_PASSES,
  FLEX_REGULARIZATION,
  FLEX_ANGLE_WEIGHT,
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

/** BFS over the joint graph; returns all piece IDs reachable from `startId`. */
function componentOf(startId: string, joints: FlexJoint[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const j of joints) {
    if (!adj.has(j.a.pieceId)) adj.set(j.a.pieceId, []);
    if (!adj.has(j.b.pieceId)) adj.set(j.b.pieceId, []);
    adj.get(j.a.pieceId)!.push(j.b.pieceId);
    adj.get(j.b.pieceId)!.push(j.a.pieceId);
  }
  const visited = new Set<string>([startId]);
  const queue = [startId];
  for (let qi = 0; qi < queue.length; qi++) {
    for (const nb of adj.get(queue[qi]) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  return visited;
}

/**
 * Gaussian elimination with partial pivoting. Solves A·x = b for an n×n system.
 * A is row-major (length n*n), b is length n. Returns x (length n).
 */
function solveSPD(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const w = n + 1;
  const M = new Float64Array(n * w);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i * w + j] = A[i * n + j];
    M[i * w + n] = b[i];
  }
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col * w + col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row * w + col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxRow !== col) {
      for (let j = 0; j <= n; j++) {
        const tmp = M[col * w + j];
        M[col * w + j] = M[maxRow * w + j];
        M[maxRow * w + j] = tmp;
      }
    }
    const pivot = M[col * w + col];
    if (Math.abs(pivot) < 1e-14) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row * w + col] / pivot;
      if (f === 0) continue;
      for (let j = col; j <= n; j++) M[row * w + j] -= f * M[col * w + j];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = M[i * w + i];
    x[i] = Math.abs(d) < 1e-14 ? 0 : M[i * w + n] / d;
  }
  return x;
}

/** Accumulate one constraint row into AᵀA and Aᵀc. */
function accumRow(
  AtA: Float64Array,
  Atc: Float64Array,
  n: number,
  row: [number, number][],
  rhs: number,
): void {
  for (const [ci, vi] of row) {
    Atc[ci] += vi * rhs;
    for (const [cj, vj] of row) {
      AtA[ci * n + cj] += vi * vj;
    }
  }
}

/**
 * Linearized least-squares loop-closure solver (Gauss–Newton).
 *
 * Each free piece gets a pose perturbation u = (Δx, Δy, Δθ). For each joint
 * linking port A on piece P to port B on piece Q, a small rotation Δθ about the
 * piece origin moves the port by Δθ·(−ry, rx) (the lever-arm term). Three
 * linearized rows per joint drive position and angle residuals toward zero.
 *
 * We solve: minimize ‖A·u − c‖² + λ‖u‖²  →  (AᵀA + λI)·u = Aᵀc
 *
 * The minimum-norm correction distributes the closure error as small rotations
 * spread evenly around the loop, so pieces leave the 45° grid and the loop
 * visibly flexes into place.
 */
function solveFlex(
  pieces: PlacedPiece[],
  joints: FlexJoint[],
  pinnedId: string,
): PlacedPiece[] {
  const byId = new Map(pieces.map((p) => [p.id, { ...p }]));

  const comp = componentOf(pinnedId, joints);
  const compJoints = joints.filter((j) => comp.has(j.a.pieceId) && comp.has(j.b.pieceId));

  const freeIds: string[] = [];
  const pieceIdx = new Map<string, number>();
  for (const id of comp) {
    if (id !== pinnedId) {
      pieceIdx.set(id, freeIds.length);
      freeIds.push(id);
    }
  }
  if (freeIds.length === 0) return pieces;

  const n = freeIds.length * 3;

  for (let pass = 0; pass < FLEX_GN_PASSES; pass++) {
    const AtA = new Float64Array(n * n);
    const Atc = new Float64Array(n);

    // Tikhonov regularization on the diagonal
    for (let i = 0; i < n; i++) AtA[i * n + i] = FLEX_REGULARIZATION;

    for (const j of compJoints) {
      const pA = byId.get(j.a.pieceId)!;
      const pB = byId.get(j.b.pieceId)!;
      const wA = worldPorts(pA).find((wp) => wp.id === j.a.portId);
      const wB = worldPorts(pB).find((wp) => wp.id === j.b.portId);
      if (!wA || !wB) continue;

      // Lever arms: world offset of each port from its piece origin
      const rxA = wA.pos.x - pA.x, ryA = wA.pos.y - pA.y;
      const rxB = wB.pos.x - pB.x, ryB = wB.pos.y - pB.y;

      const idxA = pieceIdx.get(j.a.pieceId);
      const idxB = pieceIdx.get(j.b.pieceId);

      // Jacobian rows for the 3 constraint equations.
      // Linearized: δportA − δportB = portB − portA
      // where δport = (Δx, Δy) + Δθ·(−ry, rx)
      const rowX: [number, number][] = [];
      const rowY: [number, number][] = [];
      const rowT: [number, number][] = [];
      if (idxA !== undefined) {
        const b3 = idxA * 3;
        rowX.push([b3, 1], [b3 + 2, -ryA]);
        rowY.push([b3 + 1, 1], [b3 + 2, rxA]);
        rowT.push([b3 + 2, FLEX_ANGLE_WEIGHT]);
      }
      if (idxB !== undefined) {
        const b3 = idxB * 3;
        rowX.push([b3, -1], [b3 + 2, ryB]);
        rowY.push([b3 + 1, -1], [b3 + 2, -rxB]);
        rowT.push([b3 + 2, -FLEX_ANGLE_WEIGHT]);
      }

      const errX = wB.pos.x - wA.pos.x;
      const errY = wB.pos.y - wA.pos.y;
      const errT = angleDiff(wB.angle + Math.PI, wA.angle) * FLEX_ANGLE_WEIGHT;

      accumRow(AtA, Atc, n, rowX, errX);
      accumRow(AtA, Atc, n, rowY, errY);
      accumRow(AtA, Atc, n, rowT, errT);
    }

    const u = solveSPD(AtA, Atc, n);

    // Bail if the solve produced NaN or a physically impossible jump
    for (let i = 0; i < freeIds.length; i++) {
      const dx = u[i * 3], dy = u[i * 3 + 1], dt = u[i * 3 + 2];
      if (!isFinite(dx) || !isFinite(dy) || !isFinite(dt)) return pieces;
      if (Math.abs(dx) > 500 || Math.abs(dy) > 500 || Math.abs(dt) > Math.PI) return pieces;
    }

    for (let i = 0; i < freeIds.length; i++) {
      const p = byId.get(freeIds[i])!;
      byId.set(freeIds[i], {
        ...p,
        x: p.x + u[i * 3],
        y: p.y + u[i * 3 + 1],
        rotation: p.rotation + u[i * 3 + 2],
      });
    }
  }

  return pieces.map((p) => byId.get(p.id)!);
}

function connectionCount(m: ConnectionMap): number {
  return m.size;
}

/**
 * Try to close near-miss joints by flexing the layout. `pinnedId` (the piece the
 * user is holding) stays put while everything else relaxes around it. The flexed
 * result is only kept if it actually formed a new connection within the strict
 * joint-play limits -- otherwise the layout is left exactly as dropped, so a drag
 * that wasn't trying to close anything never disturbs other pieces.
 */
export function closeWithFlex(pieces: PlacedPiece[], pinnedId: string): PlacedPiece[] {
  const before = connectionCount(buildConnections(pieces));
  const ports = pieces.flatMap((p) => worldPorts(p));
  const joints = intendedJoints(ports);
  if (joints.length === 0) return pieces;
  const flexed = solveFlex(pieces, joints, pinnedId);
  const after = connectionCount(buildConnections(flexed));
  return after > before ? flexed : pieces;
}

/**
 * Unconditional flex pass — runs the solver without the "did we gain a connection"
 * gate. Use this for explicit user-triggered relaxation (the Relax button) where
 * the intent is to tighten up the existing layout regardless of whether the
 * connection count changes.
 */
export function relaxLayout(pieces: PlacedPiece[], pinnedId: string): PlacedPiece[] {
  const ports = pieces.flatMap((p) => worldPorts(p));
  const joints = intendedJoints(ports);
  if (joints.length === 0) return pieces;
  return solveFlex(pieces, joints, pinnedId);
}

/**
 * Count how many intended joints (within FLEX_CAPTURE_RADIUS) involve piece `id`.
 * Uses the same loose tolerance as the flex solver — lets the snap guard correctly
 * detect interior pieces of a relaxed loop even when strict joint tolerance hasn't
 * been reached yet.
 */
export function intendedConnectionCount(id: string, pieces: PlacedPiece[]): number {
  const ports = pieces.flatMap((p) => worldPorts(p));
  const joints = intendedJoints(ports);
  return joints.filter((j) => j.a.pieceId === id || j.b.pieceId === id).length;
}
