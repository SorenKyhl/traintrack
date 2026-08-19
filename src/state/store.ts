import { create } from "zustand";
import {
  DEFAULT_SCALE,
  DEFAULT_SPEED,
  RELAX_ANIM_MS,
  SNAP_CAPTURE_MIN,
  SNAP_CAPTURE_RADIUS,
  SNAP_CAPTURE_SCREEN_PX,
  TRACK_WIDTH,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../track/constants";
import { DEF_BY_ID, portsForDef } from "../track/defs";
import {
  defOf,
  laneLength,
  worldLaneSamples,
  worldPorts,
  type PlacedPiece,
} from "../track/placed";
import {
  buildConnections,
  findSnap,
  portKey,
  type ConnectionMap,
  type SnapCandidate,
} from "../network/connections";
import { closeWithFlex, relaxLayout, intendedConnectionCount } from "../network/relax";
import { computeLevels } from "../network/levels";
import { advance, makeCars, pieceLookup, type Cursor, type Train } from "../train";
import { angleDiff, dist } from "../geometry";
import { writeSlot, getSlot } from "./saves";

const ENGINE_COLORS = ["#1565c0", "#c62828", "#2e7d32", "#6a1b9a", "#ef6c00"];
const CAR_COLORS = ["#e53935", "#fdd835", "#43a047", "#8e24aa"];

interface View {
  scale: number;
  x: number; // pan offset (px)
  y: number;
}

interface LayoutSnapshot {
  pieces: PlacedPiece[];
  trains: Train[];
}

interface StoreState {
  pieces: PlacedPiece[];
  trains: Train[];
  connections: ConnectionMap;
  levels: Map<string, number>; // pieceId -> render elevation level
  selectedId: string | null;
  running: boolean;
  speed: number;
  view: View;
  deleteArmed: boolean; // true while a dragged piece is hovering the palette (release = delete)
  // Ghost pose shown while a dragged piece is near a free compatible port. The
  // piece itself follows the cursor; the snap is only committed on release.
  snapPreview: ({ pieceId: string } & SnapCandidate) | null;

  addPiece: (defId: string, x: number, y: number) => void;
  movePiece: (id: string, x: number, y: number) => void;
  dragMove: (id: string, x: number, y: number) => void;
  endDrag: (id: string) => void;
  select: (id: string | null) => void;
  rotateSelected: (deltaDeg: number) => void;
  flipSelected: () => void;
  deleteSelected: () => void;
  deletePiece: (id: string) => void;
  setDeleteArmed: (v: boolean) => void;
  toggleSwitch: (id: string) => void;
  addTrain: (x: number, y: number, length: number) => void;
  setRunning: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setView: (v: Partial<View>) => void;
  fitView: (viewportW: number, viewportH: number) => void;
  relax: () => void;
  clear: () => void;
  tick: (dt: number) => void;
  saveAs: (name: string) => void;
  loadSlot: (id: string) => void;
  exportJSON: () => string;
  importJSON: (json: string) => void;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

/** Recompute the connection graph and elevation levels for a set of pieces. */
function derive(pieces: PlacedPiece[]): { connections: ConnectionMap; levels: Map<string, number> } {
  const connections = buildConnections(pieces);
  return { connections, levels: computeLevels(pieces, connections) };
}

type SetState = (partial: Partial<StoreState>) => void;

let animRaf = 0;
function cancelAnim(): void {
  if (animRaf) {
    cancelAnimationFrame(animRaf);
    animRaf = 0;
  }
}

/**
 * Tween piece poses from their current values to `target` over RELAX_ANIM_MS so
 * snap/relax corrections read as the track flexing into place rather than
 * teleporting. Connections and levels are derived from the final poses and
 * committed when the tween lands; any user mutation cancels an in-flight tween.
 */
function animatePiecesTo(set: SetState, from: PlacedPiece[], target: PlacedPiece[]): void {
  cancelAnim();
  const final = { pieces: target, ...derive(target) };
  const fromById = new Map(from.map((p) => [p.id, p]));
  let maxMove = 0;
  for (const p of target) {
    const f = fromById.get(p.id);
    if (!f) continue;
    maxMove = Math.max(
      maxMove,
      Math.abs(p.x - f.x),
      Math.abs(p.y - f.y),
      Math.abs(angleDiff(p.rotation, f.rotation)) * 100, // ~mm at a 100mm lever arm
    );
  }
  if (maxMove < 0.5) {
    set(final);
    return;
  }
  const t0 = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / RELAX_ANIM_MS);
    if (t >= 1) {
      animRaf = 0;
      set(final);
      return;
    }
    const e = 1 - (1 - t) ** 3; // ease-out cubic
    set({
      pieces: target.map((p) => {
        const f = fromById.get(p.id);
        if (!f) return p;
        return {
          ...p,
          x: f.x + (p.x - f.x) * e,
          y: f.y + (p.y - f.y) * e,
          rotation: f.rotation + angleDiff(p.rotation, f.rotation) * e,
        };
      }),
    });
    animRaf = requestAnimationFrame(step);
  };
  animRaf = requestAnimationFrame(step);
}

