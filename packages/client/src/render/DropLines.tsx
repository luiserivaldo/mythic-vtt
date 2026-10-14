import { useMemo } from 'react';
import { DoubleSide } from 'three';
import { dropLinesFor, DISC_LIFT } from './drop-lines.js';
import type { RenderScene } from './scene-model.js';

const LINE_COLOR = '#334155';
const LINE_WIDTH = 0.025;

/**
 * M2-07 / TOK-05: in 3D, a thin vertical line from each elevated token down to the surface below and a
 * flat soft disc there. Helpers are never pickable and never write depth, so they cannot affect picking
 * or hide anything. 2D shows elevation through the badge instead.
 */
export function DropLines({ rendered }: { rendered: RenderScene | null }) {
  const lines = useMemo(() => (rendered ? dropLinesFor(rendered) : []), [rendered]);
  return (
    <group name="drop-lines">
      {lines.map(({ id, line }) => (
        <group key={id} position={[line.from[0], 0, line.from[2]]}>
          <mesh
            raycast={() => null}
            position={[0, line.surfaceY + line.length / 2, 0]}
            renderOrder={10}
          >
            <boxGeometry args={[LINE_WIDTH, line.length, LINE_WIDTH]} />
            <meshBasicMaterial color={LINE_COLOR} transparent opacity={0.8} depthWrite={false} />
          </mesh>
          <mesh
            raycast={() => null}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, line.surfaceY + DISC_LIFT, 0]}
            renderOrder={9}
          >
            <circleGeometry args={[line.discRadius, 32]} />
            <meshBasicMaterial
              color="#000000"
              transparent
              opacity={0.35}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
