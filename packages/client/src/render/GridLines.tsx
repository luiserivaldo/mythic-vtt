import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  Vector3,
  type OrthographicCamera,
} from 'three';
import { BORDER_COLOR } from './canvas-style.js';
import { gridSegmentsChunked, perspectiveGridRange } from './grid-lines-3d.js';
import type { RenderGrid } from './grid-model.js';
import {
  borderSegments,
  clipRangeToBounds,
  gridSegments,
  gridVisible,
  sameRange,
  visibleCellRange,
  type CellRange,
} from './grid-lines.js';

const lookDir = new Vector3();

/**
 * Square grid (GRID-01) as one LineSegments draw on the XZ plane, 1 world unit = 1 cell.
 * It covers the camera's view and is rebuilt only when the integer cell range changes,
 * so panning inside the margin costs nothing. Runs under frameloop="demand": pan/zoom
 * already invalidate, and the effect below invalidates on style changes.
 */
export function GridLines({
  grid,
  fill,
  renderOrder = 0,
}: {
  grid: RenderGrid;
  /** Scene background colour shown inside the canvas. */
  fill: string;
  renderOrder?: number;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => new BufferGeometry(), []);
  const material = useMemo(
    () => new LineBasicMaterial({ transparent: true, depthWrite: false, depthTest: false }),
    [],
  );
  // D37: the canvas border and the fill that makes the area inside distinct from outside.
  const border = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(borderSegments(grid.bounds, 0), 3));
    return g;
  }, [grid.bounds]);
  const borderMaterial = useMemo(
    () => new LineBasicMaterial({ color: BORDER_COLOR, depthWrite: false, depthTest: false }),
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
      border.dispose();
    },
    [border],
  );
  useEffect(
    () => () => {
      borderMaterial.dispose();
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ camera, size }) => {
    const cam = camera as OrthographicCamera;
    // M2-05: the 3D perspective camera has no pixels-per-cell zoom, so size the grid from where
    // it looks instead (the grid stays visible in both views).
    const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
    const show = perspective || gridVisible(cam.zoom);
    if (lines.current) lines.current.visible = show;
    visible.current = show;
    if (!show) return;
    const visibleRange = perspective
      ? perspectiveGridRange(camera.position, camera.getWorldDirection(lookDir))
      : visibleCellRange(
          { centerX: cam.position.x, centerZ: cam.position.z, zoom: cam.zoom },
          { width: size.width, height: size.height },
        );
    // D37: only lines inside the canvas (2D and 3D); a null clip draws nothing.
    const next = clipRangeToBounds(visibleRange, grid.bounds);
    if (next === null) {
      range.current = null;
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      return;
    }
    if (sameRange(range.current, next)) return;
    range.current = next;
    geometry.setAttribute(
      'position',
      new BufferAttribute(perspective ? gridSegmentsChunked(next) : gridSegments(next), 3),
    );
    geometry.computeBoundingSphere();
  });

  // The cached range belongs to the old bounds once they change.
  useEffect(() => {
    range.current = null;
    invalidate();
  }, [grid.bounds, invalidate]);

  return (
    <>
      <mesh
        position={[grid.bounds.width / 2, 0, grid.bounds.height / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={renderOrder - 2}
        name="canvas-fill"
      >
        <planeGeometry args={[grid.bounds.width, grid.bounds.height]} />
        <meshBasicMaterial color={fill} depthWrite={false} depthTest={false} />
      </mesh>
      <lineSegments
        geometry={border}
        material={borderMaterial}
        renderOrder={renderOrder + 1}
        frustumCulled={false}
        name="canvas-border"
      />
      <lineSegments
        ref={lines}
        geometry={geometry}
        material={material}
        renderOrder={renderOrder}
        frustumCulled={false}
        name="grid"
      />
    </>
  );
}
