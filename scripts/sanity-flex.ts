// Throwaway sanity check for the hinge-residual solver + reworked findSnap.
// Run with: npx tsx scripts/sanity-flex.ts
import { buildConnections, findSnap } from "../src/network/connections";
import { closeWithFlex, relaxLayout } from "../src/network/relax";
import { worldPorts, type PlacedPiece } from "../src/track/placed";
import { angleDiff } from "../src/geometry";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function maxPoseDelta(a: PlacedPiece[], b: PlacedPiece[]): number {
  let m = 0;
  const byId = new Map(b.map((p) => [p.id, p]));
  for (const p of a) {
    const q = byId.get(p.id)!;
    m = Math.max(m, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(angleDiff(p.rotation, q.rotation)) * 100);
  }
  return m;
}

// --- Build a perfect 8-curve circle by chaining findSnap ---
let pieces: PlacedPiece[] = [
  { id: "c0", defId: "curve", x: 0, y: 0, rotation: 0, flipped: false, switchState: 0 },
];
for (let i = 1; i < 8; i++) {
  // Drop the next curve roughly at the free male port of the chain end; findSnap aligns it exactly.
  const free = pieces
    .flatMap((p) => worldPorts(p))
    .filter((wp) => !buildConnections(pieces).has(`${wp.pieceId}::${wp.id}`));
  const target = free.find((wp) => wp.gender === "M")!;
  const piece: PlacedPiece = {
    id: `c${i}`,
    defId: "curve",
    x: target.pos.x,
    y: target.pos.y,
    rotation: 0,
    flipped: false,
    switchState: 0,
  };
  const snap = findSnap(piece, pieces);
  if (snap) {
    piece.x = snap.x;
    piece.y = snap.y;
    piece.rotation = snap.rotation;
  }
  pieces = [...pieces, piece];
}
check("8-curve circle fully connects", buildConnections(pieces).size === 16, `${buildConnections(pieces).size}/16 port entries`);

// --- Hinge locality: relaxing a perfectly seated loop must not move anything ---
const relaxed = relaxLayout(pieces, "c0");
check("relax on seated loop is a no-op", maxPoseDelta(pieces, relaxed) < 1e-6, `delta=${maxPoseDelta(pieces, relaxed).toFixed(6)}mm`);

// --- Closure: displace one piece, pin it, and flex the rest shut ---
const broken = pieces.map((p) =>
  p.id === "c7" ? { ...p, x: p.x + 25, y: p.y + 10, rotation: p.rotation + (5 * Math.PI) / 180 } : p,
);
const beforeConns = buildConnections(broken).size;
check("displacing c7 breaks its joints", beforeConns < 16, `${beforeConns}/16 entries`);
const closed = closeWithFlex(broken, "c7");
const afterConns = buildConnections(closed).size;
check("closeWithFlex pulls the loop shut", afterConns === 16, `${afterConns}/16 entries`);
const pinned = closed.find((p) => p.id === "c7")!;
const brokenC7 = broken.find((p) => p.id === "c7")!;
check("pinned piece stays put", maxPoseDelta([brokenC7], [pinned]) < 1e-9);

// --- Idempotency: relaxing the just-closed loop again barely moves it ---
const again = relaxLayout(closed, "c7");
check("second relax is ~no-op", maxPoseDelta(closed, again) < 0.2, `delta=${maxPoseDelta(closed, again).toFixed(4)}mm`);

// --- findSnap hysteresis: held target survives a slightly better challenger ---
const tA: PlacedPiece = { id: "tA", defId: "straight-a", x: 0, y: 0, rotation: 0, flipped: false, switchState: 0 };
const tB: PlacedPiece = { id: "tB", defId: "straight-a", x: 0, y: 60, rotation: 0, flipped: false, switchState: 0 };
// Dragged piece sits between the two free male ports (at x=144, y 0 and 60), nearer to tB's.
const drag: PlacedPiece = { id: "d", defId: "straight-a", x: 144, y: 35, rotation: 0, flipped: false, switchState: 0 };
const fresh = findSnap(drag, [tA, tB]);
const stickyKeyA = fresh!.key.includes("tA") ? fresh!.key : fresh!.key.replace("tB", "tA");
const held = findSnap(drag, [tA, tB], { stickyKey: stickyKeyA });
check("fresh snap picks the nearer port (tB)", fresh!.key.includes("tB"), fresh!.key);
check("sticky key holds tA against a mildly better tB", held!.key.includes("tA"), held!.key);

process.exit(failures ? 1 : 0);
