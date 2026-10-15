import { createStore } from 'zustand/vanilla';
import type { Px } from '../render/board-input.js';

/**
 * UI-TOOL-01 / C13 (MV-242): Select-tool area select. A left drag on empty board draws a screen
 * rectangle; on release every selectable token or prop whose centre lies inside it is selected.
 * Selection is local view state, never an action.
 */

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle spanned by two corners, in whichever order they were dragged. */
export function marqueeRect(a: Px, b: Px): ScreenRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export interface ScreenPoint extends Px {
  id: string;
}

/** Ids of the points inside the rectangle (edges inclusive), in input order. */
export function idsInRect(points: readonly ScreenPoint[], rect: ScreenRect): string[] {
  return points
    .filter((p) => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom)
    .map((p) => p.id);
}

/** A plain marquee replaces the selection; Shift/Ctrl/Meta adds to it (like a modified click). */
export function marqueeSelection(
  current: readonly string[],
  inside: readonly string[],
  additive: boolean,
): string[] {
  if (!additive) return [...inside];
  return [...current, ...inside.filter((id) => !current.includes(id))];
}

interface MarqueeState {
  /** The rectangle being dragged, in viewport (client) pixels; null when none is shown. */
  rect: ScreenRect | null;
  set(rect: ScreenRect | null): void;
}

export const marqueeStore = createStore<MarqueeState>()((set) => ({
  rect: null,
  set: (rect) => {
    set({ rect });
  },
}));
