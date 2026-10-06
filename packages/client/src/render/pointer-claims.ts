/**
 * Pointer arbitration between board controls. A control that owns a press (a gizmo handle)
 * claims the pointer id in the capture phase; PanZoomControls then declines to pan with it.
 * Left-drag pans by default (CAM-01), so a claim is the only way to keep a handle drag from
 * also moving the camera.
 */
export interface PointerClaims {
  claim(pointerId: number): void;
  release(pointerId: number): void;
  isClaimed(pointerId: number): boolean;
}

export function createPointerClaims(): PointerClaims {
  const claimed = new Set<number>();
  return {
    claim: (id) => {
      claimed.add(id);
    },
    release: (id) => {
      claimed.delete(id);
    },
    isClaimed: (id) => claimed.has(id),
  };
}

export const pointerClaims = createPointerClaims();
