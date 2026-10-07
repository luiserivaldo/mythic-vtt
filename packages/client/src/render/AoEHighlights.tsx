import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, Matrix4, type InstancedMesh } from 'three';
import type { Scene } from '@mythic/shared';
import type { RenderMode } from './PrimitiveMesh.js';
import type { RenderScene } from './scene-model.js';
import { useAoEHighlights } from './use-aoe-highlights.js';
import { AOE_HIGHLIGHT_COLOR } from './canvas-style.js';

const HIGHLIGHT = AOE_HIGHLIGHT_COLOR;

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
    const rotation = new Matrix4().makeRotationX(-Math.PI / 2);
    cells.forEach((cell, index) => {
      matrix.makeTranslation(cell.x + 0.5, cell.y + 0.012, cell.z + 0.5).multiply(rotation);
      current.setMatrixAt(index, matrix);
    });
    current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [cells, invalidate]);

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
      <planeGeometry args={[0.9, 0.9]} />
      <meshBasicMaterial
        color={HIGHLIGHT}
        transparent
        opacity={0.45}
        side={DoubleSide}
        depthTest={mode === '3d'}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/** MEAS-04: non-pickable cell tints and token rings in the shared 2D/3D scene. */
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
