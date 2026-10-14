import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Matrix4, type InstancedMesh } from 'three';
import type { Scene } from '@mythic/shared';
import type { RenderMode } from './PrimitiveMesh.js';
import type { RenderScene } from './scene-model.js';
import { useAoEHighlights } from './use-aoe-highlights.js';
import { AOE_HIGHLIGHT_COLOR } from './canvas-style.js';

const HIGHLIGHT = AOE_HIGHLIGHT_COLOR;
export const AOE_CELL_INSET = 0.1;

export function cellHighlightTransform(
  cell: { x: number; y: number; z: number },
  mode: RenderMode,
): { position: readonly [number, number, number]; rotationX: number } {
  return mode === '3d'
    ? { position: [cell.x + 0.5, cell.y + 0.5, cell.z + 0.5], rotationX: 0 }
    : { position: [cell.x + 0.5, cell.y + 0.012, cell.z + 0.5], rotationX: -Math.PI / 2 };
}

function CellHighlights({
  cells,
  mode,
}: {
  cells: ReturnType<typeof useAoEHighlights>['cells'];
  mode: RenderMode;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    const current = mesh.current;
    if (!current) return;
    const matrix = new Matrix4();
    const rotation = new Matrix4();
    cells.forEach((cell, index) => {
      const visual = cellHighlightTransform(cell, mode);
      rotation.makeRotationX(visual.rotationX);
      matrix.makeTranslation(...visual.position).multiply(rotation);
      current.setMatrixAt(index, matrix);
    });
    current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [cells, invalidate, mode]);

  if (cells.length === 0) return null;
  return (
    <instancedMesh
      key={cells.length}
      ref={mesh}
      args={[undefined, undefined, cells.length]}
      raycast={() => null}
      renderOrder={20}
      frustumCulled={false}
    >
      {mode === '3d' ? (
        <boxGeometry args={[1 - AOE_CELL_INSET, 1 - AOE_CELL_INSET, 1 - AOE_CELL_INSET]} />
      ) : (
        <planeGeometry args={[1 - AOE_CELL_INSET, 1 - AOE_CELL_INSET]} />
      )}
      <meshBasicMaterial
        color={HIGHLIGHT}
        transparent
        opacity={mode === '3d' ? 0.2 : 0.45}
        side={DoubleSide}
        depthTest={mode === '3d'}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/** MEAS-04/06: non-pickable cell tints or volumes and token rings in the shared scene. */
export function AoEHighlights({
  scene,
  rendered,
  mode,
}: {
  scene: Scene | null;
  rendered: RenderScene | null;
  mode: RenderMode;
}) {
  const highlights = useAoEHighlights(scene);
  const affected = useMemo(() => new Set(highlights.tokenIds), [highlights.tokenIds]);
  const tokens =
    rendered?.entities.filter((entity) => entity.token && affected.has(entity.id)) ?? [];

  return (
    <group name="aoe-affected-highlights">
      <CellHighlights cells={highlights.cells} mode={mode} />
      {tokens.map((entity) => {
        const [x, y, z] = entity.position;
        const half = entity.sizeCells / 2;
        return (
          <mesh
            key={entity.id}
            name={`aoe-affected-${entity.id}`}
            raycast={() => null}
            position={[x, y + 0.025, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={21}
          >
            <ringGeometry args={[half * 1.03, half * 1.18, 48]} />
            <meshBasicMaterial
              color={HIGHLIGHT}
              side={DoubleSide}
              depthTest={mode === '3d'}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
