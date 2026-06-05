import { Group, Line, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useStore } from "../state/store";
import { defOf, type PlacedPiece } from "../track/placed";
import { portsForDef, type TrackDef } from "../track/defs";
import { poseAlong, sampleChain, totalLength } from "../geometry";
import { bodyPolygon, groovePolyline } from "../track/render";
import { Connector } from "./Connector";

const WOOD_EDGE = "#8a6a3a";
const GROOVE = "#5b4326";
const SELECTED = "#ff8f00";
// Higher levels are tinted lighter (as if nearer the light) so elevation reads.
const WOOD_BY_LEVEL = ["#c8a06a", "#d6b181", "#e1c197", "#ebd0ab"];

const woodAt = (level: number) => WOOD_BY_LEVEL[Math.min(level, WOOD_BY_LEVEL.length - 1)];

function transformProps(piece: PlacedPiece) {
  return {
    x: piece.x,
    y: piece.y,
    rotation: (piece.rotation * 180) / Math.PI,
    scaleY: piece.flipped ? -1 : 1,
  };
}

/** Body + grooves + female sockets. Interactive (drag / select / switch toggle). */
export function PieceShape({
  piece,
  level,
  onStartDrag,
}: {
  piece: PlacedPiece;
  level: number;
  onStartDrag: (id: string, e: KonvaEventObject<MouseEvent>) => void;
}) {
  const def = defOf(piece);
  const isSelected = useStore((s) => s.selectedId === piece.id);
  const activeLane = def.switchLanes?.[piece.switchState];
  const wood = woodAt(level);
  const isSwitch = def.category === "switch";
  const allSamples = isSwitch ? def.lanes.map((lane) => sampleChain(lane.segments, lane.start)) : null;

  return (
    <Group
      {...transformProps(piece)}
      onMouseDown={(e) => onStartDrag(piece.id, e)}
      onTouchStart={(e) => onStartDrag(piece.id, e as unknown as KonvaEventObject<MouseEvent>)}
      shadowColor={level > 0 ? "rgba(0,0,0,0.5)" : undefined}
      shadowBlur={level > 0 ? 6 + level * 6 : 0}
      shadowOffset={level > 0 ? { x: 0, y: 5 * level } : undefined}
    >
      {isSwitch ? (
        <>
          {/* Pass 1: strokes drawn below fills; interior strokes get covered by lane fills */}
          {allSamples!.map((samples, i) => (
            <Line
              key={`s${i}`}
              points={bodyPolygon(samples)}
              closed
              stroke={isSelected ? SELECTED : WOOD_EDGE}
              strokeWidth={isSelected ? 8 : 4}
            />
          ))}
          {/* Pass 2: fills covering interiors (hides interior stroke segments from pass 1) */}
          {allSamples!.map((samples, i) => (
            <Line
              key={`f${i}`}
              points={bodyPolygon(samples)}
              closed
              fill={wood}
              strokeWidth={0}
            />
          ))}
          {/* Grooves gouged through all lanes */}
          {allSamples!.flatMap((samples, laneIndex) => {
            const isActiveBranch = activeLane === undefined || activeLane === laneIndex;
            return ([1, -1] as const).map((side) => (
              <Line
                key={`${laneIndex}-${side}`}
                points={groovePolyline(samples, side)}
                stroke={isActiveBranch ? GROOVE : "#9a8050"}
                strokeWidth={6}
                lineCap="round"
                lineJoin="round"
              />
            ));
          })}
          {/* BRIO-style red rotary direction indicator */}
          <SwitchIndicator def={def} activeLaneIndex={activeLane ?? 0} />
        </>
      ) : (
        def.lanes.map((lane, laneIndex) => {
          const samples = sampleChain(lane.segments, lane.start);
          const isActiveBranch = activeLane === undefined || activeLane === laneIndex;
          const isRamp = def.category === "ascender";
          const start = lane.start;
          const end = poseAlong(lane.segments, lane.start, totalLength(lane.segments));
          const gradient = isRamp
            ? {
                fillLinearGradientStartPoint: { x: start.x, y: start.y },
                fillLinearGradientEndPoint: { x: end.x, y: end.y },
                fillLinearGradientColorStops: [0, woodAt(level - 1 < 0 ? 0 : level - 1), 1, woodAt(level)],
              }
            : { fill: wood };
          return (
            <Group key={laneIndex}>
              <Line
                points={bodyPolygon(samples)}
                closed
                {...gradient}
                stroke={isSelected ? SELECTED : WOOD_EDGE}
                strokeWidth={isSelected ? 4 : 2}
                opacity={isActiveBranch ? 1 : 0.5}
              />
              {([1, -1] as const).map((side) => (
                <Line
                  key={side}
                  points={groovePolyline(samples, side)}
                  stroke={GROOVE}
                  strokeWidth={6}
                  lineCap="round"
                  lineJoin="round"
                />
              ))}
              {isRamp && <Chevrons lane={lane} />}
            </Group>
          );
        })
      )}

      {/* Female sockets are part of the body (carved in); male pegs render in a top pass. */}
      {portsForDef(def)
        .filter((p) => p.gender === "F")
        .map((port) => (
          <Connector key={port.id} port={port} selected={isSelected} />
        ))}
    </Group>
  );
}

/** Male pegs only — rendered above all bodies so a peg always sits over its socket. */
export function PiecePegs({ piece }: { piece: PlacedPiece }) {
  const def = defOf(piece);
  const isSelected = useStore((s) => s.selectedId === piece.id);
  return (
    <Group {...transformProps(piece)} listening={false}>
      {portsForDef(def)
        .filter((p) => p.gender === "M")
        .map((port) => (
          <Connector key={port.id} port={port} selected={isSelected} />
        ))}
    </Group>
  );
}

/** Uphill chevrons drawn along an ascender lane. */
function Chevrons({ lane }: { lane: ReturnType<typeof defOf>["lanes"][number] }) {
  const len = totalLength(lane.segments);
  const marks = [0.32, 0.5, 0.68].map((f) => poseAlong(lane.segments, lane.start, len * f));
  return (
    <>
      {marks.map((p, i) => {
        const dx = Math.cos(p.heading);
        const dy = Math.sin(p.heading);
        const px = -Math.sin(p.heading);
        const py = Math.cos(p.heading);
        const tip = [p.x + dx * 7, p.y + dy * 7];
        const a = [p.x - dx * 5 + px * 9, p.y - dy * 5 + py * 9];
        const b = [p.x - dx * 5 - px * 9, p.y - dy * 5 - py * 9];
        return (
          <Line key={i} points={[a[0], a[1], tip[0], tip[1], b[0], b[1]]} stroke="#7a5b30" strokeWidth={2.5} lineCap="round" lineJoin="round" opacity={0.7} />
        );
      })}
    </>
  );
}

/** Red rounded-rectangle direction indicator, positioned ~70% along the active lane. */
function SwitchIndicator({ def, activeLaneIndex }: { def: TrackDef; activeLaneIndex: number }) {
  const lane = def.lanes[activeLaneIndex];
  const len = totalLength(lane.segments);
  const dist = len * 0.7;
  const pose = poseAlong(lane.segments, lane.start, dist);
  return (
    <Group x={pose.x} y={pose.y} rotation={(pose.heading * 180) / Math.PI}>
      <Rect
        x={-16}
        y={-8}
        width={32}
        height={16}
        cornerRadius={7}
        fill="#cc2200"
        stroke="#881500"
        strokeWidth={1.5}
      />
    </Group>
  );
}
