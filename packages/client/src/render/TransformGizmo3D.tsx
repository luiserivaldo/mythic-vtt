import { yawFromQuaternion } from '@mythic/shared';
import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { Raycaster, Vector2, Vector3, type Group, type PerspectiveCamera } from 'three';
import { useStore } from 'zustand';
import { SubmitContext } from '../ui/submit.js';
import { commitTransform } from '../tools/gizmo-commit.js';
import { gizmoStore } from '../tools/gizmo-store.js';
import {
  applyMove,
  entityExtents,
  snapFootprint,
  type GizmoDraft,
} from '../tools/transform-gizmo.js';
import {
  axisVector,
  draft3dFromEntity,
  handleAnchors,
  handlesFor,
  hitScreenHandle,
  HANDLE_HIT_PX_3D,
  HANDLE_LENGTH_PX,
  intersectRayPlane,
  projectRayToAxis,
  rotateDraft,
  signedAngleAroundAxis,
  snapLinear,
  worldPerPixelAt,
  type Gizmo3DHandle,
  type RotationAxis,
  type Vec3Like,
} from '../tools/transform-gizmo-3d.js';
import { useGizmoTarget3D } from '../tools/use-gizmo-target-3d.js';
import { GIZMO_MOVE_COLOR, GIZMO_ROTATE_COLOR, GIZMO_SCALE_COLOR } from './canvas-style.js';
import { pointerClaims } from './pointer-claims.js';
import { assetUrl } from '../assets/asset-url.js';
import { mapTextureAspect, useMapTexture } from './use-texture.js';

const COLORS: Record<Gizmo3DHandle, string> = {
  'move-xz': GIZMO_MOVE_COLOR,
  'move-y': GIZMO_SCALE_COLOR,
  'rotate-x': '#b91c1c',
  'rotate-y': '#6d28d9',
  'rotate-z': GIZMO_ROTATE_COLOR,
};
/** Handle blob radius in unit-reach space (HANDLE_LENGTH_PX = 1). */
const BLOB = 7 / HANDLE_LENGTH_PX;
const noRaycast = () => null;
const ROTATE_AXIS: Partial<Record<Gizmo3DHandle, RotationAxis>> = {
  'rotate-x': 'x',
  'rotate-y': 'y',
  'rotate-z': 'z',
};

interface Drag {
  kind: Gizmo3DHandle;
  pointerId: number;
  startDraft: GizmoDraft;
  /** Axis parameter (vertical handle) or plane point (the others) at press. */
  startT: number;
  startPoint: Vec3Like;
  moved: boolean;
}

/**
 * ENV-03/ENV-04 (3D): vertical (Y) move, ground-plane (XZ) move and 3-axis rotation handles
 * for the selected prop/primitive; tokens get the vertical handle only. Handles are constant
 * screen size. The drag previews locally and sends ONE entity.update on release (D34); a
 * reject reverts. Snapping follows the scene grid (D25); Shift drags free.
 */
