import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, LineBasicMaterial, type OrthographicCamera } from 'three';
import type { RenderGrid } from './grid-model.js';
import {
  gridSegments,
  gridVisible,
  sameRange,
  visibleCellRange,
  type CellRange,
} from './grid-lines.js';

/**
 * Square grid (GRID-01) as one LineSegments draw on the XZ plane, 1 world unit = 1 cell.
 * It covers the camera's view and is rebuilt only when the integer cell range changes,
 * so panning inside the margin costs nothing. Runs under frameloop="demand": pan/zoom
 * already invalidate, and the effect below invalidates on style changes.
 */
export function GridLines({ grid, renderOrder = 0 }: { grid: RenderGrid; renderOrder?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => new BufferGeometry(), []);
  const material = useMemo(
    () => new LineBasicMaterial({ transparent: true, depthWrite: false, depthTest: false }),
    [],
  );
  const range = useRef<CellRange | null>(null);
  const visible = useRef(true);
  const lines = useRef<import('three').LineSegments>(null);

  useEffect(() => {
    material.color.set(grid.color);
    material.opacity = grid.opacity;
    invalidate();
  }, [grid.color, grid.opacity, material, invalidate]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ camera, size }) => {
    const cam = camera as OrthographicCamera;
    const show = gridVisible(cam.zoom);
    if (lines.current) lines.current.visible = show;
    visible.current = show;
    if (!show) return;
    const next = visibleCellRange(
      { centerX: cam.position.x, centerZ: cam.position.z, zoom: cam.zoom },
      { width: size.width, height: size.height },
    );
    if (sameRange(range.current, next)) return;
    range.current = next;
    geometry.setAttribute('position', new BufferAttribute(gridSegments(next), 3));
    geometry.computeBoundingSphere();
  });

  return (
    <lineSegments
      ref={lines}
      geometry={geometry}
      material={material}
      renderOrder={renderOrder}
      frustumCulled={false}
      name="grid"
    />
  );
}
