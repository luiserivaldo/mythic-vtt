import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Raycaster, Vector2 } from 'three';
import { useStore } from 'zustand';
import type { Scene } from '@mythic/shared';
import { selectionStore } from '../tools/selection-store.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import { hoveredTokenId } from './pick-entity.js';
import { formatRangeBreakdown, rangeTarget, selectedTokenId } from './range-readout.js';

/** Lifts the pill off the board so a flat 2D token never z-fights with it. */
const LIFT = 0.05;

const pillStyle = {
  padding: '1px 6px',
  borderRadius: 4,
  background: LABEL_BACKGROUND_COLOR,
  color: LABEL_TEXT_COLOR,
  fontSize: 13,
  whiteSpace: 'nowrap',
  userSelect: 'none',
} as const;

/**
 * MEAS-05: with exactly one token selected, hovering another token shows the token-to-token range
 * — horizontal, vertical and total in scene units. The same readout serves 2D and 3D: the pick
 * walks a ray hit up to its entity, so the 2D sprite and the 3D standee both resolve, and a prop or
 * the board under the pointer is simply not a target at all. `Html` keeps the text camera-facing
 * (CAM-04, no world-space text). Hovering is local view state that never changes game state and is
 * never logged (PERM-01); the readout carries distances only, never a token name, so the
 * label-visibility rules (TOK-04) cannot leak through it.
 */
export function RangeReadout({ scene }: { scene: Scene | null }) {
  const gl = useThree((state) => state.gl);
  const getState = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const selected = useStore(selectionStore, (state) => state.ids);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // The pointer handlers outlive a render, so they read the live scene through a ref (as RulerTool
  // does). A hovered id is only meaningful inside the scene it was picked in.
  const latest = useRef(scene);
  latest.current = scene;
  const sceneId = scene?.id ?? null;
  const originId = selectedTokenId(scene, selected);
  const target = rangeTarget(scene, selected, hoveredId);

  useEffect(() => {
    setHoveredId(null);
  }, [sceneId]);

  useEffect(() => {
    // No selected token means there is nothing to measure from, so no hover picking at all.
    if (originId === null) {
      setHoveredId(null);
      return;
    }
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const onMove = (event: PointerEvent) => {
      const current = latest.current;
      const box = el.getBoundingClientRect();
      if (!current || box.width === 0 || box.height === 0) return;
      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - box.left) / box.width) * 2 - 1,
          -(((event.clientY - box.top) / box.height) * 2 - 1),
        ),
        getState().camera,
      );
      setHoveredId(
        hoveredTokenId(raycaster.intersectObjects(getState().scene.children, true), current),
      );
    };
    const onLeave = () => {
      setHoveredId(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      // The effect re-runs only on the origin or the scene; keep it attached across hover changes.
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      setHoveredId(null);
    };
  }, [gl, getState, originId, sceneId]);

  useEffect(() => {
    invalidate();
  }, [invalidate, originId, hoveredId]);

  if (!target) return null;
  return (
    <Html
      center
      position={[target.target.x, target.target.y + LIFT, target.target.z]}
      zIndexRange={[7, 0]}
      style={{ pointerEvents: 'none', transform: 'translateY(-30px)' }}
    >
      <div data-testid="range-readout" style={pillStyle}>
        {formatRangeBreakdown(
          target.measurement.horizontalLabel,
          target.measurement.verticalLabel,
          target.measurement.label,
        )}
      </div>
    </Html>
  );
}
