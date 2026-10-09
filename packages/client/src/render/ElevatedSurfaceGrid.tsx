import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, LineBasicMaterial } from 'three';
import type { RenderEntity, RenderShape } from './scene-model.js';
import type { RenderGrid } from './grid-model.js';
import { topmostElevatedGridSegments, type ElevatedGridSurface } from './elevated-grid.js';

/** GRID-05 overlay. It is visual-only: it never participates in entity picking. */
export function ElevatedSurfaceGrid({
  entity,
  shape,
  grid,
  renderOrder,
  surfaces,
}: {
  entity: RenderEntity;
  shape: RenderShape;
  grid: RenderGrid;
  renderOrder: number;
  surfaces: readonly ElevatedGridSurface[];
}) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry();
    next.setAttribute(
      'position',
      new BufferAttribute(
        topmostElevatedGridSegments({ id: entity.id, shape, position: entity.position }, surfaces),
        3,
      ),
    );
    next.computeBoundingSphere();
    return next;
  }, [entity.id, entity.position, shape, surfaces]);
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        color: grid.color,
        opacity: grid.opacity,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      }),
    [grid.color, grid.opacity],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (!shape.walkable || !shape.showGridOnTop) return null;
  return (
    <lineSegments
      name={`elevated-grid-${entity.id}`}
      geometry={geometry}
      material={material}
      renderOrder={renderOrder}
      raycast={() => null}
    />
  );
}
