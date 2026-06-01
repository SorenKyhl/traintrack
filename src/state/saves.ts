import type { PlacedPiece } from "../track/placed";
import type { Train } from "../train";

export interface SaveSlot {
  id: string;
  name: string;
  savedAt: number;
  pieces: PlacedPiece[];
  trains: Train[];
}

const SAVES_KEY = "traintrack-saves-v1";
const LEGACY_KEY = "traintrack-layout-v1";

function readAll(): Record<string, SaveSlot> {
  const raw = localStorage.getItem(SAVES_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  // One-time migration from the old single-slot storage
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const snap = JSON.parse(legacy) as { pieces: PlacedPiece[]; trains?: Train[] };
      if (Array.isArray(snap.pieces) && snap.pieces.length > 0) {
        const slot: SaveSlot = {
          id: "save-migrated",
          name: "Recovered layout",
          savedAt: Date.now(),
          pieces: snap.pieces,
          trains: snap.trains ?? [],
        };
        const slots = { [slot.id]: slot };
        localStorage.setItem(SAVES_KEY, JSON.stringify(slots));
        return slots;
      }
    } catch { /* ignore */ }
  }
  return {};
}

function writeAll(slots: Record<string, SaveSlot>): void {
  localStorage.setItem(SAVES_KEY, JSON.stringify(slots));
}

export function listSlots(): SaveSlot[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt - a.savedAt);
}

export function getSlot(id: string): SaveSlot | null {
  return readAll()[id] ?? null;
}

export function writeSlot(slot: Omit<SaveSlot, "id">): SaveSlot {
  const all = readAll();
  const id = `save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const full: SaveSlot = { ...slot, id };
  all[id] = full;
  writeAll(all);
  return full;
}

export function removeSlot(id: string): void {
  const all = readAll();
  delete all[id];
  writeAll(all);
}
