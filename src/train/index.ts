// Train model + movement along the connected track network.
// A cursor is a position on a lane; advancing it walks the network, crossing
// joints and following the active branch at switches.

import { type Pose } from "../geometry";
import { type ConnectionMap, portKey } from "../network/connections";
import { defOf, laneLength, worldPoseAlongLane, type PlacedPiece } from "../track/placed";

export interface Cursor {
  pieceId: string;
  laneIndex: number;
  s: number; // arc-length from the lane's start (fromPort)
  dir: 1 | -1; // +1 toward lane end, -1 toward lane start
}

export interface Car {
  color: string;
  length: number;
  isEngine: boolean;
}

export interface Train {
  id: string;
  cars: Car[];
  cursor: Cursor;
}

const COUPLER_GAP = 12;
const ENGINE_LENGTH = 86;
const CAR_LENGTH = 64;

export function makeCars(engineColor: string, carColors: string[]): Car[] {
  return [
    { color: engineColor, length: ENGINE_LENGTH, isEngine: true },
    ...carColors.map((color) => ({ color, length: CAR_LENGTH, isEngine: false })),
  ];
}

type PieceLookup = Map<string, PlacedPiece>;

export function pieceLookup(pieces: PlacedPiece[]): PieceLookup {
  return new Map(pieces.map((p) => [p.id, p]));
}

/** Which lane/end of a piece a given port belongs to (resolving switch state). */
function laneForPort(
  piece: PlacedPiece,
  portId: string,
  switchState: number,
): { laneIndex: number; atFrom: boolean } | null {
  const def = defOf(piece);
  const matches: { laneIndex: number; atFrom: boolean }[] = [];
  def.lanes.forEach((lane, i) => {
    if (lane.from === portId) matches.push({ laneIndex: i, atFrom: true });
    if (lane.to === portId) matches.push({ laneIndex: i, atFrom: false });
  });
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // Multiple lanes share this port (a switch's single end) -> pick active branch.
  const active = def.switchLanes?.[switchState] ?? matches[0].laneIndex;
  return matches.find((m) => m.laneIndex === active) ?? matches[0];
}

function reverse(c: Cursor): Cursor {
  return { ...c, dir: c.dir === 1 ? -1 : 1 };
}

/** A piece the train entered while moving; `atFrom` false means it entered via a branch end. */
export interface Crossing {
  pieceId: string;
  laneIndex: number;
  atFrom: boolean;
}

/** Move a cursor forward (in its travel direction) by distance d >= 0. */
export function advance(
  start: Cursor,
  d: number,
  pieces: PieceLookup,
  conns: ConnectionMap,
): { cursor: Cursor; blocked: boolean; crossings: Crossing[] } {
  let cur: Cursor = { ...start };
  let remaining = d;
  let guard = 0;
  const crossings: Crossing[] = [];
  while (remaining > 1e-6 && guard++ < 2000) {
    const piece = pieces.get(cur.pieceId);
    if (!piece) return { cursor: cur, blocked: true, crossings };
    const len = laneLength(piece, cur.laneIndex);
    const u = cur.dir === 1 ? cur.s : len - cur.s; // distance from entry end
    const u2 = u + remaining;
    if (u2 <= len) {
      cur.s = cur.dir === 1 ? u2 : len - u2;
      return { cursor: cur, blocked: false, crossings };
    }
    // Reached the exit end of this lane.
    remaining = u2 - len;
    const def = defOf(piece);
    const lane = def.lanes[cur.laneIndex];
    const exitPort = cur.dir === 1 ? lane.to : lane.from;
    const conn = conns.get(portKey(cur.pieceId, exitPort));
    if (!conn) {
      cur.s = cur.dir === 1 ? len : 0; // clamp at the open end
      return { cursor: cur, blocked: true, crossings };
    }
    const next = pieces.get(conn.pieceId);
    if (!next) {
      cur.s = cur.dir === 1 ? len : 0;
      return { cursor: cur, blocked: true, crossings };
    }
    const entry = laneForPort(next, conn.portId, next.switchState);
    if (!entry) {
      cur.s = cur.dir === 1 ? len : 0;
      return { cursor: cur, blocked: true, crossings };
    }
    const nextLen = laneLength(next, entry.laneIndex);
    cur = {
      pieceId: next.id,
      laneIndex: entry.laneIndex,
      dir: entry.atFrom ? 1 : -1,
      s: entry.atFrom ? 0 : nextLen,
    };
    crossings.push({ pieceId: next.id, laneIndex: entry.laneIndex, atFrom: entry.atFrom });
  }
  return { cursor: cur, blocked: false, crossings };
}

export function cursorPoint(cur: Cursor, pieces: PieceLookup): Pose | null {
  const piece = pieces.get(cur.pieceId);
  if (!piece) return null;
  return worldPoseAlongLane(piece, cur.laneIndex, cur.s);
}

/** World point some distance behind the lead cursor (along the track). */
function pointBehind(lead: Cursor, back: number, pieces: PieceLookup, conns: ConnectionMap): Pose | null {
  if (back <= 0) return cursorPoint(lead, pieces);
  const { cursor } = advance(reverse(lead), back, pieces, conns);
  return cursorPoint(cursor, pieces);
}

export interface CarPose {
  x: number;
  y: number;
  heading: number;
  car: Car;
}

/** Compute world poses for every car of a train. */
export function trainCarPoses(train: Train, pieces: PieceLookup, conns: ConnectionMap): CarPose[] {
  const out: CarPose[] = [];
  let offset = 0; // distance from the train's front to the current car's front
  for (const car of train.cars) {
    const frontBack = offset;
    const rearBack = offset + car.length;
    const front = pointBehind(train.cursor, frontBack, pieces, conns);
    const rear = pointBehind(train.cursor, rearBack, pieces, conns);
    if (front && rear) {
      out.push({
        x: (front.x + rear.x) / 2,
        y: (front.y + rear.y) / 2,
        heading: Math.atan2(front.y - rear.y, front.x - rear.x),
        car,
      });
    }
    offset = rearBack + COUPLER_GAP;
  }
  return out;
}
