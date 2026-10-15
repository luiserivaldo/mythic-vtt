import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { DoubleSide, Raycaster, Vector2, type Group, type MeshBasicMaterial } from 'three';
import { useStore } from 'zustand';
import { PING_CHANNEL, PingPayload, type Scene, type Vec3 } from '@mythic/shared';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { useClientStore } from '../store/react.js';
import { EphemeralContext, isRemoteEphemeralSender } from '../ui/ephemeral-context.js';
import { pingStore } from '../tools/ping-store.js';
import {
  canPing,
  pingPayload,
  pingPoint,
  pingProgress,
  pingVisual,
  type PingMarker,
} from '../tools/ping.js';
import { intersectPlaneY } from '../tools/token-drag.js';
import { PING_FALLBACK_COLOR } from './canvas-style.js';
import { pointerClaims } from './pointer-claims.js';

/**
 * LAY-05: ephemeral ping markers. Alt+left-clicking the board (or Ping in the right-click menus) drops a short animated marker at that spot for everyone at the
 * table. Nothing here is an action: the mark is relayed as an ephemeral message, and every client
 * draws its own copy from the ground point in the payload. The host enforces the scene's `pins`
 * toggle (PERM-05) and the ephemeral rate limits; this file only decides what to offer and draw.
 */

/** Markers live 1.5 s, so a 250 ms sweep keeps stale geometry from outliving the animation. */
const PRUNE_INTERVAL_MS = 250;
/** Just above the ground plane: enough to clear the grid, invisible from the side. */
const MARKER_HEIGHT = 0.04;

