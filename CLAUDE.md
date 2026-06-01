# CLAUDE.md

## Commands

```sh
npm run dev      # Vite dev server (http://localhost:5174/)
npm run build    # tsc -b + Vite production build
npm run lint     # ESLint
npm run preview  # Preview the production build
```

No test suite exists; Playwright is installed but no tests are written yet.

## Architecture

TrainTrack is a browser-based wooden railway layout builder. World units are **millimeters** throughout — `src/track/constants.ts` is the canonical source for all piece dimensions and tolerance values.

### Data flow

```
zustand store (state/store.ts)
  └─ PlacedPiece[]  ──────► network/connections.ts  → ConnectionMap
  └─ Train[]        ──────► network/levels.ts        → Map<pieceId, level>
                   ──────► train/index.ts            → CarPose[] (per tick)
```

State is entirely in the zustand store. React components only read store slices and call store actions; all logic lives outside React.

### Core modules

**`src/track/`**
- `constants.ts` — all mm dimensions, tolerances, and solver tuning knobs
- `defs.ts` — the piece library (`DEFS` array of `TrackDef`). Each piece has typed `PortDef[]` (gender M/F, `levelOffset`) and `LaneDef[]` (drivable paths). `portsForDef()` derives world-frame port geometry (position + outward angle) from lane geometry and caches it.
- `placed.ts` — `PlacedPiece` (position, rotation, flip, switchState) and helpers: `worldPorts()`, `worldPoseAlongLane()`, `laneLength()`
- `connector.ts` / `render.ts` — visual helpers consumed by Konva components

**`src/geometry/index.ts`**  
2D vector + pose math. Screen convention: x right, y down, heading = direction of travel. `Segment` is either `{kind:"line"}` or `{kind:"arc"}`. Key functions: `poseAlong()`, `sampleChain()`, `angleDiff()`.

**`src/network/`**
- `connections.ts` — `buildConnections()`: greedy nearest-compatible matching. Two ports connect when they are opposite gender, within `JOINT_GAP_TOLERANCE` (9 mm), and anti-parallel within `JOINT_ANGLE_TOLERANCE_DEG` (11°). `findSnap()` computes the rigid transform to align a dragged piece's port onto a free target port.
- `relax.ts` — Gauss–Newton loop-closure solver. `closeWithFlex()` is called on every drop: it collects "intended joints" (looser tolerance than a real connection) and solves for the minimum-norm pose perturbation that pulls them shut. The result is only kept if it gained a strict connection, so innocent drags never disturb the layout. `relaxLayout()` is the user-triggered unconditional version.
- `levels.ts` — propagates `levelOffset` values across the connection graph to assign each piece an absolute integer elevation level, used for correct z-order rendering.

**`src/train/index.ts`**  
`advance()` walks a `Cursor` (pieceId + laneIndex + arc-length s + direction) along the network, following `ConnectionMap` across joints and `switchState` at branches. The store's `tick()` calls `advance()` every rAF and auto-throws switch points to match the route the engine actually took.

**`src/state/store.ts`**  
Single zustand store. `derive()` recomputes `connections` and `levels` after any layout change. Persistence: `save`/`load` via `localStorage` (key `traintrack-layout-v1`), `exportJSON`/`importJSON` for file-based exchange.

**`src/components/`**  
react-konva canvas. `CanvasStage` owns the rAF loop, pan/zoom, and drag orchestration. `PieceShape` renders a single placed piece (track body + connectors). `TrainShape` renders car rectangles. `Palette` is the left sidebar / drop-zone. `Toolbar` is the top bar (rotate/flip/delete/play/speed/save/load).

### Key invariants

- Piece geometry is always defined in local frame (origin at `p0`'s position, heading 0). `worldPorts()` applies the placed rotation + flip + translation to get world-frame ports.
- Flip negates the y-component of all local port positions and angles — it mirrors across the piece's travel axis.
- `switchState` indexes into `def.switchLanes[]`; non-switch pieces have `switchState` ignored.
- `levelOffset` on a `PortDef` is relative within a piece (0 = same level as the piece base, +1 = one level higher). Absolute levels are computed in `network/levels.ts` by BFS from ground pieces.
