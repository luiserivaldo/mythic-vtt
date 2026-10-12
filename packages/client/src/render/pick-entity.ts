import type { Scene } from '@mythic/shared';
import type { Object3D } from 'three';

/**
 * MEAS-05 hover picking. Every pickable render mesh carries the entity id in `name` (2D sprite
 * quad, 3D standee base and quad, primitive fills, picked AoE discs), so a ray hit walks up to the
 * first named ancestor the scene actually holds. Unnamed helpers (grid, background, labels,
 * rulers) and friendly helper names ("grid", "canvas-fill") resolve to undefined.
 */
export function entityIdForObject(object: Object3D, scene: Scene): string | undefined {
  let current: Object3D | null = object;
  while (current) {
    if (current.name && scene.entities[current.name]) return current.name;
    current = current.parent;
  }
  return undefined;
}

/** The part of a Three.js intersection this module needs (hits stay in the raycaster's order). */
export interface PickTarget {
  readonly object: Object3D;
}

/**
 * The token under the pointer: the nearest hit that belongs to a *token* entity. A nearer non-token
 * hit (a prop in front, the map image, an AoE disc) does not shadow it, because MEAS-05 measures
 * token-to-token ranges and a prop standing between the two tokens must not break the readout.
 */
export function hoveredTokenId(hits: readonly PickTarget[], scene: Scene): string | null {
  for (const hit of hits) {
    const id = entityIdForObject(hit.object, scene);
    if (id !== undefined && scene.entities[id]?.token) return id;
  }
  return null;
}
