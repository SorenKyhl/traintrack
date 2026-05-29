import { Group, Line, Circle } from "react-konva";
import { CONN, headCenterX, neckCorners } from "../track/connector";
import type { PortGeom } from "../track/defs";

const WOOD = "#c8a06a";
const WOOD_EDGE = "#8a6a3a";
const SOCKET = "#4a3517"; // dark cavity (the "negative" carved out of the track)
const SOCKET_EDGE = "#2f2210";

/** Renders a male peg (protruding) or female socket (carved cavity) at a port. */
export function Connector({ port, selected }: { port: PortGeom; selected: boolean }) {
  const rotation = (port.angle * 180) / Math.PI;
  const neck = neckCorners(port.gender).flat();
  const headX = headCenterX(port.gender);

  if (port.gender === "M") {
    const edge = selected ? "#ff8f00" : WOOD_EDGE;
    return (
      <Group x={port.pos.x} y={port.pos.y} rotation={rotation}>
        <Line points={neck} closed fill={WOOD} stroke={edge} strokeWidth={2} lineJoin="round" />
        <Circle x={headX} y={0} radius={CONN.headR} fill={WOOD} stroke={edge} strokeWidth={2} />
        {/* subtle highlight on the peg head */}
        <Circle x={headX - 1.5} y={-1.5} radius={CONN.headR * 0.4} fill="#d8b483" />
      </Group>
    );
  }

  // Female: a dark cavity carved into the end — slot widening to a round hole.
  return (
    <Group x={port.pos.x} y={port.pos.y} rotation={rotation}>
      <Line points={neck} closed fill={SOCKET} stroke={SOCKET_EDGE} strokeWidth={1.2} lineJoin="round" />
      <Circle x={headX} y={0} radius={CONN.headR} fill={SOCKET} stroke={SOCKET_EDGE} strokeWidth={1.2} />
    </Group>
  );
}
