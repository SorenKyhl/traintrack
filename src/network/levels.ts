// Compute the absolute elevation level of every placed piece by propagating
// per-port level offsets across joints. Flat pieces keep one level across both
// ends; an ascender shifts the level by +1. Each connected component is
// normalised so its lowest point sits on the ground (level 0).

import { defOf, type PlacedPiece } from "../track/placed";
import { portKey, type ConnectionMap } from "./connections";

/** Map of pieceId -> render level (the max port level of that piece). */
export function computeLevels(pieces: PlacedPiece[], conns: ConnectionMap): Map<string, number> {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const offsetOf = (pieceId: string, portId: string) =>
    defOf(byId.get(pieceId)!).ports.find((p) => p.id === portId)!.levelOffset;

  const base = new Map<string, number>(); // piece base level (level of its offset-0 ports)
  const visited = new Set<string>();

  for (const start of pieces) {
    if (visited.has(start.id)) continue;
    base.set(start.id, 0);
    visited.add(start.id);
    const queue = [start.id];
    const component: string[] = [start.id];

    while (queue.length) {
      const pid = queue.shift()!;
      for (const port of defOf(byId.get(pid)!).ports) {
        const conn = conns.get(portKey(pid, port.id));
        if (!conn || visited.has(conn.pieceId)) continue;
        // Connected ports share an absolute level:
        //   base[pid] + offset(port) == base[other] + offset(otherPort)
        const otherBase = base.get(pid)! + port.levelOffset - offsetOf(conn.pieceId, conn.portId);
        base.set(conn.pieceId, otherBase);
        visited.add(conn.pieceId);
        queue.push(conn.pieceId);
        component.push(conn.pieceId);
      }
    }

    // Normalise the component so its lowest port is at level 0.
    let min = Infinity;
    for (const pid of component)
      for (const port of defOf(byId.get(pid)!).ports) min = Math.min(min, base.get(pid)! + port.levelOffset);
    for (const pid of component) base.set(pid, base.get(pid)! - min);
  }

  // Render level = highest port of the piece (so ramps/bridges draw above ground).
  const levels = new Map<string, number>();
  for (const p of pieces) {
    const b = base.get(p.id) ?? 0;
    levels.set(p.id, Math.max(...defOf(p).ports.map((port) => b + port.levelOffset)));
  }
  return levels;
}
