import { Group, Line, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useStore } from "../state/store";
import { defOf, type PlacedPiece } from "../track/placed";
import { portsForDef } from "../track/defs";
import { PIECE_VISUAL_STYLE, pieceVisual } from "../track/visual";
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
  renderPass = "all",
}: {
  piece: PlacedPiece;
  level: number;
  onStartDrag: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  /** Bodies and grooves render separately so sibling bodies cannot cover a groove. */
  renderPass?: "all" | "body" | "grooves";
}) {
  const def = defOf(piece);
  const isSelected = useStore((s) => s.selectedId === piece.id);
  const wood = woodAt(level);
  const isSwitch = def.category === "switch";
  const renderBody = renderPass !== "grooves";
  const renderGrooves = renderPass !== "body";
  const visual = pieceVisual(def, piece.switchState);

  return (
    <Group
      {...transformProps(piece)}
      listening={renderPass !== "grooves"}
      onMouseDown={renderPass !== "grooves" ? (e) => onStartDrag(piece.id, e) : undefined}
      onTouchStart={renderPass !== "grooves" ? (e) => onStartDrag(piece.id, e as unknown as KonvaEventObject<MouseEvent>) : undefined}
      shadowColor={level > 0 ? "rgba(0,0,0,0.5)" : undefined}
      shadowBlur={level > 0 ? 6 + level * 6 : 0}
      shadowOffset={level > 0 ? { x: 0, y: 5 * level } : undefined}
    >
      {isSwitch ? (
        <>
          {/* Single unified body polygon — no interior strokes at lane junctions */}
          {renderBody && (
            <Line
              points={visual.switchBody!}
              closed
              fill={wood}
              stroke={isSelected ? SELECTED : WOOD_EDGE}
              strokeWidth={isSelected ? 4 : PIECE_VISUAL_STYLE.body.strokeWidth}
            />
          )}
          {/* Grooves gouged through all lanes */}
          {renderGrooves && visual.lanes.flatMap((lane, laneIndex) => (
            lane.grooves.map((groove, grooveIndex) => (
              <Line
                key={`${laneIndex}-${grooveIndex}`}
                points={groove}
                stroke={lane.active ? GROOVE : "#9a8050"}
                strokeWidth={PIECE_VISUAL_STYLE.groove.strokeWidth}
                lineCap={PIECE_VISUAL_STYLE.groove.lineCap}
                lineJoin={PIECE_VISUAL_STYLE.groove.lineJoin}
              />
            ))
          ))}
          {/* BRIO-style red rotary direction indicator */}
          {renderGrooves && <SwitchIndicator marker={visual.switchMarker!} />}
        </>
      ) : (
        visual.lanes.map((lane, laneIndex) => {
          const isRamp = def.category === "ascender";
          const gradient = isRamp
            ? {
                fillLinearGradientStartPoint: { x: lane.start.x, y: lane.start.y },
                fillLinearGradientEndPoint: { x: lane.end.x, y: lane.end.y },
                fillLinearGradientColorStops: [0, woodAt(level - 1 < 0 ? 0 : level - 1), 1, woodAt(level)],
              }
            : { fill: wood };
          return (
            <Group key={laneIndex}>
              {renderBody && (
                <Line
                  points={lane.body}
                  closed
                  {...gradient}
                  stroke={isSelected ? SELECTED : WOOD_EDGE}
                  strokeWidth={isSelected ? 4 : PIECE_VISUAL_STYLE.body.strokeWidth}
                  opacity={lane.active ? 1 : 0.5}
                />
              )}
              {renderGrooves && lane.grooves.map((groove, grooveIndex) => (
                <Line
                  key={grooveIndex}
                  points={groove}
                  stroke={GROOVE}
                  strokeWidth={PIECE_VISUAL_STYLE.groove.strokeWidth}
                  lineCap={PIECE_VISUAL_STYLE.groove.lineCap}
                  lineJoin={PIECE_VISUAL_STYLE.groove.lineJoin}
                />
              ))}
              {renderBody && isRamp && <Chevrons paths={visual.chevrons} />}
            </Group>
          );
        })
      )}

      {/* Female sockets are part of the body (carved in); male pegs render in a top pass. */}
      {renderBody && portsForDef(def)
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
function Chevrons({ paths }: { paths: number[][] }) {
  return (
    <>
      {paths.map((points, i) => <Line key={i} points={points} stroke="#7a5b30" {...PIECE_VISUAL_STYLE.chevron} />)}
    </>
  );
}

/**
 * Red indicator centered at ~25% along the active lane — placed using the real
 * arc pose so it stays on the track centerline for both straight and curved branches.
 */
function SwitchIndicator({ marker }: { marker: { x: number; y: number; heading: number } }) {
  return (
    <Group x={marker.x} y={marker.y} rotation={(marker.heading * 180) / Math.PI}>
      <Rect
        x={-PIECE_VISUAL_STYLE.switchMarker.width / 2}
        y={-PIECE_VISUAL_STYLE.switchMarker.height / 2}
        width={PIECE_VISUAL_STYLE.switchMarker.width}
        height={PIECE_VISUAL_STYLE.switchMarker.height}
        cornerRadius={PIECE_VISUAL_STYLE.switchMarker.cornerRadius}
        fill="#cc2200"
        stroke="#881500"
        strokeWidth={PIECE_VISUAL_STYLE.switchMarker.strokeWidth}
      />
    </Group>
  );
}
