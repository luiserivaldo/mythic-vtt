import { useViewedCampaign } from '../store/viewed-campaign.js';
import { TokenDragPreview } from '@mythic/protocol';
import { useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { Matrix3, Raycaster, Vector2, type Object3D } from 'three';
import { useStore } from 'zustand';
import type { Actor, Entity, Scene, Vec3 } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import {
  cursorSurface,
  dragStarted,
  dragRulerPaths,
  appendCheckpoint,
  groundPoint,
  movableToken,
  pressOnGizmoHandle,
  previewPosition,
  samePosition,
  shouldSendPreview,
  visibleGhosts,
  GHOST_TTL_MS,
  type Ray,
  type SurfaceHit,
} from '../tools/token-drag.js';
import { selectionStore } from '../tools/selection-store.js';
import { tokenDragStore } from '../tools/token-drag-store.js';
import { EphemeralContext, isRemoteEphemeralSender } from '../ui/ephemeral-context.js';
import { SubmitContext } from '../ui/submit.js';
import { useViewMode } from './view-mode-store.js';
import { GHOST_COLOR } from './canvas-style.js';
import { RULER_LOCAL_COLOR, RULER_REMOTE_COLOR } from './canvas-style.js';
import { pointerClaims } from './pointer-claims.js';
import type { OrthographicCamera } from 'three';
import { RulerPath } from './RulerPath.js';
import { rulerOwnerName } from '../tools/ruler.js';
import { rulerStore } from '../tools/ruler-store.js';

const SETTLE_TIMEOUT_MS = 2000;

type Px = { x: number; y: number };

interface Press {
  pointerId: number;
  entityId: string;
  sceneId: string;
  startPx: Px;
  grab: { x: number; z: number };
  startY: number;
  base: Vec3;
  /** UX-21/UI-TOKEN-06: checkpoints dropped with a right click while this press drags. */
  checkpoints: readonly Vec3[];
  moving: boolean;
  lastSentAt: number | null;
}

function entityIdAt(object: Object3D | null, scene: Scene): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.name && scene.entities[o.name]?.token) return o.name;
  }
  return null;
}

/** Like `entityIdAt`, but for any scene entity (a platform is not a token). */
function sceneEntityIdAt(object: Object3D | null, scene: Scene): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.name && scene.entities[o.name]) return o.name;
  }
  return null;
}

/**
 * TOK-02 / M1-28: press-drag any movable token without selecting it first. The press claims the
 * pointer (so the camera does not pan); the preview is render-local plus an ephemeral relay to
 * others; release sends ONE `token.move` and nothing is applied locally until the host's patch
 * lands (D34).
 */
