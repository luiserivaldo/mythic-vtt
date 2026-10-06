import { Html, Line } from '@react-three/drei';
import { useMemo } from 'react';
import type { Scene, Vec3 } from '@mythic/shared';
import { measureRuler } from '../tools/ruler.js';
import { rulerGuideCorner } from '../tools/ruler-3d.js';
import type { ViewMode } from './view-mode-store.js';

const LIFT = 0.05;

const pillStyle = {
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(16,25,35,0.85)',
  color: '#fff',
  whiteSpace: 'nowrap',
  userSelect: 'none',
} as const;

function lifted(point: Vec3): [number, number, number] {
  return [point.x, point.y + LIFT, point.z];
}

function breakdown(horizontal: string, vertical: string, total: string): string {
  return `H ${horizontal} · V ${vertical} · T ${total}`;
}

/** Camera-facing ruler labels plus the MEAS-02 horizontal/vertical right-angle guide. */
export function RulerPath({
  points,
  scene,
  color,
  owner,
  mode,
}: {
  points: readonly Vec3[];
  scene: Scene;
  color: string;
  owner: string | null;
  mode: ViewMode;
}) {
  const measured = useMemo(() => measureRuler(points, scene.grid), [points, scene.grid]);
  const last = points[points.length - 1];
  if (!last || points.length === 0) return null;
  const testId = owner === null ? 'ruler' : 'remote-ruler';
  const total =
    mode === '3d'
      ? breakdown(measured.horizontalLabel, measured.verticalLabel, measured.totalLabel)
      : measured.totalLabel;
  return (
    <group>
      {mode === '3d'
        ? measured.segments.map((segment, index) => (
            <Line
              key={`guide:${String(index)}`}
              points={[
                lifted(segment.from),
                lifted(rulerGuideCorner(segment.from, segment.to)),
                lifted(segment.to),
              ]}
              color={color}
              lineWidth={3}
              depthTest={false}
              renderOrder={950}
              raycast={() => null}
            />
          ))
        : points.length > 1 && (
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
            style={{ pointerEvents: 'none' }}
          >
            <div
              data-testid={`${testId}-segment`}
              style={{ ...pillStyle, fontSize: 11, opacity: 0.85 }}
            >
              {mode === '3d'
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
          style={{ pointerEvents: 'none', transform: 'translateY(-18px)' }}
        >
          <div
            data-testid={`${testId}-total`}
            style={{ ...pillStyle, fontSize: 13, border: `1px solid ${color}` }}
          >
            {owner === null ? total : `${owner}: ${total}`}
          </div>
        </Html>
      )}
    </group>
  );
}
