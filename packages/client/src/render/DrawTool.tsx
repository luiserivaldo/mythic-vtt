import {
  appendDrawPoint,
  DRAW_ERASE_CHANNEL,
  DRAW_STROKE_CHANNEL,
  DrawClearData,
  DrawEraseData,
  DrawStrokeData,
  drawChannelOf,
  type Scene,
  type Vec3,
} from '@mythic/shared';
import { useThree } from '@react-three/fiber';
import { useContext, useEffect, useRef } from 'react';
import { Raycaster, Vector2 } from 'three';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { activeToolStore } from '../tools/active-tool-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { drawingStore } from '../tools/drawing-store.js';
import {
  drawPoint3d,
  drawPointOnBoard,
  erasableStrokes,
  shouldSendStroke,
  type DrawStroke,
} from '../tools/drawing.js';
import { rulerStore } from '../tools/ruler-store.js';
import { tokenDragStore } from '../tools/token-drag-store.js';
import { intersectPlaneY } from '../tools/token-drag.js';
import { isRemoteEphemeralSender, EphemeralContext } from '../ui/ephemeral-context.js';
import { newId } from '../ui/ids.js';
import { isAdminRole, viewerRole } from '../ui/viewer.js';
import { DrawingLayer } from './DrawingLayer.js';
import { entityIdForObject } from './pick-entity.js';
import { pointerClaims } from './pointer-claims.js';
import { isTypingTarget } from './typing-target.js';
import type { ViewMode } from './view-mode-store.js';

/**
 * UX-21: a token drag owns the right press while it lasts; the settling drag that follows a drop has
 * already given the pointer back, so it must not block a drawing either.
 */
function tokenDragInProgress(): boolean {
  const drag = tokenDragStore.getState().local;
  return drag !== null && !drag.settling;
}

/**
 * LAY-05: freehand drawing on the effects layer. While the Draw tool is armed a press claims its
 * pointer (pointer-claims), so the camera does not pan and TokenDrag does not start, and samples
 * follow the pointer until release. A stroke is sent live on `draw.stroke` and kept as one
 * `finished` message; other clients' strokes and erases arrive on the same channels. Erasing takes
 * the author of a drawing and the DM anything; clearing the scene is the DM's. All of it is
 * ephemeral: nothing here is an action, and the host re-checks every message.
 */