/** Matches the camera tweens (`use-view-director`): a ping still reads without motion. */
function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** One marker: a dot on the exact spot and a ring expanding away from it, both fading out. */
function PingMarkerMesh({ marker, reduce }: { marker: PingMarker; reduce: boolean }) {
  const ring = useRef<Group>(null);
  const ringMaterial = useRef<MeshBasicMaterial>(null);
  const dotMaterial = useRef<MeshBasicMaterial>(null);
  const color = marker.color ?? PING_FALLBACK_COLOR;
  const { x, z } = marker.point;

  useFrame(() => {
    const progress = pingProgress(Date.now() - marker.at);
    const visual = pingVisual(progress, reduce);
    ring.current?.scale.setScalar(visual.radius);
    if (ringMaterial.current) ringMaterial.current.opacity = visual.opacity;
    // The dot marks the exact spot, so it fades a little ahead of the ring.
    if (dotMaterial.current) dotMaterial.current.opacity = Math.max(0, 1 - progress * 1.5);
  });

  return (
    <group name={`ping-${String(marker.key)}`}>
      <group ref={ring} position={[x, MARKER_HEIGHT, z]} scale={0.001}>
        {/* Not pickable: a marker must never intercept a click meant for the board or a token. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[0.72, 1, 32]} />
          <meshBasicMaterial
            ref={ringMaterial}
            color={color}
            transparent
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      </group>
      <mesh position={[x, MARKER_HEIGHT, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[0.16, 20]} />
        <meshBasicMaterial
          ref={dotMaterial}
          color={color}
          transparent
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

export function PingTool({ readOnly = false }: { readOnly?: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useViewedCampaign();
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const markers = useStore(pingStore, (s) => s.markers);
  const scene: Scene | null = campaign?.activeSceneId
    ? (campaign.scenes[campaign.activeSceneId] ?? null)
    : null;
  const sceneId = scene?.id ?? null;
  const reduce = useMemo(reducedMotion, []);
  const latest = useRef({ campaign, scene, ephemeral, isHost, seatId });
  latest.current = { campaign, scene, ephemeral, isHost, seatId };

  const visible = useMemo(
    () => markers.filter((marker) => marker.sceneId === sceneId),
    [markers, sceneId],
  );

  // r3f is in demand mode: keep requesting frames while a marker of this scene is animating.
  useFrame(() => {
    if (visible.length > 0) invalidate();
  });

  useEffect(() => {
    invalidate();
  }, [visible, invalidate]);

  // Drop finished markers; no timer runs while the board has none.
  useEffect(() => {
    if (markers.length === 0) return;
    const timer = setInterval(() => {
      pingStore.getState().prune(Date.now());
    }, PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [markers.length]);

  // Markers from other clients. The host echoes ours back, but the local marker already covers it.
  useEffect(() => {
    const off = ephemeral?.on((message) => {
      if (message.channel !== PING_CHANNEL) return;
      if (!isRemoteEphemeralSender(message.from, ephemeral.identityId)) return;
      const parsed = PingPayload.safeParse(message.data);
      if (!parsed.success) return;
      const { sceneId: pingSceneId, x, y, z, color } = parsed.data;
      pingStore.getState().add({
        from: message.from,
        sceneId: pingSceneId,
        at: Date.now(),
        point: { x, y, z },
        ...(color !== undefined ? { color } : {}),
      });
    });
    return () => {
      off?.();
    };
  }, [ephemeral]);

  useEffect(() => {
    // A spectator still draws the markers above; they just may not send one (PERM-05).
    if (readOnly) return;
    const el = gl.domElement;
    const raycaster = new Raycaster();
    let claimed: number | null = null;

    const pointAt = (ndc: Vector2): Vec3 | null => {
      const source = latest.current.scene;
      if (!source) return null;
      raycaster.setFromCamera(ndc, getState().camera);
      const { origin, direction } = raycaster.ray;
      const hit = intersectPlaneY(
        {
          origin: { x: origin.x, y: origin.y, z: origin.z },
          direction: { x: direction.x, y: direction.y, z: direction.z },
        },
        0,
      );
      // A ping always lands on the ground plane in 2D and in 3D: it marks a board spot, not a token.
      return hit ? pingPoint(hit, source) : null;
    };

    const pingAt = (ndc: Vector2, ground?: { x: number; z: number }) => {
      const {
        scene: source,
        ephemeral: eph,
        campaign: state,
        isHost: host,
        seatId: seat,
      } = latest.current;
      if (!source || !eph) return;
      if (!canPing(state, { isHost: host, seatId: seat }, source.id)) return;
      const point = ground ? pingPoint(ground, source) : pointAt(ndc);
      if (!point) return;
      const color = eph.color?.();
      pingStore.getState().add({
        from: eph.identityId,
        sceneId: source.id,
        at: Date.now(),
        point,
        ...(color !== undefined ? { color } : {}),
      });
      eph.send(PING_CHANNEL, pingPayload(source.id, point));
    };

    const ndcFor = (e: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      return new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      );
    };

    const onDown = (e: PointerEvent) => {
      // Alt+left-click on the board is the ping gesture; everything else belongs to the other tools.
      if (!e.altKey || e.target !== el || (e.pointerType === 'mouse' && e.button !== 0)) return;
      // Claim the press so the camera does not pan and a token drag does not start (M1-20), and
      // keep the gesture from also reaching the ruler, which listens on this same node.
      pointerClaims.claim(e.pointerId, 'ping');
      claimed = e.pointerId;
      e.preventDefault();
      e.stopImmediatePropagation();
      pingAt(ndcFor(e));
    };
    const onUp = (e: PointerEvent) => {
      if (claimed !== e.pointerId) return;
      pointerClaims.release(e.pointerId);
      claimed = null;
    };
    const onClick = (e: MouseEvent) => {
      // The press was ours: do not also clear the selection or open a token menu under the marker.
      if (!e.altKey || e.target !== el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // UX-40: the board and token right-click menus ask for a ping through the store, so they need
    // no access to the camera: a pointer position (ndc) or a token's ground point.
    const unsubscribe = pingStore.subscribe((state, previous) => {
      const request = state.request;
      if (state.requests === previous.requests || !request) return;
      if (request.kind === 'ndc') pingAt(new Vector2(request.x, request.y));
      else pingAt(new Vector2(0, 0), { x: request.x, z: request.z });
    });

    // Window capture, like the ruler: the press must be claimed before the camera and token tools.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('click', onClick, true);
    return () => {
      if (claimed !== null) pointerClaims.release(claimed);
      unsubscribe();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [gl, getState, readOnly]);

  if (!scene) return null;
  return (
    <group name="pings">
      {visible.map((marker) => (
        <PingMarkerMesh key={marker.key} marker={marker} reduce={reduce} />
      ))}
    </group>
  );
}
