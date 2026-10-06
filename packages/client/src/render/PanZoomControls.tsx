import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { OrthographicCamera } from 'three';
import {
  applyWheel,
  classifyWheel,
  DRAG_THRESHOLD_PX,
  panByPixels,
  pinchUpdate,
  clampViewToBounds,
  clampZoom,
  frameBounds,
  type CanvasSize,
  type Point,
  type View2D,
} from './camera-2d.js';
import { pointerClaims } from './pointer-claims.js';

/**
 * Mouse, trackpad and touch pan/zoom for the 2D orthographic camera (CAM-01).
 * Renders nothing; it only drives the default camera and invalidates the
 * on-demand frame loop. Maths lives in camera-2d.ts.
 */
export function PanZoomControls({ bounds, frameKey }: { bounds: CanvasSize; frameKey: string }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const getState = useThree((s) => s.get);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // Kept in a ref so the long-lived listeners below always clamp to the current canvas.
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const framed = useRef<{ camera: unknown; key: string } | null>(null);

  // D37: frame the whole canvas when the scene (or its size) changes and once the
  // orthographic camera has replaced R3F's default camera.
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    if (!cam.isOrthographicCamera || size.width <= 0 || size.height <= 0) return;
    if (framed.current?.camera === cam && framed.current.key === frameKey) return;
    framed.current = { camera: cam, key: frameKey };
    const v = frameBounds({ width: size.width, height: size.height }, boundsRef.current);
    cam.position.x = v.centerX;
    cam.position.z = v.centerZ;
    cam.zoom = v.zoom;
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, frameKey, invalidate]);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, Point>();
    let dragging = false;
    let pressStart: Point | null = null;
    let swallowClick = false;

    const getCamera = () => getState().camera as OrthographicCamera;
    const rect = () => el.getBoundingClientRect();
    const viewport = () => ({ width: rect().width, height: rect().height });
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = rect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const read = (): View2D => {
      const c = getCamera();
      return { centerX: c.position.x, centerZ: c.position.z, zoom: c.zoom };
    };
    const write = (raw: View2D) => {
      const v = clampViewToBounds(raw, boundsRef.current);
      const c = getCamera();
      c.position.x = v.centerX;
      c.position.z = v.centerZ;
      c.zoom = clampZoom(v.zoom);
      c.updateProjectionMatrix();
      invalidate();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const gesture = classifyWheel(e);
      write(applyWheel(read(), viewport(), local(e), gesture));
    };

    const onPointerDown = (e: PointerEvent) => {
      // Left, middle or touch/pen contact pans. Right button is left for context menus.
      if (e.pointerType === 'mouse' && e.button === 2) return;
      // M1-20: a press that started on a gizmo handle belongs to the gizmo, not the camera.
      if (pointerClaims.isClaimed(e.pointerId)) return;
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        pressStart = local(e);
        dragging = e.pointerType === 'mouse' && e.button === 1;
      } else {
        dragging = true;
      }
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = local(e);
      if (pointers.size >= 2) {
        const others = [...pointers.entries()];
        const before = others.map(([, p]) => p);
        const after = others.map(([id, p]) => (id === e.pointerId ? next : p));
        const [b0, b1] = before;
        const [a0, a1] = after;
        if (b0 && b1 && a0 && a1) write(pinchUpdate(read(), viewport(), [b0, b1], [a0, a1]));
        pointers.set(e.pointerId, next);
        return;
      }
      if (!dragging && pressStart) {
        if (Math.hypot(next.x - pressStart.x, next.y - pressStart.y) < DRAG_THRESHOLD_PX) return;
        dragging = true;
      }
      if (dragging) {
        swallowClick = true;
        write(panByPixels(read(), next.x - prev.x, next.y - prev.y));
      }
      pointers.set(e.pointerId, next);
    };

    const onPointerEnd = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (pointers.size === 0) {
        dragging = false;
        pressStart = null;
      } else if (pointers.size === 1) {
        // Remaining finger continues as a pan from where it is, with no jump.
        pressStart = null;
      }
    };

    // A drag that ends over the board must not also select/click whatever is underneath.
    const onClickCapture = (e: MouseEvent) => {
      if (swallowClick) {
        e.stopPropagation();
        swallowClick = false;
      }
    };
    const onPointerDownReset = () => {
      swallowClick = false;
    };

    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDownReset, true);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('click', onClickCapture, true);
    return () => {
      el.style.touchAction = prevTouchAction;
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDownReset, true);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, [gl, invalidate, getState]);

  return null;
}