export function TokenDrag({ readOnly = false }: { readOnly?: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const submit = useContext(SubmitContext);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const mode = useViewMode();
  const measureMovement = useStore(rulerStore, (s) => s.measureMovement);
  const local = useStore(tokenDragStore, (s) => s.local);
  const remote = useStore(tokenDragStore, (s) => s.remote);

  const actor = useMemo<Actor | null>(
    () => (isHost ? { kind: 'host' } : seatId !== null ? { kind: 'seat', seatId } : null),
    [isHost, seatId],
  );
  const scene = campaign?.activeSceneId ? (campaign.scenes[campaign.activeSceneId] ?? null) : null;
  const latest = useRef({ campaign, actor, scene, submit, ephemeral, mode });
  latest.current = { campaign, actor, scene, submit, ephemeral, mode };

  // Incoming previews from other clients; expire them (the wire has no "drag ended" message).
  useEffect(() => {
    const store = tokenDragStore.getState();
    const off = ephemeral?.on((m) => {
      if (
        m.channel !== 'token.drag-preview' ||
        !isRemoteEphemeralSender(m.from, ephemeral.identityId)
      ) {
        return;
      }
      const parsed = TokenDragPreview.shape.data.safeParse(m.data);
      if (!parsed.success) return;
      store.setRemote(m.from, { ...parsed.data, at: Date.now() });
      invalidate();
    });
    const timer = setInterval(() => {
      const had = Object.keys(tokenDragStore.getState().remote).length > 0;
      tokenDragStore.getState().pruneRemote(Date.now(), GHOST_TTL_MS);
      if (had) invalidate();
    }, 500);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, [ephemeral, invalidate]);

  useEffect(() => {
    invalidate();
  }, [remote, local, invalidate]);

  // Settling: hand the token back to stored state once the host's patch lands, or on timeout.
  const settling = local?.settling === true;
  const storedPosition = local && scene?.entities[local.entityId]?.transform.position;
  useEffect(() => {
    if (!settling) return;
    const l = tokenDragStore.getState().local;
    if (l && storedPosition && !samePosition(storedPosition, l.base)) {
      tokenDragStore.getState().setLocal(null);
      return;
    }
    const timer = setTimeout(() => {
      tokenDragStore.getState().setLocal(null);
    }, SETTLE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [settling, storedPosition]);

  useEffect(() => {
    // Keep remote drag previews visible to spectators without enabling local movement.
    if (readOnly) return;
    const el = gl.domElement;
    let press: Press | null = null;
    let middle: { pointerId: number; entityId: string; startPx: Px; moved: boolean } | null = null;
    let swallowClick = false;
    const raycaster = new Raycaster();

    const ray = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
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

    /**
     * TOK-03 / Q26: the walkable surface under the cursor, which a dropped token lands on. A flying
     * token ignores surfaces, so it skips the raycast. Must follow `ray(e)`, which aims `raycaster`.
     */
    const surfaceUnderPointer = (r: Ray, sc: Scene, dragged: Entity): number | undefined => {
      if (dragged.token?.flying) return undefined;
      const hits: SurfaceHit[] = [];
      if (latest.current.mode === '3d') {
        for (const hit of raycaster.intersectObjects(getState().scene.children, true)) {
          const entityId = sceneEntityIdAt(hit.object, sc);
          if (!entityId || entityId === dragged.id) continue;
          const normalY = hit.face
            ? hit.face.normal
                .clone()
                .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
                .normalize().y
            : 1;
          hits.push({ entityId, y: hit.point.y, normalY });
        }
      }
      return cursorSurface(sc, latest.current.mode, r, hits);
    };

    const end = (cancel: boolean) => {
      if (!press) return;
      const done = press;
      press = null;
      pointerClaims.release(done.pointerId);
      if (el.hasPointerCapture(done.pointerId)) el.releasePointerCapture(done.pointerId);
      const drag = tokenDragStore.getState().local;
      const { submit: send, scene: sc, ephemeral: eph } = latest.current;
      if (cancel || !done.moving || !drag || !send || !sc) {
        tokenDragStore.getState().setLocal(null);
        invalidate();
        return;
      }
      if (samePosition(drag.to, done.base)) {
        tokenDragStore.getState().setLocal(null);
        invalidate();
        return;
      }
      eph?.send('token.drag-preview', {
        sceneId: done.sceneId,
        entityId: done.entityId,
        to: drag.to,
      });
      tokenDragStore.getState().setLocal({ ...drag, settling: true });
      void send(
        'token.move',
        { sceneId: done.sceneId, entityId: done.entityId, to: drag.to },
        done.sceneId,
      )
        .then((result) => {
          if (!result.ok) {
            // D34: server order wins; the token snaps back to what the host holds.
            tokenDragStore.getState().setLocal(null);
          }
        })
        .catch(() => {
          tokenDragStore.getState().setLocal(null);
        })
        .finally(() => {
          invalidate();
        });
    };

    /** The topmost token under the pointer; aims `raycaster` as a side effect. */
    const tokenUnder = (e: PointerEvent, sc: Scene): { id: string; ray: Ray } | null => {
      const r = ray(e);
      for (const hit of raycaster.intersectObjects(getState().scene.children, true)) {
        const id = entityIdAt(hit.object, sc);
        if (id) return { id, ray: r };
      }
      return null;
    };

    /**
     * TOK-03 / Q26 (pending playtest): a middle CLICK on an already-selected token toggles its
     * flying lock. It claims nothing, so a held or dragged middle press still pans; the drag
     * threshold decides which it was.
     */
    const onMiddleDown = (e: PointerEvent) => {
      const { campaign: c, actor: a, scene: sc } = latest.current;
      if (!sc || press || middle) return;
      const hit = tokenUnder(e, sc);
      if (!hit || !selectionStore.getState().ids.includes(hit.id)) return;
      if (!movableToken(c, a, sc, hit.id)) return;
      middle = {
        pointerId: e.pointerId,
        entityId: hit.id,
        startPx: { x: e.clientX, y: e.clientY },
        moved: false,
      };
    };

    const toggleFlying = (entityId: string) => {
      const { scene: sc, submit: send } = latest.current;
      const token = sc?.entities[entityId]?.token;
      if (!sc || !token || !send) return;
      void send(
        'token.setFlying',
        { sceneId: sc.id, entityId, flying: token.flying !== true },
        sc.id,
      ).finally(() => {
        invalidate();
      });
    };

    /**
     * UX-21/UI-TOKEN-06: a right click while a token is being dragged commits the live position as
     * a checkpoint and the drag keeps measuring from it (total in scene units, diagonal rule). The
     * drag owns the pointer, so the press is swallowed rather than handed to the camera (right-drag
     * orbits in 3D), to a ruler action or to the context menu. A left press never checkpoints.
     */
    const addCheckpoint = () => {
      const drag = tokenDragStore.getState().local;
      if (!press || !drag || drag.settling || !rulerStore.getState().measureMovement) return;
      const checkpoints = appendCheckpoint(drag.base, press.checkpoints, drag.to);
      if (checkpoints === press.checkpoints) return;
      press.checkpoints = checkpoints;
      tokenDragStore.getState().setLocal({ ...drag, checkpoints });
      invalidate();
    };

    /**
     * UX-21/UI-TOKEN-06: the right button pressed during a drag. The pointer is already active, so
     * the browser fires no second `pointerdown`; the press arrives as the compat `mousedown`, and
     * swallowing it keeps the camera, the ruler and the context menu out of the gesture.
     */
    const onMouseDown = (e: MouseEvent) => {
      if (!press || e.target !== el || e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      addCheckpoint();
    };

    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      // The drag owns the pointer: nothing may start from it until the left button is released.
      // A second button press never reaches us here (the pointer is already active, so the browser
      // fires no further pointerdown); the right one is handled by onMouseDown.
      if (press) return;
      if (e.pointerType === 'mouse' && e.button === 1) {
        onMiddleDown(e);
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      swallowClick = false;
      if (pointerClaims.isClaimed(e.pointerId)) return;
      const { campaign: c, actor: a, scene: sc, mode: m } = latest.current;
      if (!sc || tokenDragStore.getState().local) return;
      const under = tokenUnder(e, sc);
      if (!under) return;
      const hitId = under.id;
      const r = under.ray;
      const entity = movableToken(c, a, sc, hitId);
      if (!entity) return;
      const pos = entity.transform.position;
      const ground = groundPoint(r, pos.y, sc, entity);
      if (!ground) return;
      if (m === '2d') {
        const cam = getState().camera as OrthographicCamera;
        if (pressOnGizmoHandle(entity, ground, cam.zoom)) return;
      }
      pointerClaims.claim(e.pointerId, 'token drag');
      // M1-28 moves any movable token without selecting it first, but a plain click must still
      // select. The claim already keeps the camera from panning, so only swallow the press when
      // the token is selected; an unselected token's press reaches picking and a click selects it.
      if (selectionStore.getState().ids.includes(hitId)) e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      press = {
        pointerId: e.pointerId,
        entityId: hitId,
        sceneId: sc.id,
        startPx: { x: e.clientX, y: e.clientY },
        grab: { x: ground.x - pos.x, z: ground.z - pos.z },
        startY: pos.y,
        base: pos,
        checkpoints: [],
        moving: false,
        lastSentAt: null,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (
        middle &&
        e.pointerId === middle.pointerId &&
        dragStarted(middle.startPx, { x: e.clientX, y: e.clientY })
      ) {
        middle.moved = true;
      }
      if (!press || e.pointerId !== press.pointerId) return;
      const { scene: sc, ephemeral: eph } = latest.current;
      const entity = sc?.entities[press.entityId];
      if (!sc || !entity) {
        end(true);
        return;
      }
      if (!press.moving) {
        if (!dragStarted(press.startPx, { x: e.clientX, y: e.clientY })) return;
        press.moving = true;
        swallowClick = true;
      }
      const r = ray(e);
      const surface = surfaceUnderPointer(r, sc, entity);
      const ground = groundPoint(r, press.startY, sc, entity, surface);
      if (!ground) return;
      const to = previewPosition(sc, entity, ground, press.grab, surface);
      tokenDragStore.getState().setLocal({
        sceneId: press.sceneId,
        entityId: press.entityId,
        base: press.base,
        checkpoints: press.checkpoints,
        to,
        settling: false,
      });
      const now = Date.now();
      if (shouldSendPreview(press.lastSentAt, now, false)) {
        press.lastSentAt = now;
        eph?.send('token.drag-preview', { sceneId: press.sceneId, entityId: press.entityId, to });
      }
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      if (middle && e.pointerId === middle.pointerId) {
        const done = middle;
        middle = null;
        if (!done.moved) toggleFlying(done.entityId);
      }
      // UX-21: a mouse `pointerup` fires only once every button is up, so the right release during
      // a drag never reaches here; the left release still ends the move as usual, now wherever the
      // pointer happens to be (M3-11).
      if (press && e.pointerId === press.pointerId) end(false);
    };
    const onCancel = (e: PointerEvent) => {
      if (middle && e.pointerId === middle.pointerId) middle = null;
      if (press && e.pointerId === press.pointerId) end(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press) end(true);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (swallowClick) {
        e.stopPropagation();
        swallowClick = false;
      }
    };
    // UX-21: while the drag lasts the right button is the checkpoint gesture, so the context menu
    // (and the ruler's right-click waypoint) must not open on top of the drag.
    const onContextMenu = (e: MouseEvent) => {
      if (!press) return;
      e.preventDefault();
      e.stopPropagation();
    };

    // Window capture runs before every handler on the canvas (pan, gizmo), whatever their mount order.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    el.addEventListener('pointermove', onMove);
    // M3-11: the release is heard on the window, not on the canvas. A 3D ruler readout is an HTML
    // pill, so it is a DOM node outside the canvas subtree: a release over it reaches no canvas
    // listener and would strand the drag. Capture, like the ruler tool, so nothing can eat it.
    window.addEventListener('pointerup', onUp, true);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (press) pointerClaims.release(press.pointerId);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, invalidate, getState, readOnly]);

  const ghosts = visibleGhosts(remote, scene, Date.now());
  const rulers = dragRulerPaths(local, remote, scene, Date.now());
  return (
    <group name="token-drag-previews">
      <group name="token-drag-ghosts">
        {ghosts.map((g) => (
          <mesh
            key={g.key}
            name="token-drag-ghost"
            position={[g.to.x, g.to.y + 0.03, g.to.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={900}
            raycast={() => null}
          >
            <planeGeometry args={[g.sizeCells, g.sizeCells]} />
            <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.6} depthTest={false} />
          </mesh>
        ))}
      </group>
      {scene &&
        measureMovement &&
        rulers.map((ruler) => (
          <RulerPath
            key={ruler.key}
            points={ruler.points}
            scene={scene}
            color={ruler.from === null ? RULER_LOCAL_COLOR : RULER_REMOTE_COLOR}
            owner={ruler.from === null ? null : rulerOwnerName(campaign?.seats ?? {}, ruler.from)}
            mode={mode}
            testId={ruler.from === null ? 'drag-ruler' : 'remote-drag-ruler'}
          />
        ))}
    </group>
  );
}
