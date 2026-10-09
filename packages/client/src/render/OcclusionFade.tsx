import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Mesh, Vector3 } from 'three';
import { useStore } from 'zustand';
import { selectionStore } from '../tools/selection-store.js';
import { OcclusionFadeController } from './occlusion-fade.js';
import type { RenderScene } from './scene-model.js';
import { standeeDimensions } from './token-standee.js';

/** Renderer-local fading; only already-filtered meshes can participate (PERM-03). */
export function OcclusionFade({ rendered }: { rendered: RenderScene | null }) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const selected = useStore(selectionStore, (state) => state.ids);
  const controller = useMemo(() => new OcclusionFadeController(), []);
  const meshes = useRef<Mesh[]>([]);
  const dirty = useRef(true);
  const previousCamera = useRef(new Vector3(Infinity, Infinity, Infinity));
  const targets = useMemo(
    () =>
      (rendered?.entities ?? []).flatMap((entity) => {
        if (!entity.token || !selected.includes(entity.id)) return [];
        const [x, y, z] = entity.position;
        const dimensions = standeeDimensions(entity.sizeCells);
        return [new Vector3(x, y + dimensions.baseThickness + dimensions.height / 2, z)];
      }),
    [rendered, selected],
  );

  useEffect(() => {
    const ids = new Set(
      (rendered?.entities ?? []).filter((entity) => entity.shape).map((entity) => entity.id),
    );
    meshes.current = [];
    scene.traverse((object) => {
      if (object instanceof Mesh && object.visible && ids.has(object.name))
        meshes.current.push(object as Mesh);
    });
    dirty.current = true;
    invalidate();
  }, [rendered, selected, scene, invalidate]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const diagnostics = {
      getMaterials: () =>
        meshes.current.map((mesh) => {
          const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          return {
            id: mesh.name,
            opacity: material?.opacity ?? 1,
            depthWrite: material?.depthWrite ?? true,
          };
        }),
    };
    window.__mythicOcclusion = diagnostics;
    return () => {
      if (window.__mythicOcclusion === diagnostics) delete window.__mythicOcclusion;
    };
  }, []);

  useEffect(
    () => () => {
      controller.reset();
    },
    [controller],
  );
  useFrame(({ camera }) => {
    if (!dirty.current && previousCamera.current.equals(camera.position)) return;
    dirty.current = false;
    previousCamera.current.copy(camera.position);
    scene.updateMatrixWorld();
    controller.update(camera.position, targets, meshes.current);
    // Camera/input/store changes already schedule this frame; fading needs no animation loop.
  });
  return null;
}
