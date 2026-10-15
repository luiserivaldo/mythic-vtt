import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Vector3 } from 'three';
import { useStore } from 'zustand';
import { selectionStore } from '../tools/selection-store.js';
import { selectionAnchorStore } from '../ui/beside-token.js';
import { tokenMenuAnchor } from '../ui/token-menu.js';
import type { RenderScene } from './scene-model.js';

const side = new Vector3();

/**
 * UI-TOKEN-02 (MV-239): reports where the single selected entity is on screen, so its panels can
 * open beside it. It runs only on frames the board renders anyway (frameloop "demand"), and the
 * sides use the same anchor height as the token menus in 2D and 3D.
 */
export function SelectionAnchor({
  rendered,
  mode,
}: {
  rendered: RenderScene | null;
  mode: '2d' | '3d';
}) {
  const ids = useStore(selectionStore, (state) => state.ids);
  const invalidate = useThree((state) => state.invalidate);
  const entity =
    ids.length === 1 ? rendered?.entities.find((candidate) => candidate.id === ids[0]) : undefined;

  useEffect(() => {
    if (!entity) selectionAnchorStore.getState().setAnchor(null);
    else invalidate();
  }, [entity, invalidate]);
  useEffect(
    () => () => {
      selectionAnchorStore.getState().setAnchor(null);
    },
    [],
  );

  useFrame(({ camera, size }) => {
    if (!entity) return;
    const right = tokenMenuAnchor(mode, entity.position, entity.sizeCells);
    const screen = (x: number) => {
      side.set(x, right[1], right[2]).project(camera);
      return { x: ((side.x + 1) / 2) * size.width, y: ((1 - side.y) / 2) * size.height };
    };
    // Mirror the menu's right-hand anchor to the left; an orbit camera may swap them on screen.
    const a = screen(right[0]);
    const b = screen(2 * entity.position[0] - right[0]);
    selectionAnchorStore.getState().setAnchor({
      left: Math.min(a.x, b.x),
      right: Math.max(a.x, b.x),
      y: (a.y + b.y) / 2,
    });
  });
  return null;
}
