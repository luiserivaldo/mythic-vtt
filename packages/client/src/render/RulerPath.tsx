import { Html, Line } from '@react-three/drei';
import { useMemo, useState } from 'react';
import type { Scene, Vec3 } from '@mythic/shared';
import { measureRuler } from '../tools/ruler.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import { rulerLabel } from './range-readout.js';
import type { ViewMode } from './view-mode-store.js';

const LIFT = 0.05;

const pillStyle = {
  padding: '1px 6px',
  borderRadius: 4,
  background: LABEL_BACKGROUND_COLOR,
  color: LABEL_TEXT_COLOR,
  whiteSpace: 'nowrap',
  userSelect: 'none',
} as const;

function lifted(point: Vec3): [number, number, number] {
  return [point.x, point.y + LIFT, point.z];
}

/**
 * Camera-facing ruler labels. M3-11: a 3D ruler is one straight segment between the first and last
 * points, labelled with its total length only; hovering the line or the label restores the MEAS-02
 * horizontal/vertical breakdown. 2D keeps the polyline with a label per segment.
 */
export function RulerPath({
  points,
  scene,
  color,
  owner,
  mode,
  testId: testIdOverride,
}: {
  points: readonly Vec3[];
  scene: Scene;
  color: string;
  owner: string | null;
  mode: ViewMode;
  testId?: string;
}) {
  const measured = useMemo(() => measureRuler(points, scene.grid), [points, scene.grid]);
  const [hovered, setHovered] = useState(false);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const testId = testIdOverride ?? (owner === null ? 'ruler' : 'remote-ruler');
  const total = rulerLabel(measured, mode, hovered);
  // The hover reveal is a 3D readout, so only the 3D label needs to catch the pointer.
  const labelPointerEvents = mode === '3d' ? 'auto' : 'none';
  return (
    <group>
      {mode === '3d' && points.length > 1 && (
        <Line
          points={[lifted(first), lifted(last)]}
          color={color}
          lineWidth={3}
          depthTest={false}
          renderOrder={950}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
          }}
          onPointerOut={() => {
            setHovered(false);
          }}
        />
      )}
      {mode !== '3d' && points.length > 1 && (
        <Line
          points={points.map(lifted)}
          color={color}
          lineWidth={3}
          depthTest={false}
          renderOrder={950}
          raycast={() => null}
        />
      )}
      {points.map((point, index) => (
        <mesh
          key={`${String(index)}:${String(point.x)}:${String(point.y)}:${String(point.z)}`}
          position={lifted(point)}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={951}
          raycast={() => null}
        >
          <circleGeometry args={[0.09, 16]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
      {mode !== '3d' &&
        measured.segments.length > 1 &&
        measured.segments.map((segment, index) => (
          <Html
            key={`${String(index)}:${segment.label}`}
            center
            position={lifted(segment.midpoint)}
            zIndexRange={[5, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              data-testid={`${testId}-segment`}
              style={{ ...pillStyle, fontSize: 11, opacity: 0.85 }}
            >
              {segment.label}
            </div>
          </Html>
        ))}
      {measured.segments.length > 0 && (
        <Html
          center
          position={lifted(last)}
          zIndexRange={[6, 0]}
          style={{ pointerEvents: labelPointerEvents, transform: 'translateY(-18px)' }}
        >
          <div
            data-testid={`${testId}-total`}
            style={{ ...pillStyle, fontSize: 13, border: `1px solid ${color}` }}
            onPointerEnter={() => {
              setHovered(true);
            }}
            onPointerLeave={() => {
              setHovered(false);
            }}
          >
            {owner === null ? total : `${owner}: ${total}`}
          </div>
        </Html>
      )}
    </group>
  );
}
