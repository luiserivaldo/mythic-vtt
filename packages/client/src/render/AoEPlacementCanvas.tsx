import { useThree } from '@react-three/fiber';
import { walkableFromEntity, type Scene } from '@mythic/shared';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import {
  aoePlacePayload,
  placeDraft,
  validAoEDraft,
  type AoEDraft,
} from '../tools/aoe-placement.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { useJoinEnv } from '../ui/join-context.js';
import { describeFailure, SubmitContext } from '../ui/submit.js';
import { AoEVolume } from './AoEVolume.js';
import { pointerClaims } from './pointer-claims.js';
import type { RenderMode } from './PrimitiveMesh.js';

/** Native capture owns the pointer before pan or picking, in both cameras. */
export function AoEPlacementCanvas({ scene, mode }: { scene: Scene | null; mode: RenderMode }) {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const submit = useContext(SubmitContext);
  const identityId = useJoinEnv()?.identityId ?? null;
  const active = useStore(aoeToolStore, (s) => s.active);
  const draft = useStore(aoeToolStore, (s) => s.draft);
  const preview = useStore(aoeToolStore, (s) => s.preview);
  const busy = useStore(aoeToolStore, (s) => s.busy);
  const latest = useRef({ scene, draft, submit, active, busy, identityId });
  latest.current = { scene, draft, submit, active, busy, identityId };
  const walkables = useMemo(
    () =>
      Object.values(scene?.entities ?? {}).flatMap((entity) => {
        const surface = walkableFromEntity(entity);
        return surface ? [surface] : [];
      }),
    [scene],
  );
  const volume = useMemo(() => {
    if (!scene || !active || !preview || !validAoEDraft(preview, scene.grid)) return null;
    const { shape, transform } = placeDraft(preview, scene);
    return { shape, position: transform.position, rotation: transform.rotation };
  }, [scene, active, preview]);
  useEffect(() => {
    invalidate();
  }, [volume, invalidate]);

  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    let press: { id: number; origin: AoEDraft; clientX: number; clientY: number } | null = null;
    let removePress: { id: number; entityId: string } | null = null;
    let consumed = false;
    let consumedContextMenu = false;
    const aim = (event: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
      ray.setFromCamera(ndc, get().camera);
    };
    const point = (event: PointerEvent) => {
      aim(event);
      return ray.ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
    };
    const entityIdFor = (object: Object3D, currentScene: Scene) => {
      let candidate: Object3D | null = object;
      while (candidate) {
        if (candidate.name && currentScene.entities[candidate.name]?.aoe) return candidate.name;
        candidate = candidate.parent;
      }
      return null;
    };
    const inside = (x: number, z: number, scene: Scene) => {
      const width = scene.bounds?.width ?? 40;
      const height = scene.bounds?.height ?? 30;
      return x >= 0 && x <= width && z >= 0 && z <= height;
    };
    const down = (event: PointerEvent) => {
      const state = latest.current;
      if (
        event.pointerType === 'mouse' &&
        event.button === 2 &&
        !state.busy &&
        state.scene &&
        state.submit &&
        state.identityId
      ) {
        const currentScene = state.scene;
        aim(event);
        const entityId = ray
          .intersectObjects(get().scene.children, true)
          .map(({ object }) => entityIdFor(object, currentScene))
          .find((id) => id === state.identityId);
        if (entityId) {
          consumedContextMenu = true;
          pointerClaims.claim(event.pointerId, 'AoE quick delete');
          event.preventDefault();
          event.stopImmediatePropagation();
          el.setPointerCapture(event.pointerId);
          removePress = { id: event.pointerId, entityId };
        }
        return;
      }
      if (
        !state.active ||
        state.busy ||
        !state.scene ||
        !state.identityId ||
        (event.pointerType === 'mouse' && event.button !== 0)
      )
        return;
      const p = point(event);
      if (!p || !inside(p.x, p.z, state.scene)) return;
      consumed = true;
      pointerClaims.claim(event.pointerId, 'AoE placement');
      event.stopImmediatePropagation();
      el.setPointerCapture(event.pointerId);
      const origin = { ...state.draft, ...p };
      press = { id: event.pointerId, origin, clientX: event.clientX, clientY: event.clientY };
      aoeToolStore.getState().setPreview(origin);
    };
    const move = (event: PointerEvent) => {
      const state = latest.current;
      if (!state.active || !state.scene) return;
      const p = point(event);
      if (!p) return;
      if (press?.id === event.pointerId) {
        const distance = Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY);
        const degrees =
          distance >= 4
            ? (Math.atan2(p.x - press.origin.x, p.z - press.origin.z) * 180) / Math.PI
            : press.origin.degrees;
        aoeToolStore.getState().setPreview({ ...press.origin, degrees });
      } else if (inside(p.x, p.z, state.scene))
        aoeToolStore.getState().setPreview({ ...state.draft, ...p });
    };
    const end = (event: PointerEvent) => {
      if (removePress?.id === event.pointerId) {
        const current = removePress;
        removePress = null;
        pointerClaims.release(event.pointerId);
        if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
        if (event.type === 'pointercancel') return;
        const state = latest.current;
        if (!state.scene || !state.submit) return;
        aoeToolStore.getState().setBusy(true);
        void state
          .submit(
            'aoe.remove',
            { sceneId: state.scene.id, entityId: current.entityId },
            state.scene.id,
          )
          .then((result) => {
            aoeToolStore.getState().setError(result.ok ? null : describeFailure(result));
          })
          .finally(() => {
            aoeToolStore.getState().setBusy(false);
            invalidate();
          });
        return;
      }
      if (press?.id !== event.pointerId) return;
      const current = press;
      press = null;
      pointerClaims.release(event.pointerId);
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      if (event.type === 'pointercancel') return;
      const state = latest.current;
      const d = aoeToolStore.getState().preview ?? current.origin;
      if (!state.scene || !state.submit || !validAoEDraft(d, state.scene.grid)) return;
      if (!state.identityId) return;
      const payload = aoePlacePayload(state.scene.id, state.identityId, d, state.scene);
      aoeToolStore.getState().setBusy(true);
      void state
        .submit('aoe.place', payload, state.scene.id)
        .then((result) => {
          aoeToolStore.getState().setError(result.ok ? null : describeFailure(result));
          if (result.ok) aoeToolStore.getState().setDraft({ degrees: d.degrees, x: d.x, z: d.z });
        })
        .finally(() => {
          aoeToolStore.getState().setBusy(false);
        });
    };
    const click = (event: MouseEvent) => {
      if (consumed) {
        event.stopImmediatePropagation();
        consumed = false;
      }
    };
    const contextmenu = (event: MouseEvent) => {
      if (!consumedContextMenu) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      consumedContextMenu = false;
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', click, true);
    el.addEventListener('contextmenu', contextmenu, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('click', click, true);
      el.removeEventListener('contextmenu', contextmenu, true);
      if (press) pointerClaims.release(press.id);
      if (removePress) pointerClaims.release(removePress.id);
    };
  }, [gl, get, invalidate]);
  return volume ? (
    <AoEVolume volume={volume} walkables={walkables} mode={mode} renderOrder={10} />
  ) : null;
}
