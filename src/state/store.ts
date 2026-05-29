import { create } from "zustand";
import { DEFAULT_SCALE, DEFAULT_SPEED } from "../track/constants";
import { DEF_BY_ID } from "../track/defs";
import {
  laneLength,
  worldLaneSamples,
  type PlacedPiece,
} from "../track/placed";
import { buildConnections, findSnap, type ConnectionMap } from "../network/connections";
import { computeLevels } from "../network/levels";
import { advance, makeCars, pieceLookup, type Cursor, type Train } from "../train";
import { dist } from "../geometry";

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
  clear: () => void;
  tick: (dt: number) => void;
  save: () => void;
  load: () => void;
  exportJSON: () => string;
  importJSON: (json: string) => void;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

const STORAGE_KEY = "traintrack-layout-v1";

/** Recompute the connection graph and elevation levels for a set of pieces. */
function derive(pieces: PlacedPiece[]): { connections: ConnectionMap; levels: Map<string, number> } {
  const connections = buildConnections(pieces);
  return { connections, levels: computeLevels(pieces, connections) };
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

  addPiece: (defId, x, y) => {
    if (!DEF_BY_ID[defId]) return;
    const piece: PlacedPiece = { id: newId("piece"), defId, x, y, rotation: 0, flipped: false, switchState: 0 };
    const snap = findSnap(piece, get().pieces);
    if (snap) Object.assign(piece, snap);
    const pieces = [...get().pieces, piece];
    set({ pieces, ...derive(pieces), selectedId: piece.id });
  },

  movePiece: (id, x, y) => {
    const pieces = get().pieces.map((p) => (p.id === id ? { ...p, x, y } : p));
    set({ pieces });
  },

  // Live drag: follow the pointer, but click into a connected pose (position +
  // rotation) whenever a free compatible joint is within capture range.
  dragMove: (id, x, y) => {
    const pieces = get().pieces;
    const piece = pieces.find((p) => p.id === id);
    if (!piece) return;
    const moved = { ...piece, x, y };
    const snap = findSnap(moved, pieces.filter((p) => p.id !== id));
    const result = snap ? { ...moved, ...snap } : moved;
    set({ pieces: pieces.map((p) => (p.id === id ? result : p)) });
  },

  endDrag: (id) => {
    const pieces = get().pieces;
    const piece = pieces.find((p) => p.id === id);
    if (!piece) return;
    const others = pieces.filter((p) => p.id !== id);
    const snap = findSnap(piece, others);
    const updated = snap ? { ...piece, ...snap } : piece;
    const next = pieces.map((p) => (p.id === id ? updated : p));
    set({ pieces: next, ...derive(next) });
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
    const pieces = get().pieces.map((p) => (p.id === id ? { ...p, flipped: !p.flipped } : p));
    set({ pieces, ...derive(pieces) });
  },

  deleteSelected: () => {
    const id = get().selectedId;
    if (id) get().deletePiece(id);
  },

  deletePiece: (id) => {
    const pieces = get().pieces.filter((p) => p.id !== id);
    set({
      pieces,
      ...derive(pieces),
      selectedId: get().selectedId === id ? null : get().selectedId,
      deleteArmed: false,
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

  clear: () => set({ pieces: [], trains: [], connections: new Map(), levels: new Map(), selectedId: null, running: false }),

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

  save: () => {
    const { pieces, trains } = get();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pieces, trains } satisfies LayoutSnapshot));
  },

  load: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const snap = JSON.parse(raw) as LayoutSnapshot;
      set({ pieces: snap.pieces, trains: snap.trains, ...derive(snap.pieces), selectedId: null });
    } catch {
      /* ignore corrupt save */
    }
  },

  exportJSON: () => JSON.stringify({ pieces: get().pieces, trains: get().trains } satisfies LayoutSnapshot, null, 2),

  importJSON: (json) => {
    try {
      const snap = JSON.parse(json) as LayoutSnapshot;
      if (!Array.isArray(snap.pieces)) return;
      set({
        pieces: snap.pieces,
        trains: snap.trains ?? [],
        ...derive(snap.pieces),
        selectedId: null,
      });
    } catch {
      /* ignore */
    }
  },
}));
