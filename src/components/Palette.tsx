import { poseAlong, sampleChain, totalLength, type Pose } from "../geometry";
import { DEFS, portsForDef, type Category, type PortGeom, type TrackDef } from "../track/defs";
import { bodyPolygon, groovePolyline } from "../track/render";
import { GROOVE_WIDTH } from "../track/constants";
import { CONN, headCenterX, neckCorners } from "../track/connector";
import { useStore } from "../state/store";
import type { DropPayload } from "./CanvasStage";

const GROUPS: { category: Category; label: string }[] = [
  { category: "straight", label: "Straights" },
  { category: "curve", label: "Curves" },
  { category: "switch", label: "Switches" },
  { category: "ascender", label: "Elevation" },
  { category: "connector", label: "Adapters" },
];

const WOOD = "#c8a06a";
const WOOD_EDGE = "#8a6a3a";
const GROOVE = "#5b4326";

function setDrag(e: React.DragEvent, payload: DropPayload) {
  e.dataTransfer.setData("application/traintrack", JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
}

/** A faithful little wooden-track thumbnail, rendered the same way as the canvas. */
function Thumb({ def }: { def: TrackDef }) {
  const W = 80;
  const H = 56;
  const pad = 8;
  const isSwitch = def.category === "switch";
  const laneSamples: Pose[][] = def.lanes.map((l) => sampleChain(l.segments, l.start, 7));
  const bodies = laneSamples.map((s) => bodyPolygon(s));

  // Bounding box over all body outline points.
  const allX: number[] = [];
  const allY: number[] = [];
  for (const b of bodies) for (let i = 0; i < b.length; i += 2) {
    allX.push(b[i]);
    allY.push(b[i + 1]);
  }
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const s = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxY - minY));
  const tx = (x: number) => (x - (minX + maxX) / 2) * s + W / 2;
  const ty = (y: number) => (y - (minY + maxY) / 2) * s + H / 2;
  const toPath = (flat: number[]) => {
    let d = "";
    for (let i = 0; i < flat.length; i += 2) d += `${i ? "L" : "M"}${tx(flat[i]).toFixed(1)} ${ty(flat[i + 1]).toFixed(1)} `;
    return d + "Z";
  };
  const toLine = (flat: number[]) => {
    let d = "";
    for (let i = 0; i < flat.length; i += 2) d += `${i ? "L" : "M"}${tx(flat[i]).toFixed(1)} ${ty(flat[i + 1]).toFixed(1)} `;
    return d;
  };

  return (
    <svg width={W} height={H} className="thumb">
      {isSwitch ? (
        <>
          {/* Stroke pass (below fills) */}
          {bodies.map((body, i) => (
            <path key={`s${i}`} d={toPath(body)} fill="none" stroke={WOOD_EDGE} strokeWidth={2} />
          ))}
          {/* Fill pass (covers interior strokes) */}
          {bodies.map((body, i) => (
            <path key={`f${i}`} d={toPath(body)} fill={WOOD} stroke="none" />
          ))}
          {laneSamples.map((samp, i) => (
            <g key={i}>
              {([1, -1] as const).map((side) => (
                <path
                  key={side}
                  d={toLine(groovePolyline(samp, side))}
                  fill="none"
                  stroke={GROOVE}
                  strokeWidth={Math.max(1.2, GROOVE_WIDTH * s)}
                  strokeLinecap="butt"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          ))}
          <ThumbSwitchIndicator def={def} tx={tx} ty={ty} s={s} />
        </>
      ) : (
        laneSamples.map((samp, i) => (
          <g key={i}>
            <path d={toPath(bodies[i])} fill={WOOD} stroke={WOOD_EDGE} strokeWidth={1} />
            {([1, -1] as const).map((side) => (
              <path
                key={side}
                d={toLine(groovePolyline(samp, side))}
                fill="none"
                stroke={GROOVE}
                strokeWidth={Math.max(1.2, GROOVE_WIDTH * s)}
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
            ))}
          </g>
        ))
      )}
      {portsForDef(def).map((port) => (
        <ConnectorSvg key={port.id} port={port} tx={tx} ty={ty} s={s} />
      ))}
    </svg>
  );
}

/** Red direction indicator for switch thumbnails (shows default lane 0 state). */
function ThumbSwitchIndicator({ def, tx, ty, s }: { def: TrackDef; tx: (x: number) => number; ty: (y: number) => number; s: number }) {
  const lane = def.lanes[0];
  const len = totalLength(lane.segments);
  const pose = poseAlong(lane.segments, lane.start, len * 0.7);
  const cx = tx(pose.x);
  const cy = ty(pose.y);
  const angle = (pose.heading * 180) / Math.PI;
  const w = 32 * s;
  const h = 16 * s;
  const rx = 7 * s;
  return (
    <rect
      x={cx - w / 2}
      y={cy - h / 2}
      width={w}
      height={h}
      rx={rx}
      ry={rx}
      fill="#cc2200"
      stroke="#881500"
      strokeWidth={Math.max(0.5, 1.5 * s)}
      transform={`rotate(${angle.toFixed(1)}, ${cx.toFixed(1)}, ${cy.toFixed(1)})`}
    />
  );
}

/** SVG version of a connector for thumbnails, matching the canvas rendering. */
function ConnectorSvg({ port, tx, ty, s }: { port: PortGeom; tx: (x: number) => number; ty: (y: number) => number; s: number }) {
  const c = Math.cos(port.angle);
  const sn = Math.sin(port.angle);
  const toMm = (lx: number, ly: number): [number, number] => [port.pos.x + lx * c - ly * sn, port.pos.y + lx * sn + ly * c];
  const map = (lx: number, ly: number) => { const [mx, my] = toMm(lx, ly); return `${tx(mx).toFixed(1)},${ty(my).toFixed(1)}`; };
  const neckPts = neckCorners(port.gender).map(([x, y]) => map(x, y)).join(" ");
  const [hx, hy] = toMm(headCenterX(port.gender), 0);
  const isM = port.gender === "M";
  const fill = isM ? "#c8a06a" : "#4a3517";
  const edge = isM ? "#8a6a3a" : "#2f2210";
  return (
    <g>
      <polygon points={neckPts} fill={fill} stroke={edge} strokeWidth={0.8} />
      <circle cx={tx(hx)} cy={ty(hy)} r={CONN.headR * s} fill={fill} stroke={edge} strokeWidth={0.8} />
    </g>
  );
}

/** A small locomotive icon for the trains palette. */
function EngineIcon({ color, cars }: { color: string; cars: number }) {
  const carColors = ["#e53935", "#fdd835", "#43a047"];
  return (
    <svg width={80} height={40} className="thumb">
      {/* wagons behind */}
      {Array.from({ length: cars }).map((_, i) => {
        const x = 6 + i * 17;
        return (
          <g key={i}>
            <rect x={x} y={16} width={14} height={11} rx={2} fill={carColors[i % carColors.length]} stroke="#222" strokeWidth={0.8} />
            <circle cx={x + 3} cy={29} r={2.2} fill="#333" />
            <circle cx={x + 11} cy={29} r={2.2} fill="#333" />
          </g>
        );
      })}
      {/* engine at the front (right) */}
      <g transform={`translate(${6 + cars * 17}, 0)`}>
        <rect x={2} y={14} width={26} height={14} rx={3} fill={color} stroke="#222" strokeWidth={1} />
        <rect x={2} y={9} width={12} height={9} rx={2} fill={color} stroke="#222" strokeWidth={1} />
        <rect x={20} y={8} width={5} height={6} fill="#1b1b1b" />
        <circle cx={17} cy={12} r={2.4} fill="#1b1b1b" />
        <circle cx={8} cy={30} r={3} fill="#333" />
        <circle cx={22} cy={30} r={3} fill="#333" />
      </g>
    </svg>
  );
}

export function Palette() {
  const deleteArmed = useStore((s) => s.deleteArmed);
  return (
    <div className={deleteArmed ? "palette delete-armed" : "palette"}>
      {deleteArmed && (
        <div className="delete-overlay">
          <span>🗑 Release to delete</span>
        </div>
      )}
      <h2>Track pieces</h2>
      {GROUPS.map((g) => (
        <section key={g.category}>
          <h3>{g.label}</h3>
          <div className="palette-grid">
            {DEFS.filter((d) => d.category === g.category).map((def) => (
              <div
                key={def.id}
                className="palette-item"
                draggable
                onDragStart={(e) => setDrag(e, { kind: "piece", defId: def.id })}
                title={def.name}
              >
                <Thumb def={def} />
                <span>{def.name}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      <h2>Trains</h2>
      <div className="palette-grid">
        {[
          { label: "Engine + 2 cars", length: 3, color: "#1565c0", cars: 2 },
          { label: "Engine + 4 cars", length: 5, color: "#c62828", cars: 3 },
          { label: "Engine only", length: 1, color: "#2e7d32", cars: 0 },
        ].map((t) => (
          <div
            key={t.label}
            className="palette-item"
            draggable
            onDragStart={(e) => setDrag(e, { kind: "train", length: t.length })}
            title={t.label}
          >
            <EngineIcon color={t.color} cars={t.cars} />
            <span>{t.label}</span>
          </div>
        ))}
      </div>
      <p className="hint">Drag pieces onto the table. Drag a piece near another's end and it snaps together. Drop a train on any track, then press Play. Click a switch to flip its route. Drag a piece back here to delete it.</p>
    </div>
  );
}
