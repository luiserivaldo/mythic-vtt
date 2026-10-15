import type { Entity, LayerId } from '@mythic/shared';
import { createStore } from 'zustand/vanilla';
import type { Px } from '../render/board-input.js';
import type { RenderEntity } from '../render/scene-model.js';

/**
 * UI-TOOL-01 / C13 (MV-242): Select-tool area select. A left drag on empty board draws a screen
 * rectangle; on release every selectable token, prop or AoE whose centre lies inside it is
 * selected (MV-272). Selection is local view state, never an action.
 */

/**
 * MV-272: whether the marquee may gather this drawn entity (before the viewer's select permission).
 * Tokens, props and AoEs count; anything off the active layer (`dimmed`, MV-258) does not. A map
 * image is never dimmed, since the map layer keeps its picking for clicks, so the marquee takes it
 * only while the Map layer itself is the viewer's focused layer.
 */
export function marqueeGathers(
  entity: Pick<RenderEntity, 'dimmed' | 'token' | 'shape' | 'aoe' | 'mapImage'>,
  focus: LayerId | null,
): boolean {
  if (entity.dimmed) return false;
  if (entity.mapImage) return focus === 'map';
  return Boolean(entity.token ?? entity.shape ?? entity.aoe);
}

/**
 * MV-272: a map image the marquee runs over. A press on it starts a marquee rather than counting
 * as a click on something selectable, unless the Map layer is focused (then the map is a target).
 */
export function isMarqueeBackdrop(
  entity: Pick<Entity, 'layer' | 'image'>,
  focus: LayerId | null,
): boolean {
  return entity.layer === 'map' && entity.image !== undefined && focus !== 'map';
}

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
