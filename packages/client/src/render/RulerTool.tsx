import { RulerPreview } from '@mythic/protocol';
import { useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { Raycaster, Vector2, type Object3D } from 'three';
import { useStore } from 'zustand';
import type { Scene, Vec3 } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import { rulerStore } from '../tools/ruler-store.js';
import { measurementScene } from '../tools/measurement-tool.js';
import { intersectPlaneY } from '../tools/token-drag.js';
import {
  appendWaypoint,
  prepareRulerPoint,
  RULER_HEARTBEAT_MS,
  rulerExpired,
  rulerDragStarted,
  rulerOwnerName,
  shouldSendRuler,
  withCursor,
  type RulerPhase,
} from '../tools/ruler.js';
import { prepareRulerPoint3d } from '../tools/ruler-3d.js';
import { EphemeralContext } from '../ui/ephemeral-context.js';
import { pointerClaims } from './pointer-claims.js';
import { RulerPath } from './RulerPath.js';
import { RULER_LOCAL_COLOR, RULER_REMOTE_COLOR } from './canvas-style.js';
import type { ViewMode } from './view-mode-store.js';

const NO_REMOTE: readonly never[] = [];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * MEAS-01/02: the multi-waypoint ruler uses the ground plane in 2D and ray-hit surfaces in 3D.
 * While the tool is armed a press claims its pointer (pointer-claims) so the camera does not
 * pan and TokenDrag does not start. A drag measures until release, optionally retaining the result;
 * a short press retains click-to-add waypoints. A short token click while idle exits the tool so the
 * normal selection handler can run. Right-click or Esc clears. The path is render-local plus an
 * ephemeral relay; nothing is an action.
 */
function entityIdForObject(object: Object3D, scene: Scene): string | undefined {
  let current: Object3D | null = object;
  while (current) {
    if (current.name && scene.entities[current.name]) return current.name;
    current = current.parent;
  }
  return undefined;
}

export function RulerTool({ mode = '2d' }: { mode?: ViewMode }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useClientStore((s) => s.campaign);
  const scene: Scene | null = campaign?.activeSceneId
    ? (campaign.scenes[campaign.activeSceneId] ?? null)
    : null;
  const latest = useRef({ scene, ephemeral, mode });
  latest.current = { scene, ephemeral, mode };
  const sceneId = scene?.id ?? null;

  const measurementMode = useStore(rulerStore, (s) => s.mode);
  const phase = useStore(rulerStore, (s) => s.phase);
  const points = useStore(rulerStore, (s) => s.points);
  const cursor = useStore(rulerStore, (s) => s.cursor);
  const remote = useStore(rulerStore, (s) => s.remote);
  const storedSceneId = useStore(rulerStore, (s) => s.sceneId);
  const seats = campaign?.seats;

  // A ruler belongs to one scene; switching scenes drops it.
  useEffect(() => {
    if (storedSceneId !== null && storedSceneId !== sceneId) rulerStore.getState().clear();
  }, [sceneId, storedSceneId]);

  useEffect(() => {
    invalidate();
  }, [phase, points, cursor, remote, invalidate]);

  // Other clients' rulers; expire them when their heartbeat stops.
  useEffect(() => {
    const off = ephemeral?.on((m) => {
      if (m.channel !== 'ruler.preview' || !m.from) return;
      // The host echoes ephemerals to their sender; the local path already represents this user.
      if (m.from === ephemeral.identityId) return;
      const parsed = RulerPreview.shape.data.safeParse(m.data);
      if (!parsed.success) return;
      const { sceneId: sid, points: pts, phase: ph } = parsed.data;
      rulerStore
        .getState()
        .setRemote(
          m.from,
          ph === 'cancelled' ? null : { sceneId: sid, points: pts, phase: ph, at: Date.now() },
        );
    });
    const timer = setInterval(() => {
      rulerStore.getState().pruneRemote((r) => rulerExpired(r, Date.now()));
    }, 500);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, [ephemeral]);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    let down: {
      pointerId: number;
      x: number;
      y: number;
      point: Vec3;
      tokenId: string | null;
      beganMeasurement: boolean;
      dragging: boolean;
    } | null = null;
    let lastSentAt: number | null = null;

    const publish = (kind: RulerPhase, force: boolean) => {
      const { scene: sc, ephemeral: eph } = latest.current;
      if (!eph || !sc) return;
      if (kind !== 'cancelled' && !rulerStore.getState().broadcast) return;
      const s = rulerStore.getState();
      const path =
        kind === 'cancelled' ? [] : kind === 'active' ? withCursor(s.points, s.cursor) : s.points;
      if (kind !== 'cancelled' && path.length === 0) return;
      const now = Date.now();
      if (!shouldSendRuler(lastSentAt, now, force)) return;
      lastSentAt = now;
      eph.send('ruler.preview', { sceneId: sc.id, points: path, phase: kind });
    };

    const pointAt = (e: { clientX: number; clientY: number }): Vec3 | null => {
      const source = latest.current.scene;
      const sc = source ? measurementScene(source) : null;
      if (!sc) return null;
      const r = el.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, getState().camera);
      if (rulerStore.getState().mode === '3d') {
        for (const intersection of raycaster.intersectObjects(getState().scene.children, true)) {
          const entityId = entityIdForObject(intersection.object, sc);
          if (!entityId) continue;
          return prepareRulerPoint3d(
            { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z },
            sc,
            entityId,
          );
        }
      }
      const { origin, direction } = raycaster.ray;
      const hit = intersectPlaneY(
        {
          origin: { x: origin.x, y: origin.y, z: origin.z },
          direction: { x: direction.x, y: direction.y, z: direction.z },
        },
        0,
      );
      return hit
        ? rulerStore.getState().mode === '3d'
          ? prepareRulerPoint3d(hit, sc)
          : prepareRulerPoint(hit, sc)
        : null;
    };

    const tokenAt = (e: { clientX: number; clientY: number }): string | null => {
      const source = latest.current.scene;
      const sc = source ? measurementScene(source) : null;
      if (!sc) return null;
      const r = el.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, getState().camera);
      for (const intersection of raycaster.intersectObjects(getState().scene.children, true)) {
        const entityId = entityIdForObject(intersection.object, sc);
        if (entityId && sc.entities[entityId]?.token) return entityId;
      }
      return null;
    };

    const finish = () => {
      const s = rulerStore.getState();
      if (s.phase !== 'active') return;
      const finalPoints = s.cursor ? appendWaypoint(s.points, s.cursor) : s.points;
      if (finalPoints.length < 2) {
        cancel();
        return;
      }
      s.setPoints(finalPoints);
      s.finish();
      publish('finished', true);
    };

    const cancel = () => {
      const s = rulerStore.getState();
      if (s.phase === 'idle') return;
      s.clear();
      publish('cancelled', true);
    };

    const onDown = (e: PointerEvent) => {
      if (!rulerStore.getState().tool || e.target !== el) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pointerClaims.isClaimed(e.pointerId)) return;
      const source = latest.current.scene;
      const sc = source ? measurementScene(source) : null;
      const point = pointAt(e);
      if (!sc || !point) return;
      const beganMeasurement = rulerStore.getState().phase !== 'active';
      pointerClaims.claim(e.pointerId, 'ruler');
      el.setPointerCapture(e.pointerId);
      down = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        point,
        tokenId: tokenAt(e),
        beganMeasurement,
        dragging: false,
      };
      if (beganMeasurement) {
        rulerStore.getState().begin(sc.id, point);
        publish('active', true);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.pointerId) return;
      const start = down;
      down = null;
      pointerClaims.release(start.pointerId);
      if (el.hasPointerCapture(start.pointerId)) el.releasePointerCapture(start.pointerId);
      const source = latest.current.scene;
      const sc = source ? measurementScene(source) : null;
      const point = pointAt(e);
      if (!sc || !point) return;
      if (start.dragging) {
        rulerStore.getState().setCursor(point);
        if (rulerStore.getState().persistent) finish();
        else cancel();
        return;
      }
      // M1-41: a token remains a quick route back to selection, but dragging from the same press
      // still measures from the token/surface as required by MEAS-02.
      if (start.beganMeasurement && start.tokenId) {
        rulerStore.getState().setTool(false);
        return;
      }
      const s = rulerStore.getState();
      if (start.beganMeasurement) s.setPoints([point]);
      else s.setPoints(appendWaypoint(s.points, point));
      s.setCursor(point);
      publish('active', true);
    };

    const onCancelPointer = (e: PointerEvent) => {
      if (down && e.pointerId === down.pointerId) {
        const interrupted = down;
        pointerClaims.release(interrupted.pointerId);
        if (el.hasPointerCapture(interrupted.pointerId))
          el.releasePointerCapture(interrupted.pointerId);
        down = null;
        if (interrupted.beganMeasurement || interrupted.dragging) cancel();
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = rulerStore.getState();
      if (!s.tool) return;
      if (down && e.pointerId === down.pointerId) {
        if (!down.dragging && !rulerDragStarted(down, e)) return;
        if (!down.dragging) {
          down.dragging = true;
          if (!down.beganMeasurement) {
            const source = latest.current.scene;
            const sc = source ? measurementScene(source) : null;
            if (!sc) return;
            s.begin(sc.id, down.point);
          }
        }
      } else if (s.phase !== 'active') {
        return;
      }
      const point = pointAt(e);
      if (!point) return;
      rulerStore.getState().setCursor(point);
      publish('active', false);
    };

    // A ruler click must not also select or deselect whatever is under it.
    const onClick = (e: MouseEvent) => {
      if (rulerStore.getState().tool && e.target === el) e.stopPropagation();
    };
    const onDoubleClick = (e: MouseEvent) => {
      if (!rulerStore.getState().tool || e.target !== el) return;
      e.stopPropagation();
      finish();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!rulerStore.getState().tool || e.target !== el) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };

    const onKey = (e: KeyboardEvent) => {
      const s = rulerStore.getState();
      if (!s.tool || isTypingTarget(e.target)) return;
      if (e.key === 'Enter' && s.phase === 'active') {
        e.preventDefault();
        finish();
      } else if (e.key === 'Escape') {
        if (down) {
          pointerClaims.release(down.pointerId);
          if (el.hasPointerCapture(down.pointerId)) el.releasePointerCapture(down.pointerId);
          down = null;
        }
        if (s.phase === 'idle') s.setTool(false);
        else cancel();
      }
    };

    const heartbeat = setInterval(() => {
      const s = rulerStore.getState();
      if (s.phase === 'active') publish('active', true);
      else if (s.phase === 'finished') publish('finished', true);
    }, RULER_HEARTBEAT_MS);

    // Disarming the tool mid-measure must tell others to drop it.
    const unsubscribe = rulerStore.subscribe((state, previous) => {
      if (
        (previous.phase !== 'idle' && state.phase === 'idle') ||
        (previous.broadcast && !state.broadcast)
      )
        publish('cancelled', true);
    });

    // Window capture runs before the camera and token handlers, whatever their mount order.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancelPointer, true);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (down) {
        pointerClaims.release(down.pointerId);
        if (el.hasPointerCapture(down.pointerId)) el.releasePointerCapture(down.pointerId);
      }
      clearInterval(heartbeat);
      unsubscribe();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancelPointer, true);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('dblclick', onDoubleClick, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, getState]);

  const localPoints = useMemo(
    () => (phase === 'idle' ? NO_REMOTE : phase === 'active' ? withCursor(points, cursor) : points),
    [phase, points, cursor],
  );
  const remotes = Object.entries(remote).filter(([, r]) => r.sceneId === sceneId);
  if (!scene) return null;
  return (
    <group name="rulers">
      <RulerPath
        points={localPoints}
        scene={scene}
        color={RULER_LOCAL_COLOR}
        owner={null}
        mode={measurementMode}
      />
      {remotes.map(([from, r]) => (
        <RulerPath
          key={from}
          points={r.points}
          scene={scene}
          color={RULER_REMOTE_COLOR}
          owner={rulerOwnerName(seats ?? {}, from)}
          mode={mode}
        />
      ))}
    </group>
  );
}
