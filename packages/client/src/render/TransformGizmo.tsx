import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { OrthographicCamera } from 'three';
import { SubmitContext } from '../ui/submit.js';
import { commitTransform } from '../tools/gizmo-commit.js';
import { gizmoStore } from '../tools/gizmo-store.js';
import {
  applyMove,
  applyRotate,
  applyScale,
  draftFromEntity,
  entityExtents,
  handleLayout,
  hitHandle,
  HANDLE_HIT_PX,
  snapFootprint,
  type GizmoDraft,
  type HandleKind,
  type Xz,
} from '../tools/transform-gizmo.js';
import { useGizmoTarget } from '../tools/use-gizmo-target.js';
import { screenToWorld, type View2D } from './camera-2d.js';
import { GIZMO_MOVE_COLOR, GIZMO_ROTATE_COLOR, GIZMO_SCALE_COLOR } from './canvas-style.js';
import { pointerClaims } from './pointer-claims.js';

const SQUARE = new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]);
const COLOR = GIZMO_MOVE_COLOR;

interface Drag {
  kind: HandleKind;
  pointerId: number;
  pointerStart: Xz;
  startDraft: GizmoDraft;
  moved: boolean;
}

/**
 * ENV-03 (2D): move / rotate / scale handles on the XZ plane for the one selected entity the
 * viewer may transform. Handles are drawn at a constant pixel size; hit-testing and snapping
 * live in tools/transform-gizmo.ts. The drag is preview-only until release, which sends a
 * single entity.update (D34); nothing is broadcast while dragging (M1-07).
 */
