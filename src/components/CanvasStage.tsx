import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Line, Group } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useStore } from "../state/store";
import { DEF_BY_ID } from "../track/defs";
import { PieceShape, PiecePegs } from "./PieceShape";
import { TrainShape } from "./TrainShape";

export interface DropPayload {
  kind: "piece" | "train";
  defId?: string;
  length?: number;
}

const GRID = 144; // one standard straight
const CLICK_THRESHOLD = 4; // world mm of movement below which a press counts as a click

export function CanvasStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [panEnabled, setPanEnabled] = useState(true);
  const dragRef = useRef<{ id: string; gx: number; gy: number; moved: boolean } | null>(null);
  const lastClient = useRef({ x: 0, y: 0 });

  const pieces = useStore((s) => s.pieces);
  const trains = useStore((s) => s.trains);
  const levels = useStore((s) => s.levels);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Animation loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      useStore.getState().tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Release a drag even if the mouse comes up outside the stage. Track the latest
  // pointer position so we can tell, on release, whether it ended over the palette
  // (which deletes the dragged piece — "drag back to the sidebar to delete").
  useEffect(() => {
    const onUp = () => finishDrag();
    const track = (x: number, y: number) => {
      lastClient.current = { x, y };
      if (dragRef.current?.moved) useStore.getState().setDeleteArmed(overPalette(x, y));
    };
    const onMove = (e: MouseEvent) => track(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) track(t.clientX, t.clientY);
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onTouch);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
    };
  }, []);

  const worldPointer = () => stageRef.current?.getRelativePointerPosition() ?? null;

  // Is a screen point over the left palette (the delete drop-zone)?
  const overPalette = (clientX: number, clientY: number) => {
    const el = document.querySelector(".palette");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };

  const startPieceDrag = (id: string, e: KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    const wp = worldPointer();
    const p = useStore.getState().pieces.find((x) => x.id === id);
    if (!wp || !p) return;
    dragRef.current = { id, gx: wp.x - p.x, gy: wp.y - p.y, moved: false };
    setPanEnabled(false);
    useStore.getState().select(id);
  };

  const onMouseMove = () => {
    const d = dragRef.current;
    if (!d) return;
    const wp = worldPointer();
    if (!wp) return;
    const nx = wp.x - d.gx;
    const ny = wp.y - d.gy;
    const p = useStore.getState().pieces.find((x) => x.id === d.id);
    if (p && (Math.abs(p.x - nx) > CLICK_THRESHOLD || Math.abs(p.y - ny) > CLICK_THRESHOLD)) d.moved = true;
    useStore.getState().dragMove(d.id, nx, ny);
  };

  const finishDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setPanEnabled(true);
    const s = useStore.getState();
    s.setDeleteArmed(false);
    if (d.moved && overPalette(lastClient.current.x, lastClient.current.y)) {
      // Dropped back over the palette -> delete it.
      s.deletePiece(d.id);
    } else if (d.moved) {
      s.endDrag(d.id);
    } else {
      // A click (no drag): toggle a switch's active branch.
      const piece = s.pieces.find((p) => p.id === d.id);
      if (piece && DEF_BY_ID[piece.defId].category === "switch") s.toggleSwitch(d.id);
    }
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const oldScale = view.scale;
    const worldX = (pointer.x - view.x) / oldScale;
    const worldY = (pointer.y - view.y) / oldScale;
    const factor = e.evt.deltaY > 0 ? 0.92 : 1.08;
    const scale = Math.min(6, Math.max(0.3, oldScale * factor));
    setView({ scale, x: pointer.x - worldX * scale, y: pointer.y - worldY * scale });
  };

  const onStageDragEnd = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === stageRef.current) setView({ x: e.target.x(), y: e.target.y() });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/traintrack");
    if (!raw) return;
    const payload = JSON.parse(raw) as DropPayload;
    const rect = containerRef.current!.getBoundingClientRect();
    const wx = (e.clientX - rect.left - view.x) / view.scale;
    const wy = (e.clientY - rect.top - view.y) / view.scale;
    const s = useStore.getState();
    if (payload.kind === "piece" && payload.defId) s.addPiece(payload.defId, wx, wy);
    else if (payload.kind === "train") s.addTrain(wx, wy, payload.length ?? 3);
  };

  // Render bottom-up by elevation: at each level draw bodies, then male pegs
  // (so pegs sit over sockets), then that level's trains — so a higher track and
  // its trains cover anything passing underneath.
  const levelOf = (id: string) => levels.get(id) ?? 0;
  const maxLevel = pieces.reduce((m, p) => Math.max(m, levelOf(p.id)), 0);
  const tiers = [];
  for (let L = 0; L <= maxLevel; L++) {
    const tierPieces = pieces.filter((p) => levelOf(p.id) === L);
    const tierTrains = trains.filter((t) => levelOf(t.cursor.pieceId) === L);
    tiers.push(
      <Group key={L}>
        {tierPieces.map((p) => (
          <PieceShape key={p.id} piece={p} level={L} onStartDrag={startPieceDrag} />
        ))}
        {tierPieces.map((p) => (
          <PiecePegs key={p.id} piece={p} />
        ))}
        {tierTrains.map((t) => (
          <TrainShape key={t.id} train={t} />
        ))}
      </Group>,
    );
  }

  return (
    <div ref={containerRef} className="canvas-area" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={panEnabled}
        onWheel={onWheel}
        onMouseMove={onMouseMove}
        onMouseUp={finishDrag}
        onTouchMove={onMouseMove}
        onTouchEnd={finishDrag}
        onDragEnd={onStageDragEnd}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) useStore.getState().select(null);
        }}
      >
        <Layer listening={false}>
          <BackgroundGrid w={size.w} h={size.h} view={view} />
        </Layer>
        <Layer>{tiers}</Layer>
      </Stage>
    </div>
  );
}

function BackgroundGrid({ w, h, view }: { w: number; h: number; view: { scale: number; x: number; y: number } }) {
  const lines: number[][] = [];
  const startX = Math.floor(-view.x / view.scale / GRID) * GRID;
  const startY = Math.floor(-view.y / view.scale / GRID) * GRID;
  const endX = startX + w / view.scale + GRID;
  const endY = startY + h / view.scale + GRID;
  for (let x = startX; x <= endX; x += GRID) lines.push([x, startY, x, endY]);
  for (let y = startY; y <= endY; y += GRID) lines.push([startX, y, endX, y]);
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} stroke="#e3d5b8" strokeWidth={1 / view.scale} />
      ))}
    </>
  );
}
