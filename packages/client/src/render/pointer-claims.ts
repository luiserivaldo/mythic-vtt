import { useSyncExternalStore } from 'react';

/**
 * Pointer arbitration between board controls. A control that owns a press (a gizmo handle)
 * claims the pointer id in the capture phase; the camera and the marquee then decline it. A left
 * drag on empty board pans (Pan tool) or draws the marquee (Select, UX-16), so a claim is the only
 * way to keep a handle drag from also doing either.
 */
export interface PointerClaims {
  claim(pointerId: number, owner?: string): void;
  release(pointerId: number): void;
  isClaimed(pointerId: number): boolean;
  owner: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

export function createPointerClaims(): PointerClaims {
  const claimed = new Map<number, string>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const owner = () => [...claimed.values()].at(-1) ?? null;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    claim: (id, nextOwner = 'unknown') => {
      claimed.set(id, nextOwner);
      notify();
    },
    release: (id) => {
      if (claimed.delete(id)) notify();
    },
    isClaimed: (id) => claimed.has(id),
    owner,
    subscribe,
  };
}

export const pointerClaims = createPointerClaims();

export function usePointerOwner(): string | null {
  return useSyncExternalStore(
    (listener) => pointerClaims.subscribe(listener),
    () => pointerClaims.owner(),
    () => pointerClaims.owner(),
  );
}