export const useStore = create<StoreState>((set, get) => ({
  pieces: [],
  trains: [],
  connections: new Map(),
  levels: new Map(),
  selectedId: null,
  running: false,
  speed: DEFAULT_SPEED,
  view: { scale: DEFAULT_SCALE, x: 360, y: 280 },
  deleteArmed: false,
  snapPreview: null,

  addPiece: (defId, x, y) => {
    cancelAnim();
    if (!DEF_BY_ID[defId]) return;
    const piece: PlacedPiece = { id: newId("piece"), defId, x, y, rotation: 0, flipped: false, switchState: 0 };
    const snap = findSnap(piece, get().pieces);
    if (snap) {
      piece.x = snap.x;
      piece.y = snap.y;
      piece.rotation = snap.rotation;
    }
    // Drop it, then let the rest of the layout flex to close any near-miss joint
    // (e.g. dropping the last piece into a loop). The new piece stays put.
    const dropped = [...get().pieces, piece];
    set({ pieces: dropped, ...derive(dropped), selectedId: piece.id });
    animatePiecesTo(set, dropped, closeWithFlex(dropped, piece.id));
  },

  movePiece: (id, x, y) => {
    cancelAnim();
    const pieces = get().pieces.map((p) => (p.id === id ? { ...p, x, y } : p));
    set({ pieces });
  },

  // Live drag: the piece follows the pointer faithfully. When a free compatible
  // joint is in capture range we only publish a ghost preview of the snapped
  // pose (`snapPreview`); the snap is committed on release in endDrag. Capture
  // range is screen-space so it feels the same at any zoom, and the previous
  // preview's key gives findSnap hysteresis so the ghost never flickers between
  // rival ports.
  dragMove: (id, x, y) => {
    cancelAnim();
    const prev = get();
    const pieces = prev.pieces.map((p) => (p.id === id ? { ...p, x, y } : p));
    const piece = pieces.find((p) => p.id === id);
    if (!piece) return;
    let snapPreview: StoreState["snapPreview"] = null;
    // Interior pieces of a relaxed loop have ≥ 2 intended connections — they are
    // seated, so previewing a single-port snap would only suggest breaking the
    // other joint. Preview resumes once the piece is pulled clear.
    if (intendedConnectionCount(id, pieces) < 2) {
      const captureRadius = Math.min(
        SNAP_CAPTURE_RADIUS,
        Math.max(SNAP_CAPTURE_MIN, SNAP_CAPTURE_SCREEN_PX / prev.view.scale),
      );
      const stickyKey = prev.snapPreview?.pieceId === id ? prev.snapPreview.key : undefined;
      const snap = findSnap(piece, pieces.filter((p) => p.id !== id), { captureRadius, stickyKey });
      if (snap) snapPreview = { pieceId: id, ...snap };
    }
    set({ pieces, snapPreview });
  },

  endDrag: (id) => {
    cancelAnim();
    const { pieces, snapPreview } = get();
    const piece = pieces.find((p) => p.id === id);
    if (!piece) return;
    // Commit the previewed snap (the ghost the user saw is the single source of
    // truth for the drop pose).
    let snapped = pieces;
    if (snapPreview && snapPreview.pieceId === id) {
      const candidate = pieces.map((p) =>
        p.id === id ? { ...p, x: snapPreview.x, y: snapPreview.y, rotation: snapPreview.rotation } : p,
      );
      // Use loose-tolerance intended count (same as flex solver) rather than strict
      // connection count. Strict count misses joints that the solver relaxed to
      // 10-20mm — within flex range but outside the 9mm strict tolerance — causing
      // the guard to incorrectly allow a snap that breaks the intended connection.
      const before = intendedConnectionCount(id, pieces);
      const after = intendedConnectionCount(id, candidate);
      if (after >= before) snapped = candidate;
    }
    // Hold the piece the user dropped fixed and flex the rest of the layout to
    // pull any near-miss joints shut -- this is what lets a loop actually close.
    const next = closeWithFlex(snapped, id);
    set({ snapPreview: null });
    animatePiecesTo(set, pieces, next);
  },

  select: (id) => set({ selectedId: id }),

  rotateSelected: (deltaDeg) => {
    const id = get().selectedId;
    if (!id) return;
    const pieces = get().pieces.map((p) =>
      p.id === id ? { ...p, rotation: p.rotation + (deltaDeg * Math.PI) / 180 } : p,
    );
    set({ pieces, ...derive(pieces) });
  },

  flipSelected: () => {
    const id = get().selectedId;
    if (!id) return;
    const piece = get().pieces.find((p) => p.id === id);
    if (!piece) return;
    const connections = get().connections;
    const connected = worldPorts(piece).filter((wp) => connections.has(portKey(id, wp.id)));

    if (connected.length === 1) {
      // Pivot the flip about the single connected port so the joint is preserved.
      const conn = connections.get(portKey(id, connected[0].id))!;
      const targetPiece = get().pieces.find((p) => p.id === conn.pieceId);
      if (!targetPiece) {
        const pieces = get().pieces.map((p) => (p.id === id ? { ...p, flipped: !p.flipped } : p));
        set({ pieces, ...derive(pieces) });
        return;
      }
      const targetPort = worldPorts(targetPiece).find((wp) => wp.id === conn.portId)!;
      const newFlipped = !piece.flipped;
      const localPort = portsForDef(defOf(piece)).find((p) => p.id === connected[0].id)!;
      // Flip the local port coordinates to match the new flip state.
      const lx = localPort.pos.x;
      const ly = newFlipped ? -localPort.pos.y : localPort.pos.y;
      const lh = newFlipped ? -localPort.angle : localPort.angle;
      // Solve (rotation, x, y) so the flipped port sits anti-parallel on the target.
      const rotation = targetPort.angle + Math.PI - lh;
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      const x = targetPort.pos.x - lx * cosR + ly * sinR;
      const y = targetPort.pos.y - lx * sinR - ly * cosR;
      const pieces = get().pieces.map((p) => (p.id === id ? { ...p, flipped: newFlipped, x, y, rotation } : p));
      set({ pieces, ...derive(pieces) });
    } else {
      const pieces = get().pieces.map((p) => (p.id === id ? { ...p, flipped: !p.flipped } : p));
      set({ pieces, ...derive(pieces) });
    }
  },

  deleteSelected: () => {
    const id = get().selectedId;
    if (id) get().deletePiece(id);
  },

  deletePiece: (id) => {
    cancelAnim();
    const pieces = get().pieces.filter((p) => p.id !== id);
    set({
      pieces,
      ...derive(pieces),
      selectedId: get().selectedId === id ? null : get().selectedId,
      deleteArmed: false,
      snapPreview: null,
      trains: get().trains.filter((t) => pieces.some((p) => p.id === t.cursor.pieceId)),
    });
  },

  setDeleteArmed: (v) => {
    if (get().deleteArmed !== v) set({ deleteArmed: v });
  },

  toggleSwitch: (id) => {
    const pieces = get().pieces.map((p) => {
      if (p.id !== id) return p;
      const def = DEF_BY_ID[p.defId];
      const n = def.switchLanes?.length ?? 1;
      return { ...p, switchState: (p.switchState + 1) % n };
    });
    set({ pieces });
  },

  addTrain: (x, y, length) => {
    // Find the nearest lane sample across all pieces and drop the train there.
    let best: { cursor: Cursor; d: number } | null = null;
    for (const piece of get().pieces) {
      const def = DEF_BY_ID[piece.defId];
      for (let laneIndex = 0; laneIndex < def.lanes.length; laneIndex++) {
        const samples = worldLaneSamples(piece, laneIndex);
        const total = laneLength(piece, laneIndex);
        for (let i = 0; i < samples.length; i++) {
          const d = dist(samples[i], { x, y });
          if (!best || d < best.d) {
            best = {
              d,
              cursor: { pieceId: piece.id, laneIndex, s: (total * i) / (samples.length - 1), dir: 1 },
            };
          }
        }
      }
    }
    if (!best) return;
    const engine = ENGINE_COLORS[get().trains.length % ENGINE_COLORS.length];
    const cars = Array.from({ length: Math.max(0, length - 1) }, (_, i) => CAR_COLORS[i % CAR_COLORS.length]);
    const train: Train = { id: newId("train"), cars: makeCars(engine, cars), cursor: best.cursor };
    set({ trains: [...get().trains, train] });
  },

  setRunning: (v) => set({ running: v }),
  setSpeed: (v) => set({ speed: v }),
  setView: (v) => set({ view: { ...get().view, ...v } }),

  fitView: (viewportW, viewportH) => {
    const { pieces } = get();
    if (pieces.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const piece of pieces) {
      defOf(piece).lanes.forEach((_, laneIndex) => {
        for (const p of worldLaneSamples(piece, laneIndex)) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      });
    }
    // Pad for half the track width plus connector protrusion so pegs/sockets aren't clipped.
    const pad = TRACK_WIDTH;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(viewportW / (maxX - minX), viewportH / (maxY - minY))));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    set({ view: { scale, x: viewportW / 2 - cx * scale, y: viewportH / 2 - cy * scale } });
  },

  relax: () => {
    cancelAnim();
    const { pieces, selectedId } = get();
    if (pieces.length === 0) return;
    const pinnedId = selectedId ?? pieces[0].id;
    animatePiecesTo(set, pieces, relaxLayout(pieces, pinnedId));
  },

  clear: () => {
    cancelAnim();
    set({ pieces: [], trains: [], connections: new Map(), levels: new Map(), selectedId: null, running: false, snapPreview: null });
  },

  tick: (dt) => {
    const state = get();
    if (!state.running || state.trains.length === 0) return;
    const pieces = pieceLookup(state.pieces);
    const conns = state.connections;
    const d = state.speed * dt;
    const stateById = new Map(state.pieces.map((p) => [p.id, p.switchState]));
    const switchUpdates = new Map<string, number>();
    const trains = state.trains.map((t) => {
      const { cursor, blocked, crossings } = advance(t.cursor, d, pieces, conns);
      // When the lead drives through a switch via a branch, throw the points to
      // that branch so the trailing cars follow the same route (not the old set one).
      for (const c of crossings) {
        if (c.atFrom) continue;
        const def = DEF_BY_ID[pieces.get(c.pieceId)!.defId];
        const st = def.switchLanes?.indexOf(c.laneIndex) ?? -1;
        if (st >= 0 && stateById.get(c.pieceId) !== st) switchUpdates.set(c.pieceId, st);
      }
      if (blocked) {
        return { ...t, cursor: { ...cursor, dir: (cursor.dir === 1 ? -1 : 1) as 1 | -1 } };
      }
      return { ...t, cursor };
    });
    if (switchUpdates.size) {
      const updatedPieces = state.pieces.map((p) =>
        switchUpdates.has(p.id) ? { ...p, switchState: switchUpdates.get(p.id)! } : p,
      );
      set({ trains, pieces: updatedPieces });
    } else {
      set({ trains });
    }
  },

  saveAs: (name) => {
    const { pieces, trains } = get();
    writeSlot({ name, savedAt: Date.now(), pieces, trains });
  },

  loadSlot: (id) => {
    cancelAnim();
    const slot = getSlot(id);
    if (!slot) return;
    set({ pieces: slot.pieces, trains: slot.trains, ...derive(slot.pieces), selectedId: null, snapPreview: null });
  },

  exportJSON: () => JSON.stringify({ pieces: get().pieces, trains: get().trains } satisfies LayoutSnapshot, null, 2),

  importJSON: (json) => {
    try {
      const snap = JSON.parse(json) as LayoutSnapshot;
      if (!Array.isArray(snap.pieces)) return;
      cancelAnim();
      set({
        pieces: snap.pieces,
        trains: snap.trains ?? [],
        ...derive(snap.pieces),
        selectedId: null,
        snapPreview: null,
      });
    } catch {
      /* ignore */
    }
  },
}));
