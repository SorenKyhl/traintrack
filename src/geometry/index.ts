// Core 2D geometry: vectors, poses, and line/arc segment math.
// Screen convention: x right, y down. Angle is the direction of travel,
// so the heading vector is (cos a, sin a); increasing angle rotates clockwise on screen.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  heading: number; // radians, direction of travel
}

export const DEG = Math.PI / 180;
export const TWO_PI = Math.PI * 2;

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Smallest signed difference a-b wrapped to (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

// --- Track segments ---
// A lane is built from an ordered list of segments starting from a known pose.

export type Segment =
  | { kind: "line"; length: number }
  | { kind: "arc"; radius: number; sweepDeg: number; sign: 1 | -1 }; // sign: +1 / -1 curve direction

export function segLength(seg: Segment): number {
  return seg.kind === "line" ? seg.length : seg.radius * Math.abs(seg.sweepDeg) * DEG;
}

/** Pose at arc-length t (0..length) into a single segment that begins at `start`. */
export function poseInSegment(seg: Segment, start: Pose, t: number): Pose {
  if (seg.kind === "line") {
    return {
      x: start.x + Math.cos(start.heading) * t,
      y: start.y + Math.sin(start.heading) * t,
      heading: start.heading,
    };
  }
  // arc
  const s = seg.sign;
  const r = seg.radius;
  // Center is perpendicular to heading, on the side we turn toward.
  const nAngle = start.heading + (s * Math.PI) / 2;
  const cx = start.x + r * Math.cos(nAngle);
  const cy = start.y + r * Math.sin(nAngle);
  // Radius vector C->point starts pointing opposite the center offset.
  const beta0 = nAngle + Math.PI;
  const beta = beta0 + (s * t) / r;
  return {
    x: cx + r * Math.cos(beta),
    y: cy + r * Math.sin(beta),
    heading: start.heading + (s * t) / r,
  };
}

/** Pose at arc-length s along a chain of segments starting from `start`. Clamps to [0, total]. */
export function poseAlong(segments: Segment[], start: Pose, s: number): Pose {
  let remaining = Math.max(0, s);
  let pose = start;
  for (const seg of segments) {
    const len = segLength(seg);
    if (remaining <= len) {
      return poseInSegment(seg, pose, remaining);
    }
    pose = poseInSegment(seg, pose, len);
    remaining -= len;
  }
  return pose; // past the end -> clamp at final pose
}

export function totalLength(segments: Segment[]): number {
  return segments.reduce((a, s) => a + segLength(s), 0);
}

/** Sample a chain of segments into points for rendering. */
export function sampleChain(segments: Segment[], start: Pose, step = 8): Pose[] {
  const total = totalLength(segments);
  const out: Pose[] = [];
  const n = Math.max(2, Math.ceil(total / step));
  for (let i = 0; i <= n; i++) {
    out.push(poseAlong(segments, start, (total * i) / n));
  }
  return out;
}
