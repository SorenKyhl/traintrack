import { Group, Rect, Circle } from "react-konva";
import { useStore } from "../state/store";
import { pieceLookup, trainCarPoses, type Train } from "../train";

const CAR_WIDTH = 32;

export function TrainShape({ train }: { train: Train }) {
  const pieces = useStore((s) => s.pieces);
  const connections = useStore((s) => s.connections);
  const poses = trainCarPoses(train, pieceLookup(pieces), connections);

  return (
    <>
      {poses.map((cp, i) => {
        const deg = (cp.heading * 180) / Math.PI;
        const len = cp.car.length;
        return (
          <Group key={i} x={cp.x} y={cp.y} rotation={deg}>
            <Rect
              x={-len / 2}
              y={-CAR_WIDTH / 2}
              width={len}
              height={CAR_WIDTH}
              cornerRadius={6}
              fill={cp.car.color}
              stroke="#222"
              strokeWidth={1.5}
              shadowColor="rgba(0,0,0,0.3)"
              shadowBlur={6}
              shadowOffset={{ x: 0, y: 3 }}
            />
            {cp.car.isEngine && (
              <>
                {/* cab */}
                <Rect x={-len / 2 + 6} y={-CAR_WIDTH / 2 + 4} width={26} height={CAR_WIDTH - 8} cornerRadius={3} fill="#222a" />
                {/* boiler + chimney */}
                <Circle x={len / 2 - 16} y={0} radius={6} fill="#1b1b1b" />
              </>
            )}
          </Group>
        );
      })}
    </>
  );
}