export function TransformGizmo() {
  const target = useGizmoTarget();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const submit = useContext(SubmitContext);
  const preview = useStore(gizmoStore, (s) => s.preview);
  const [pxPerUnit, setPxPerUnit] = useState(48);

  const entity = target?.entity ?? null;
  const live = preview && entity && preview.entityId === entity.id ? preview.draft : null;
  const draft = useMemo(() => live ?? (entity ? draftFromEntity(entity) : null), [live, entity]);

  // Latest values for the long-lived native listeners.
  const latest = useRef({ target, draft, submit });
  latest.current = { target, draft, submit };

  useFrame(({ camera }) => {
    const zoom = (camera as OrthographicCamera).zoom;
    if (Math.abs(zoom - pxPerUnit) > 1e-6) setPxPerUnit(zoom);
  });

  // A different selection, or losing permission, drops any preview.
  const entityId = entity?.id ?? null;
  useEffect(() => {
    const p = gizmoStore.getState().preview;
    if (p && p.entityId !== entityId) {
      gizmoStore.getState().clear();
      invalidate();
    }
  }, [entityId, invalidate]);

  // The host's patch landed (or timed out): hand the entity back to stored state.
  const settling = preview?.settling === true;
  const storedTransform = entity?.transform;
  useEffect(() => {
    if (!settling) return;
    const p = gizmoStore.getState().preview;
    if (p && storedTransform && storedTransform !== p.base) {
      gizmoStore.getState().clear();
      invalidate();
      return;
    }
    const timer = setTimeout(() => {
      gizmoStore.getState().clear();
      invalidate();
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [settling, storedTransform, invalidate]);

  useEffect(() => {
    if (!entityId) return;
    const el = gl.domElement;
    let drag: Drag | null = null;
    let swallowClick = false;

    const view = (): View2D => {
      const c = getState().camera as OrthographicCamera;
      return { centerX: c.position.x, centerZ: c.position.z, zoom: c.zoom };
    };
    const toWorld = (e: { clientX: number; clientY: number }): Xz => {
      const r = el.getBoundingClientRect();
      const p = screenToWorld(
        view(),
        { width: r.width, height: r.height },
        {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        },
      );
      return { x: p.x, z: p.y };
    };

    const onDown = (e: PointerEvent) => {
      swallowClick = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const { target: t, draft: d } = latest.current;
      if (!t || !d) return;
      const zoom = view().zoom;
      const extents = entityExtents(t.entity);
      const half =
        (Math.max(extents.width, extents.depth) * d.scale) / (t.entity.transform.scale.x || 1) / 2;
      const layout = handleLayout({ x: d.x, z: d.z }, d.yaw, half, 1 / zoom);
      const point = toWorld(e);
      const kind = hitHandle(point, layout, HANDLE_HIT_PX / zoom);
      if (!kind) return;
      // Claim before PanZoomControls sees the press, and keep the click away from picking.
      pointerClaims.claim(e.pointerId, '2D gizmo');
      swallowClick = true;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      drag = { kind, pointerId: e.pointerId, pointerStart: point, startDraft: d, moved: false };
      gizmoStore.getState().begin({
        sceneId: t.scene.id,
        entityId: t.entity.id,
        draft: d,
        base: t.entity.transform,
      });
      invalidate();
    };

    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { target: t } = latest.current;
      if (!t) return;
      const pointer = toWorld(e);
      const start = drag.startDraft;
      const center = { x: start.x, z: start.z };
      let next: GizmoDraft;
      if (drag.kind === 'move') {
        const extents = entityExtents(t.entity);
        const moved = applyMove({
          start: center,
          pointerStart: drag.pointerStart,
          pointer,
          grid: t.scene.grid,
          footprint: snapFootprint(extents),
          y: t.entity.transform.position.y,
        });
        next = { ...start, x: moved.x, z: moved.z };
      } else if (drag.kind === 'rotate') {
        next = {
          ...start,
          yaw: applyRotate({
            center,
            pointerStart: drag.pointerStart,
            pointer,
            startYaw: start.yaw,
            grid: t.scene.grid,
          }),
        };
      } else {
        next = {
          ...start,
          scale: applyScale({
            center,
            pointerStart: drag.pointerStart,
            pointer,
            startScale: start.scale,
            grid: t.scene.grid,
          }),
        };
      }
      drag.moved = true;
      gizmoStore.getState().update(next);
      invalidate();
    };

    const finish = (e: PointerEvent, commit: boolean) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const done = drag;
      drag = null;
      pointerClaims.release(done.pointerId);
      if (el.hasPointerCapture(done.pointerId)) el.releasePointerCapture(done.pointerId);
      const { target: t, submit: send } = latest.current;
      const p = gizmoStore.getState().preview;
      if (!commit || !done.moved || !t || !p || !send) {
        gizmoStore.getState().clear();
        invalidate();
        return;
      }
      void commitTransform({
        submit: send,
        store: gizmoStore,
        sceneId: t.scene.id,
        entity: t.entity,
        draft: p.draft,
      }).then(() => {
        invalidate();
      });
    };
    const onUp = (e: PointerEvent) => {
      finish(e, true);
    };
    const onCancel = (e: PointerEvent) => {
      finish(e, false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag) {
        pointerClaims.release(drag.pointerId);
        drag = null;
        gizmoStore.getState().clear();
        invalidate();
      }
    };
    const onClickCapture = (e: MouseEvent) => {
      if (swallowClick) {
        e.stopPropagation();
        swallowClick = false;
      }
    };

    // Capture phase: must run before PanZoomControls' own pointerdown handler.
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (drag) pointerClaims.release(drag.pointerId);
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [entityId, gl, invalidate, getState]);

  if (!target || !entity || !draft) return null;

  const wpp = 1 / pxPerUnit;
  const extents = entityExtents(entity);
  const baseScale = entity.transform.scale.x || 1;
  const ratio = draft.scale / baseScale;
  const width = extents.width * ratio;
  const depth = extents.depth * ratio;
  const half = Math.max(width, depth) / 2;
  const layout = handleLayout({ x: draft.x, z: draft.z }, draft.yaw, half, wpp);
  const y = entity.transform.position.y + 0.05;
  const noRaycast = () => null;

  return (
    <group position={[0, y, 0]} renderOrder={1000}>
      <group
        position={[draft.x, 0, draft.z]}
        rotation={[0, draft.yaw, 0]}
        scale={[width, 1, depth]}
      >
        <lineLoop raycast={noRaycast} renderOrder={1000}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[SQUARE, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={COLOR} depthTest={false} />
        </lineLoop>
      </group>
      <mesh
        position={[layout.move.x, 0, layout.move.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={wpp}
        renderOrder={1001}
        raycast={noRaycast}
      >
        <circleGeometry args={[5, 20]} />
        <meshBasicMaterial color={COLOR} depthTest={false} transparent opacity={0.9} />
      </mesh>
      <mesh
        position={[layout.rotate.x, 0, layout.rotate.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={wpp}
        renderOrder={1001}
        raycast={noRaycast}
      >
        <circleGeometry args={[7, 24]} />
        <meshBasicMaterial color={GIZMO_ROTATE_COLOR} depthTest={false} />
      </mesh>
      <mesh
        position={[layout.scale.x, 0, layout.scale.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={wpp}
        renderOrder={1001}
        raycast={noRaycast}
      >
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial color={GIZMO_SCALE_COLOR} depthTest={false} />
      </mesh>
    </group>
  );
}
