// Connector geometry (in mm), expressed in a port's local frame where the port
// sits at the origin and +x points OUT of the piece.
//   Male  = a mushroom peg (narrow neck + round head) extending out (+x).
//   Female = the matching cavity carved into the end (-x): slot + round hole.

export const CONN = {
  neckLen: 8, // length of the neck
  neckHalf: 4.5, // half-width of the neck
  headR: 6, // radius of the round head
  headCx: 12.5, // distance from the end to the head center
};

/** Four corners of the neck rectangle for the given gender, in port-local mm. */
export function neckCorners(gender: "M" | "F"): [number, number][] {
  const dir = gender === "M" ? 1 : -1;
  const x0 = gender === "M" ? -1 : 1; // overlap the body edge slightly
  const x1 = dir * CONN.neckLen;
  return [
    [x0, -CONN.neckHalf],
    [x1, -CONN.neckHalf],
    [x1, CONN.neckHalf],
    [x0, CONN.neckHalf],
  ];
}

/** Head circle center x (port-local) for the given gender. */
export function headCenterX(gender: "M" | "F"): number {
  return (gender === "M" ? 1 : -1) * CONN.headCx;
}
