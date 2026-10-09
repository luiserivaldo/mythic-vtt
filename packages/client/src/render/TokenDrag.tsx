import { TokenDragPreview } from '@mythic/protocol';
import { useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { Raycaster, Vector2, type Object3D } from 'three';
import { useStore } from 'zustand';
import type { Actor, Scene, Vec3 } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import {
  dragStarted,
  dragRulerPaths,
  groundPoint,
  movableToken,
  pressOnGizmoHandle,
  previewPosition,
  samePosition,
  shouldSendPreview,
  visibleGhosts,
  GHOST_TTL_MS,
} from '../tools/token-drag.js';
import { tokenDragStore } from '../tools/token-drag-store.js';
import { EphemeralContext } from '../ui/ephemeral-context.js';
import { SubmitContext } from '../ui/submit.js';
import { useViewMode } from './view-mode-store.js';
import { GHOST_COLOR } from './canvas-style.js';
import { RULER_LOCAL_COLOR, RULER_REMOTE_COLOR } from './canvas-style.js';
import { pointerClaims } from './pointer-claims.js';
import type { OrthographicCamera } from 'three';
import { RulerPath } from './RulerPath.js';
import { rulerOwnerName } from '../tools/ruler.js';

const SETTLE_TIMEOUT_MS = 2000;

interface Press {
  pointerId: number;
  entityId: string;
  sceneId: string;
  startPx: { x: number; y: number };
  grab: { x: number; z: number };
  startY: number;
  base: Vec3;
  moving: boolean;
  lastSentAt: number | null;
}

function entityIdAt(object: Object3D | null, scene: Scene): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.name && scene.entities[o.name]?.token) return o.name;
  }
  return null;
}

/**
 * TOK-02 / M1-28: press-drag any movable token without selecting it first. The press claims the
 * pointer (so the camera does not pan); the preview is render-local plus an ephemeral relay to
 * others; release sends ONE `token.move` and nothing is applied locally until the host's patch
 * lands (D34).
 */
export function TokenDrag() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const submit = useContext(SubmitContext);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const mode = useViewMode();
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
      if (m.channel !== 'token.drag-preview' || !m.from) return;
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
    const el = gl.domElement;
    let press: Press | null = null;
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

    const onDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      swallowClick = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (press || pointerClaims.isClaimed(e.pointerId)) return;
      const { campaign: c, actor: a, scene: sc, mode: m } = latest.current;
      if (!sc || tokenDragStore.getState().local) return;
      const r = ray(e);
      const hits = raycaster.intersectObjects(getState().scene.children, true);
      let hitId: string | null = null;
      for (const hit of hits) {
        const id = entityIdAt(hit.object, sc);
        if (id) {
          hitId = id;
          break;
        }
      }
      if (!hitId) return;
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
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      press = {
        pointerId: e.pointerId,
        entityId: hitId,
        sceneId: sc.id,
        startPx: { x: e.clientX, y: e.clientY },
        grab: { x: ground.x - pos.x, z: ground.z - pos.z },
        startY: pos.y,
        base: pos,
        moving: false,
        lastSentAt: null,
      };
    };

    const onMove = (e: PointerEvent) => {
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
      const ground = groundPoint(ray(e), press.startY, sc, entity);
      if (!ground) return;
      const to = previewPosition(sc, entity, ground, press.grab);
      tokenDragStore.getState().setLocal({
        sceneId: press.sceneId,
        entityId: press.entityId,
        base: press.base,
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
      if (press && e.pointerId === press.pointerId) end(false);
    };
    const onCancel = (e: PointerEvent) => {
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

    // Window capture runs before every handler on the canvas (pan, gizmo), whatever their mount order.
    window.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (press) pointerClaims.release(press.pointerId);
      window.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, invalidate, getState]);

  const ghosts = visibleGhosts(remote, scene, Date.now());
  const rulers = dragRulerPaths(local, remote, scene, Date.now());
  return (
    <group name="token-drag-previews">
      <group name="token-drag-ghosts">
        {ghosts.map((g) => (
          <mesh
            key={g.key}
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
