import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { walkableFromEntity, type Scene } from '@mythic/shared';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import {
  aoePlacePayload,
  dragSize,
  placeDraft,
  sceneUnitReadout,
  sizeNoun,
  validAoEDraft,
  type AoEDraft,
} from '../tools/aoe-placement.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import { measurementScene } from '../tools/measurement-tool.js';
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
  const snap = useStore(rulerStore, (s) => s.snap);
  const draft = useStore(aoeToolStore, (s) => s.draft);
  const preview = useStore(aoeToolStore, (s) => s.preview);
  const busy = useStore(aoeToolStore, (s) => s.busy);
  const [readoutAt, setReadoutAt] = useState<{ x: number; z: number } | null>(null);
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
    const { shape, transform } = placeDraft(preview, measurementScene(scene));
    return { shape, position: transform.position, rotation: transform.rotation };
  }, [scene, active, preview, snap]);
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
        if (distance < 4) return;
        // UI-MEAS-04 / Q28: the drag both aims and sizes the shape. The draft follows too, so the
        // panel's size field reads live and the next click reuses the size.
        const degrees = (Math.atan2(p.x - press.origin.x, p.z - press.origin.z) * 180) / Math.PI;
        const size = dragSize(
          press.origin.kind,
          Math.hypot(p.x - press.origin.x, p.z - press.origin.z),
          measurementScene(state.scene).grid.snap,
        );
        aoeToolStore.getState().setPreview({ ...press.origin, degrees, size });
        aoeToolStore.getState().setDraft({ size });
        setReadoutAt({ x: p.x, z: p.z });
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
      setReadoutAt(null);
      pointerClaims.release(event.pointerId);
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      if (event.type === 'pointercancel') return;
      const state = latest.current;
      const d = aoeToolStore.getState().preview ?? current.origin;
      if (!state.scene || !state.submit || !validAoEDraft(d, state.scene.grid)) return;
      if (!state.identityId) return;
      const payload = aoePlacePayload(
        state.scene.id,
        state.identityId,
        d,
        measurementScene(state.scene),
      );
      aoeToolStore.getState().setBusy(true);
      void state
        .submit('aoe.place', payload, state.scene.id)
        .then((result) => {
          aoeToolStore.getState().setError(result.ok ? null : describeFailure(result));
          if (result.ok)
            aoeToolStore.getState().setDraft({ degrees: d.degrees, x: d.x, z: d.z, size: d.size });
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
  if (!volume || !scene || !preview) return null;
  return (
    <>
      <AoEVolume volume={volume} walkables={walkables} mode={mode} renderOrder={10} />
      {readoutAt && (
        // UI-MEAS-04: a live, camera-facing readout at the pointer while the drag sizes the shape
        // (CAM-04: screen-space HTML, no world-space text). Scene units only (GRID-02).
        <Html
          position={[readoutAt.x, volume.position.y + LIFT, readoutAt.z]}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[20, 0]}
        >
          <span style={pillStyle} data-testid="aoe-size-readout">
            {sizeReadout(preview, scene)}
          </span>
        </Html>
      )}
    </>
  );
}

const LIFT = 0.05;

const pillStyle = {
  display: 'inline-block',
  transform: 'translate(12px, -50%)',
  padding: '1px 6px',
  borderRadius: 4,
  background: LABEL_BACKGROUND_COLOR,
  color: LABEL_TEXT_COLOR,
  fontSize: 13,
  whiteSpace: 'nowrap',
  userSelect: 'none',
} as const;

/** "Radius 20 ft": what the drag is setting, in the scene's own unit. */
function sizeReadout(draft: AoEDraft, scene: Scene): string {
  const noun = sizeNoun(draft.kind);
  const value = sceneUnitReadout(draft.size, scene.grid);
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${String(value)} ${scene.grid.unitLabel}`;
}
