import { Html, Line } from '@react-three/drei';
import { useMemo, useState } from 'react';
import type { Scene, Vec3 } from '@mythic/shared';
import { measureRuler } from '../tools/ruler.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
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

function breakdown(horizontal: string, vertical: string, total: string): string {
  return `H ${horizontal} · V ${vertical} · T ${total}`;
}

/**
 * Camera-facing ruler labels. M3-11: in 3D the path draws one straight segment between the
 * first and last points, labelled with the total length only; hovering the line or any label
 * restores the MEAS-02 horizontal/vertical breakdown.
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
  const total =
    mode === '3d'
      ? hovered
        ? breakdown(measured.horizontalLabel, measured.verticalLabel, measured.totalLabel)
        : measured.totalLabel
      : measured.totalLabel;
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
      {measured.segments.length > 1 &&
        measured.segments.map((segment, index) => (
          <Html
            key={`${String(index)}:${segment.label}`}
            center
            position={lifted(segment.midpoint)}
            zIndexRange={[5, 0]}
            style={{ pointerEvents: 'auto' }}
          >
            <div
              data-testid={`${testId}-segment`}
              style={{ ...pillStyle, fontSize: 11, opacity: 0.85 }}
              onPointerEnter={() => {
                setHovered(true);
              }}
              onPointerLeave={() => {
                setHovered(false);
              }}
            >
              {mode === '3d' && hovered
                ? breakdown(segment.horizontalLabel, segment.verticalLabel, segment.label)
                : segment.label}
            </div>
          </Html>
        ))}
      {measured.segments.length > 0 && (
        <Html
          center
          position={lifted(last)}
          zIndexRange={[6, 0]}
          style={{ pointerEvents: 'auto', transform: 'translateY(-18px)' }}
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