export function TransformGizmo3D() {
  const target = useGizmoTarget3D();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const submit = useContext(SubmitContext);
  const preview = useStore(gizmoStore, (s) => s.preview);
  const groupRef = useRef<Group>(null);
  const draftPosition = useMemo(() => new Vector3(), []);

  const entity = target?.entity ?? null;
  const texture = useMapTexture(
    entity?.layer === 'map' && entity.image ? assetUrl('', entity.image.asset) : null,
  );
  const imageAspect = mapTextureAspect(texture);
  const live = preview && entity && preview.entityId === entity.id ? preview.draft : null;
  const draft = useMemo(() => live ?? (entity ? draft3dFromEntity(entity) : null), [live, entity]);
  const kinds = useMemo(() => (target ? handlesFor(target.kind) : []), [target]);

  const latest = useRef({ target, draft, submit, kinds, imageAspect });
  latest.current = { target, draft, submit, kinds, imageAspect };

  // Constant screen size: rescale from the camera distance every frame.
  useFrame(({ camera, size }) => {
    const g = groupRef.current;
    const d = latest.current.draft;
    if (!g || !d) return;
    const distance = camera.position.distanceTo(draftPosition.set(d.x, d.y ?? 0, d.z));
    const fov = (camera as PerspectiveCamera).fov;
    g.scale.setScalar(worldPerPixelAt(distance, fov, size.height) * HANDLE_LENGTH_PX);
  });

  const entityId = entity?.id ?? null;
  useEffect(() => {
    const p = gizmoStore.getState().preview;
    if (p && p.entityId !== entityId) {
      gizmoStore.getState().clear();
      invalidate();
    }
  }, [entityId, invalidate]);

  const settling = preview?.settling === true;
  const storedTransform = entity?.transform;
  const storedTokenSize = entity?.token?.sizeCells;
  useEffect(() => {
    if (!settling) return;
    const p = gizmoStore.getState().preview;
    if (
      p &&
      storedTransform &&
      (storedTransform !== p.base || storedTokenSize !== p.baseTokenSize)
    ) {
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
  }, [settling, storedTransform, storedTokenSize, invalidate]);

  useEffect(() => {
    if (!entityId) return;
    const el = gl.domElement;
    const raycaster = new Raycaster();
    let drag: Drag | null = null;
    let swallowClick = false;

    const rect = () => el.getBoundingClientRect();
    const rayAt = (e: { clientX: number; clientY: number }) => {
      const r = rect();
      const ndc = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, getState().camera);
      const { origin, direction } = raycaster.ray;
      return {
        origin: { x: origin.x, y: origin.y, z: origin.z },
        direction: { x: direction.x, y: direction.y, z: direction.z },
      };
    };
    const centerOf = (d: GizmoDraft): Vec3Like => ({ x: d.x, y: d.y ?? 0, z: d.z });

    /** Where the pointer currently points, in the handle's own measure. */
    const sample = (
      kind: Gizmo3DHandle,
      e: { clientX: number; clientY: number },
      d: GizmoDraft,
    ): { t: number; point: Vec3Like } | null => {
      const ray = rayAt(e);
      const c = centerOf(d);
      if (kind === 'move-y') {
        const t = projectRayToAxis(ray.origin, ray.direction, c, axisVector('y'));
        return t === null ? null : { t, point: c };
      }
      const axis = ROTATE_AXIS[kind];
      const hit = intersectRayPlane(ray.origin, ray.direction, c, axisVector(axis ?? 'y'));
      return hit ? { t: 0, point: hit } : null;
    };

    const onDown = (e: PointerEvent) => {
      swallowClick = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const { target: t, draft: d, kinds: ks } = latest.current;
      if (!t || !d || ks.length === 0) return;
      const camera = getState().camera as PerspectiveCamera;
      const r = rect();
      const c = centerOf(d);
      const distance = camera.position.distanceTo(new Vector3(c.x, c.y, c.z));
      const reach = worldPerPixelAt(distance, camera.fov, r.height) * HANDLE_LENGTH_PX;
      camera.updateMatrixWorld();
      const handles = handleAnchors(c, reach, ks).map((h) => {
        const p = new Vector3(h.position.x, h.position.y, h.position.z).project(camera);
        return {
          kind: h.kind,
          px: { x: ((p.x + 1) / 2) * r.width, y: ((1 - p.y) / 2) * r.height },
        };
      });
      const kind = hitScreenHandle(
        { x: e.clientX - r.left, y: e.clientY - r.top },
        handles,
        HANDLE_HIT_PX_3D,
      );
      if (!kind) return;
      const start = sample(kind, e, d);
      if (!start) return;
      pointerClaims.claim(e.pointerId, '3D gizmo');
      swallowClick = true;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      drag = {
        kind,
        pointerId: e.pointerId,
        startDraft: d,
        startT: start.t,
        startPoint: start.point,
        moved: false,
      };
      gizmoStore.getState().begin({
        sceneId: t.scene.id,
        entityId: t.entity.id,
        draft: d,
        base: t.entity.transform,
        baseTokenSize: t.entity.token?.sizeCells,
      });
      invalidate();
    };

    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { target: t } = latest.current;
      if (!t) return;
      const now = sample(drag.kind, e, drag.startDraft);
      if (!now) return;
      const start = drag.startDraft;
      const snap = t.scene.grid.snap && !e.shiftKey;
      let next: GizmoDraft;
      if (drag.kind === 'move-y') {
        next = { ...start, y: snapLinear((start.y ?? 0) + now.t - drag.startT, snap) };
      } else if (drag.kind === 'move-xz') {
        const moved = applyMove({
          start: { x: start.x, z: start.z },
          pointerStart: { x: drag.startPoint.x, z: drag.startPoint.z },
          pointer: { x: now.point.x, z: now.point.z },
          grid: snap ? t.scene.grid : { ...t.scene.grid, snap: false },
          footprint: snapFootprint(entityExtents(t.entity, latest.current.imageAspect)),
          y: start.y ?? 0,
        });
        next = { ...start, x: moved.x, z: moved.z };
      } else {
        const axis = ROTATE_AXIS[drag.kind];
        const c = centerOf(start);
        const from = {
          x: drag.startPoint.x - c.x,
          y: drag.startPoint.y - c.y,
          z: drag.startPoint.z - c.z,
        };
        const to = { x: now.point.x - c.x, y: now.point.y - c.y, z: now.point.z - c.z };
        if (!axis || Math.hypot(to.x, to.y, to.z) < 1e-6) return;
        const angle = signedAngleAroundAxis(from, to, axisVector(axis));
        const q = rotateDraft(start.rotation ?? t.entity.transform.rotation, axis, angle, snap);
        next = { ...start, rotation: q, yaw: yawFromQuaternion(q) };
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

    // Capture phase, claim first: TokenDrag declines a claimed pointer and the orbit camera
    // only uses right/middle buttons, so a left-drag on a handle moves only the entity.
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

  const anchors = handleAnchors({ x: 0, y: 0, z: 0 }, 1, kinds);
  return (
    <group
      ref={groupRef}
      name="transform-gizmo-3d"
      position={[draft.x, draft.y ?? 0, draft.z]}
      renderOrder={1000}
    >
      {anchors.map(({ kind, position }) => (
        <group key={kind}>
          {kind !== 'move-xz' && (
            <lineSegments raycast={noRaycast} renderOrder={1000}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([0, 0, 0, position.x, position.y, position.z]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={COLORS[kind]} depthTest={false} />
            </lineSegments>
          )}
          <mesh
            position={[position.x, position.y, position.z]}
            scale={kind === 'move-xz' ? BLOB * 1.3 : BLOB}
            renderOrder={1001}
            raycast={noRaycast}
          >
            {kind.startsWith('rotate') ? (
              <octahedronGeometry args={[1]} />
            ) : (
              <sphereGeometry args={[1, 12, 8]} />
            )}
            <meshBasicMaterial color={COLORS[kind]} depthTest={false} transparent opacity={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
