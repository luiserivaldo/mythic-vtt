import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Uint16BufferAttribute } from 'three';
import { ribbonGeometry, sceneStrokes, type DrawStroke } from '../tools/drawing.js';
import type { ViewMode } from './view-mode-store.js';

// LAY-05: the effects layer's freehand drawings. A stroke is a real ribbon of scene units, so it
// keeps its thickness at any zoom and looks the same in 2D and in 3D.

/** LAY-05 / TECHNICAL §6.4: drawings render in the effects band, over props and tokens. */
export const DRAWING_RENDER_ORDER = 30;
/** Every strip carries this name; the eraser finds the stroke it hits through `userData`. */
export const DRAWING_OBJECT_NAME = 'drawing-stroke';

/**
 * UX-40 (playtest F19): in 2D a drawing is the top layer for everyone, so it ignores the depth of
 * the props and tokens that stand over its ground-level samples. In 3D it keeps depth testing, so
 * a line on a wall or a floor is hidden by whatever really stands in front of it.
 */
export function drawingDepthTest(mode: ViewMode): boolean {
  return mode === '3d';
}

function StrokeStrip({ stroke, mode }: { stroke: DrawStroke; mode: ViewMode }) {
  const geometry = useMemo(() => {
    const ribbon = ribbonGeometry(stroke.points, stroke.width);
    if (!ribbon) return null;
    const built = new BufferGeometry();
    built.setAttribute('position', new Float32BufferAttribute(ribbon.positions, 3));
    built.setIndex(new Uint16BufferAttribute(ribbon.indices, 1));
    return built;
  }, [stroke.points, stroke.width]);
  // A growing stroke rebuilds its buffers on every sample; the old ones go with the old geometry.
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh
      name={DRAWING_OBJECT_NAME}
      geometry={geometry}
      renderOrder={DRAWING_RENDER_ORDER}
      userData={{ strokeId: stroke.strokeId }}
    >
      <meshBasicMaterial
        color={stroke.color}
        side={DoubleSide}
        transparent
        opacity={0.9}
        depthWrite={false}
        depthTest={drawingDepthTest(mode)}
      />
    </mesh>
  );
}

/**
 * Every freehand drawing on the active scene, oldest first so a later stroke covers an earlier
 * one. Drawings are shared with the whole table (LAY-05), so they are never filtered by author
 * here; they are not entities either, so the strips carry no pointer handlers of their own and
 * never shadow board picking.
 */
export function DrawingLayer({
  strokes,
  sceneId,
  mode = '2d',
}: {
  strokes: readonly DrawStroke[];
  sceneId: string | null;
  mode?: ViewMode;
}) {
  const visible = useMemo(() => sceneStrokes(strokes, sceneId), [strokes, sceneId]);
  return (
    <group name="drawings">
      {visible.map((stroke) => (
        <StrokeStrip key={stroke.strokeId} stroke={stroke} mode={mode} />
      ))}
    </group>
  );
}