export function DrawTool({
  mode = '2d',
  readOnly = false,
}: {
  mode?: ViewMode;
  readOnly?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const scene: Scene | null = campaign?.activeSceneId
    ? (campaign.scenes[campaign.activeSceneId] ?? null)
    : null;
  const sceneId = scene?.id ?? null;
  const isDm = isAdminRole(viewerRole({ isHost, seatId, campaign }));
  const latest = useRef({ scene, ephemeral, mode, isDm });
  latest.current = { scene, ephemeral, mode, isDm };

  const strokes = useStore(drawingStore, (s) => s.strokes);
  const erase = useStore(drawingStore, (s) => s.erase);

  // Drawings are render-local: a new sample, an erase or a cleared scene needs a frame.
  useEffect(() => {
    invalidate();
  }, [strokes, erase, invalidate]);

  useEffect(() => {
    const off = ephemeral?.on((message) => {
      const kind = drawChannelOf(message.channel);
      // The host echoes ephemerals back to their sender; the local drawing already represents it.
      if (kind === null || !isRemoteEphemeralSender(message.from, ephemeral.identityId)) return;
      switch (kind) {
        case 'stroke': {
          const parsed = DrawStrokeData.safeParse(message.data);
          if (!parsed.success) return;
          drawingStore.getState().upsert({ ...parsed.data, from: message.from, at: Date.now() });
          return;
        }
        case 'erase': {
          const parsed = DrawEraseData.safeParse(message.data);
          if (!parsed.success) return;
          drawingStore.getState().remove(parsed.data.strokeId);
          return;
        }
        case 'clear': {
          const parsed = DrawClearData.safeParse(message.data);
          if (!parsed.success) return;
          drawingStore.getState().clearScene(parsed.data.sceneId);
          return;
        }
      }
    });
    return () => {
      off?.();
    };
  }, [ephemeral]);

  useEffect(() => {
    // Read-only viewers still receive drawings; only pointer and publishing handlers are off.
    if (readOnly) return;
    const el = gl.domElement;
    const raycaster = new Raycaster();
    let active: { pointerId: number; strokeId: string; lastSentAt: number | null } | null = null;
    let eraserPointer: number | null = null;

    const armed = () => activeToolStore.getState().tool === 'draw';
    const measuring = () => rulerStore.getState().tool || aoeToolStore.getState().active;
    const blockCurrent = () => !armed() || measuring() || tokenDragInProgress();

    const ndcFor = (e: { clientX: number; clientY: number }): Vector2 => {
      const rect = el.getBoundingClientRect();
      return new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      );
    };

    /** The drawing sample under the pointer: a surface hit in 3D, the ground plane in 2D. */
    const pointAt = (e: { clientX: number; clientY: number }): Vec3 | null => {
      const source = latest.current.scene;
      if (!source) return null;
      raycaster.setFromCamera(ndcFor(e), getState().camera);
      if (latest.current.mode === '3d') {
        for (const hit of raycaster.intersectObjects(getState().scene.children, true)) {
          const entityId = entityIdForObject(hit.object, source);
          if (!entityId) continue;
          return drawPoint3d({ x: hit.point.x, y: hit.point.y, z: hit.point.z }, source, entityId);
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
      if (!hit) return null;
      return latest.current.mode === '3d'
        ? drawPoint3d(hit, source)
        : drawPointOnBoard(hit, source);
    };

    /** The drawing under the pointer, for the eraser. Strips carry their stroke id in userData. */
    const strokeAt = (e: { clientX: number; clientY: number }): string | null => {
      raycaster.setFromCamera(ndcFor(e), getState().camera);
      for (const hit of raycaster.intersectObjects(getState().scene.children, true)) {
        const strokeId = (hit.object.userData as { strokeId?: unknown }).strokeId;
        if (typeof strokeId === 'string') return strokeId;
      }
      return null;
    };

    const dropOwnStroke = (strokeId: string, tellOthers: boolean) => {
      const { scene: sc, ephemeral: eph } = latest.current;
      drawingStore.getState().remove(strokeId);
      if (tellOthers && sc && eph) eph.send(DRAW_ERASE_CHANNEL, { sceneId: sc.id, strokeId });
    };

    /** Publishes the stroke as it stands: a whole one on release, its live samples while drawing. */
    const publish = (phase: 'active' | 'finished', force: boolean) => {
      const current = active;
      const { scene: sc, ephemeral: eph } = latest.current;
      if (!current || !eph || !sc) return;
      const strokes = drawingStore.getState();
      const stroke = strokes.strokes.find((candidate) => candidate.strokeId === current.strokeId);
      if (!stroke || stroke.points.length === 0) return;
      const now = Date.now();
      if (!shouldSendStroke(current.lastSentAt, now, force)) return;
      current.lastSentAt = now;
      eph.send(DRAW_STROKE_CHANNEL, {
        sceneId: sc.id,
        strokeId: current.strokeId,
        color: strokes.color,
        width: strokes.width,
        phase,
        points: [...stroke.points],
      });
    };

    const write = (points: readonly Vec3[], phase: 'active' | 'finished') => {
      const current = active;
      const { scene: sc, ephemeral: eph } = latest.current;
      if (!current || !sc) return;
      const strokes = drawingStore.getState();
      const stroke: DrawStroke = {
        sceneId: sc.id,
        strokeId: current.strokeId,
        from: eph?.identityId ?? '',
        color: strokes.color,
        width: strokes.width,
        points,
        phase,
        at: Date.now(),
      };
      strokes.upsert(stroke);
    };

    const releasePointer = (pointerId: number) => {
      pointerClaims.release(pointerId);
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    };

    const finish = () => {
      const current = active;
      if (!current) return;
      const stroke = drawingStore
        .getState()
        .strokes.find((candidate) => candidate.strokeId === current.strokeId);
      const points = stroke?.points ?? [];
      // A tap, or a stroke abandoned before it became a line, is not a drawing.
      if (points.length < 2) dropOwnStroke(current.strokeId, current.lastSentAt !== null);
      else {
        write(points, 'finished');
        publish('finished', true);
      }
      active = null;
    };

    const cancel = () => {
      const current = active;
      if (!current) return;
      // A live stroke is already on other screens; erasing it is the author's own right.
      dropOwnStroke(current.strokeId, current.lastSentAt !== null);
      releasePointer(current.pointerId);
      active = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pointerClaims.isClaimed(e.pointerId)) return;
      if (blockCurrent()) return;
      const strokes = drawingStore.getState();
      if (strokes.erase) {
        const strokeId = strokeAt(e);
        const { scene: sc, ephemeral: eph, isDm: dm } = latest.current;
        if (strokeId === null || !sc || !eph) return;
        const target = strokes.strokes.find((candidate) => candidate.strokeId === strokeId);
        // A drawing that is not the viewer's own is not theirs to erase, the DM's aside.
        if (!target || erasableStrokes([target], sc.id, eph.identityId, dm).length === 0) return;
        e.stopPropagation();
        pointerClaims.claim(e.pointerId, 'draw');
        eraserPointer = e.pointerId;
        dropOwnStroke(strokeId, true);
        return;
      }
      const point = pointAt(e);
      if (!point) return;
      e.stopPropagation();
      pointerClaims.claim(e.pointerId, 'draw');
      el.setPointerCapture(e.pointerId);
      active = { pointerId: e.pointerId, strokeId: newId(), lastSentAt: null };
      write([point], 'active');
      publish('active', true);
    };

    const onMove = (e: PointerEvent) => {
      const current = active;
      if (!current || e.pointerId !== current.pointerId) return;
      const point = pointAt(e);
      if (!point) return;
      const stroke = drawingStore
        .getState()
        .strokes.find((candidate) => candidate.strokeId === current.strokeId);
      const points = appendDrawPoint(stroke?.points ?? [], point);
      // A repeated sample (a still pointer) changes nothing: no frame, no message.
      if (stroke !== undefined && points === stroke.points) return;
      write(points, 'active');
      publish('active', false);
    };

    const onUp = (e: PointerEvent) => {
      if (eraserPointer !== null && e.pointerId === eraserPointer) {
        releasePointer(e.pointerId);
        eraserPointer = null;
        return;
      }
      const current = active;
      if (!current || e.pointerId !== current.pointerId) return;
      const point = pointAt(e);
      if (point) {
        const stroke = drawingStore
          .getState()
          .strokes.find((candidate) => candidate.strokeId === current.strokeId);
        write(appendDrawPoint(stroke?.points ?? [], point), 'active');
      }
      releasePointer(current.pointerId);
      finish();
    };

    const onCancelPointer = (e: PointerEvent) => {
      if (eraserPointer === e.pointerId) {
        releasePointer(e.pointerId);
        eraserPointer = null;
      }
      if (active && e.pointerId === active.pointerId) cancel();
    };

    const onContextMenu = (e: MouseEvent) => {
      // A right click abandons the stroke in progress; otherwise the board's menu is untouched.
      if (!active || e.target !== el || !armed()) return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!armed() || isTypingTarget(e.target) || e.key !== 'Escape') return;
      if (active) {
        cancel();
        return;
      }
      // Escape puts the eraser away first, then leaves the tool: the rail shows the same tool.
      if (drawingStore.getState().erase) drawingStore.getState().setErase(false);
      else activeToolStore.getState().setTool('select');
    };

    const unsubscribe = drawingStore.subscribe((state, previous) => {
      // Arming the eraser, or leaving the tool, must not leave a half-drawn stroke behind.
      if (state.erase !== previous.erase && state.erase) cancel();
    });
    const unsubscribeTool = activeToolStore.subscribe((state, previous) => {
      if (previous.tool === 'draw' && state.tool !== 'draw') cancel();
    });

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancelPointer, true);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (active) releasePointer(active.pointerId);
      if (eraserPointer !== null) releasePointer(eraserPointer);
      unsubscribe();
      unsubscribeTool();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancelPointer, true);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, getState, readOnly]);

  if (!scene) return null;
  return <DrawingLayer strokes={strokes} sceneId={sceneId} />;
}
