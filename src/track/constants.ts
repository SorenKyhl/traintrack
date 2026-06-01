// Real wooden-railway (BRIO-compatible) dimensions, in millimeters.
// These are the source of truth for all piece geometry. See plan / memory.

export const MM = 1; // world unit is a millimeter

// Track body profile
export const TRACK_WIDTH = 40; // body width
export const GROOVE_CENTER_OFFSET = 13; // grooves at +/-13mm (26mm center-to-center)
export const GROOVE_WIDTH = 6;

// Standard straight lengths
export const STRAIGHT_A2 = 54;
export const STRAIGHT_A1 = 108;
export const STRAIGHT_A = 144; // the standard piece
export const STRAIGHT_D = 216;

// Curves: 45 degrees per piece, 8 = full circle.
export const CURVE_SWEEP_DEG = 45;
export const CURVE_RADIUS = 202; // centerline radius of the large curve (inner 182 + half width)
export const CURVE_RADIUS_SHORT = 110; // centerline radius of the short/tight curve (E1: inner ~90 + half width)

// Connectors (visual nubs)
export const MALE_PEG_RADIUS = 11.5 / 2;
export const MALE_NECK = 7;

// Elevation: integer "levels"; each level is roughly one track height of rise.
export const LEVEL_RISE = 14;

// --- Connection / joint tolerances (the "wiggle room") ---
// Generous so imperfect loops still close, reproducing real BRIO joint play.
export const SNAP_CAPTURE_RADIUS = 110; // how close a dragged port must be to snap exactly (UI)
export const JOINT_GAP_TOLERANCE = 9; // mm of pull-apart still counted as connected
export const JOINT_ANGLE_TOLERANCE_DEG = 11; // angular wiggle still counted as connected

// --- Flex solver (loop closure) ---
// Real wooden track only closes a loop because every joint is a little loose, and
// the whole assembly bends to absorb the leftover gap (45 curves give sqrt(2)
// distances that never line up exactly). When a free port lands within this much
// of another, we treat them as "wanting" to mate and run a relaxation pass that
// distributes the closure error across every joint in the loop. Whether it
// actually closes is still judged by JOINT_GAP/ANGLE_TOLERANCE above -- those are
// the per-joint play limits.
export const FLEX_CAPTURE_RADIUS = 75; // mm gap the solver will try to pull shut
export const FLEX_CAPTURE_ANGLE_DEG = 35; // angular mismatch the solver will try to pull shut
export const FLEX_GN_PASSES = 4; // Gauss-Newton outer iterations
export const FLEX_REGULARIZATION = 1e-4; // Tikhonov λ — ensures well-posedness, picks minimum-norm correction
export const FLEX_ANGLE_WEIGHT = STRAIGHT_A / 2; // lever-arm weight (mm) that puts angle in position-equivalent units

// Default simulation speed
export const DEFAULT_SPEED = 140; // mm/s

// Default render scale (px per mm)
export const DEFAULT_SCALE = 1.6;
