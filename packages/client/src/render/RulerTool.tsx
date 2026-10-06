import { RulerPreview } from '@mythic/protocol';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { Raycaster, Vector2 } from 'three';
import { useStore } from 'zustand';
import type { Scene, Vec3 } from '@mythic/shared';
import { useClientStore } from '../store/react.js';
import { rulerStore } from '../tools/ruler-store.js';
import { intersectPlaneY } from '../tools/token-drag.js';
import {
  appendWaypoint,
  measureRuler,
  prepareRulerPoint,
  RULER_HEARTBEAT_MS,
  rulerExpired,
  rulerOwnerName,
  shouldSendRuler,
  withCursor,
  type RulerPhase,
} from '../tools/ruler.js';
import { EphemeralContext } from '../ui/ephemeral-context.js';
import { DRAG_THRESHOLD_PX } from './camera-2d.js';
import { pointerClaims } from './pointer-claims.js';

const LOCAL_COLOR = '#38bdf8';
const REMOTE_COLOR = '#f59e0b';
const LIFT = 0.05;
const NO_REMOTE: readonly never[] = [];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * MEAS-01: the multi-waypoint ruler on the ground plane (2D, and 3D via the same plane pick).
 * While the tool is armed a press claims its pointer (pointer-claims) so the camera does not
 * pan and TokenDrag does not start; a click adds a waypoint, double-click or Enter finishes,
 * Esc cancels. The path is render-local plus an ephemeral relay; nothing is an action.
 */
export function RulerTool() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useClientStore((s) => s.campaign);
  const scene: Scene | null = campaign?.activeSceneId
    ? (campaign.scenes[campaign.activeSceneId] ?? null)
    : null;
  const latest = useRef({ scene, ephemeral });
  latest.current = { scene, ephemeral };
  const sceneId = scene?.id ?? null;

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
    let down: { pointerId: number; x: number; y: number } | null = null;
    let lastSentAt: number | null = null;

    const publish = (kind: RulerPhase, force: boolean) => {
      const { scene: sc, ephemeral: eph } = latest.current;
      if (!eph || !sc) return;
      const s = rulerStore.getState();
      const path =
        kind === 'cancelled' ? [] : kind === 'active' ? withCursor(s.points, s.cursor) : s.points;
      if (kind !== 'cancelled' && path.length === 0) return;
      const now = Date.now();
      if (!shouldSendRuler(lastSentAt, now, force)) return;
      lastSentAt = now;
      eph.send('ruler.preview', { sceneId: sc.id, points: path, phase: kind });
    };

    const groundAt = (e: { clientX: number; clientY: number }): Vec3 | null => {
      const sc = latest.current.scene;
      if (!sc) return null;
      const r = el.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -(((e.clientY - r.top) / r.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, getState().camera);
      const { origin, direction } = raycaster.ray;
      const hit = intersectPlaneY(
        {
          origin: { x: origin.x, y: origin.y, z: origin.z },
          direction: { x: direction.x, y: direction.y, z: direction.z },
        },
        0,
      );
      return hit ? prepareRulerPoint(hit, sc) : null;
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
      pointerClaims.claim(e.pointerId);
      down = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    };

    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.pointerId) return;
      const start = down;
      down = null;
      pointerClaims.release(start.pointerId);
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD_PX) return;
      const sc = latest.current.scene;
      const point = groundAt(e);
      if (!sc || !point) return;
      const s = rulerStore.getState();
      if (s.phase === 'active') s.setPoints(appendWaypoint(s.points, point));
      else s.begin(sc.id, point);
      publish('active', true);
    };

    const onCancelPointer = (e: PointerEvent) => {
      if (down && e.pointerId === down.pointerId) {
        pointerClaims.release(down.pointerId);
        down = null;
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = rulerStore.getState();
      if (!s.tool || s.phase !== 'active') return;
      const point = groundAt(e);
      if (!point) return;
      s.setCursor(point);
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

    const onKey = (e: KeyboardEvent) => {
      const s = rulerStore.getState();
      if (!s.tool || isTypingTarget(e.target)) return;
      if (e.key === 'Enter' && s.phase === 'active') {
        e.preventDefault();
        finish();
      } else if (e.key === 'Escape') {
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
      if (previous.phase !== 'idle' && state.phase === 'idle') publish('cancelled', true);
    });

    // Window capture runs before the camera and token handlers, whatever their mount order.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancelPointer, true);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDoubleClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      if (down) pointerClaims.release(down.pointerId);
      clearInterval(heartbeat);
      unsubscribe();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancelPointer, true);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('dblclick', onDoubleClick, true);
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
      <RulerPath points={localPoints} scene={scene} color={LOCAL_COLOR} owner={null} />
      {remotes.map(([from, r]) => (
        <RulerPath
          key={from}
          points={r.points}
          scene={scene}
          color={REMOTE_COLOR}
          owner={rulerOwnerName(seats ?? {}, from)}
        />
      ))}
    </group>
  );
}

const pillStyle = {
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(16,25,35,0.85)',
  color: '#fff',
  whiteSpace: 'nowrap',
  userSelect: 'none',
} as const;

/** The line, waypoint dots and camera-facing HTML readouts (never world-space text). */
function RulerPath({
  points,
  scene,
  color,
  owner,
}: {
  points: readonly Vec3[];
  scene: Scene;
  color: string;
  owner: string | null;
}) {
  const measured = useMemo(() => measureRuler(points, scene.grid), [points, scene.grid]);
  const last = points[points.length - 1];
  if (!last || points.length === 0) return null;
  const testId = owner === null ? 'ruler' : 'remote-ruler';
  return (
    <group>
      {points.length > 1 && (
        <Line
          points={points.map((p) => [p.x, LIFT, p.z] as [number, number, number])}
          color={color}
          lineWidth={3}
          depthTest={false}
          renderOrder={950}
          raycast={() => null}
        />
      )}
      {points.map((p, i) => (
        <mesh
          key={`${String(i)}:${String(p.x)}:${String(p.z)}`}
          position={[p.x, LIFT, p.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={951}
          raycast={() => null}
        >
          <circleGeometry args={[0.09, 16]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
      {measured.segments.length > 1 &&
        measured.segments.map((segment, i) => (
          <Html
            key={`${String(i)}:${segment.label}`}
            center
            position={[segment.midpoint.x, LIFT, segment.midpoint.z]}
            zIndexRange={[5, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              data-testid={`${testId}-segment`}
              style={{ ...pillStyle, fontSize: 11, opacity: 0.85 }}
            >
              {segment.label}
            </div>
          </Html>
        ))}
      {measured.segments.length > 0 && (
        <Html
          center
          position={[last.x, LIFT, last.z]}
          zIndexRange={[6, 0]}
          style={{ pointerEvents: 'none', transform: 'translateY(-18px)' }}
        >
          <div
            data-testid={`${testId}-total`}
            style={{ ...pillStyle, fontSize: 13, border: `1px solid ${color}` }}
          >
            {owner === null ? measured.totalLabel : `${owner}: ${measured.totalLabel}`}
          </div>
        </Html>
      )}
    </group>
  );
}
