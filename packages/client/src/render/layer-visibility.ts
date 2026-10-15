import type { LayerId, Scene } from '@mythic/shared';
import { Color } from 'three';
import type { SelectionActor } from '../tools/selection.js';
import type { RenderEntity, RenderScene } from './scene-model.js';

/**
 * UI-LAY-01: the single place that applies the viewer's local "hidden layers" to what is drawn
 * and picked. An entity on a hidden layer is not mounted at all, so it is neither drawn nor
 * hit by a pointer ray. `visibleEntities` also marks objects off the active layer (MV-244).
 */
export function isEntityHidden(
  entity: RenderEntity,
  scene: Scene | null,
  hiddenLayers: ReadonlySet<LayerId>,
): boolean {
  if (hiddenLayers.size === 0) return false;
  const layer = scene?.entities[entity.id]?.layer;
  return layer !== undefined && hiddenLayers.has(layer);
}

/**
 * UI-LAY-01 (MV-244): the layer this viewer is working on, or null when the active layer does not
 * filter their board. Only the host and co-DMs have the Layers tab to switch it; a player or
 * spectator cannot leave the default, so their board is never dimmed and picks as before.
 */
export function focusedLayer(actor: SelectionActor, activeLayer: LayerId): LayerId | null {
  if (actor.kind === 'host') return activeLayer;
  return actor.kind === 'seat' && actor.seat.role === 'codm' ? activeLayer : null;
}

/**
 * MV-244: whether an object on `layer` sits off the viewer's focused layer, so it is shaded and
 * picking passes through it. Only tokens and props are affected: the map layer (battlemap) is
 * exempt and keeps its colour and its picking whatever layer is active.
 */
export function isOffFocus(layer: LayerId | undefined, focus: LayerId | null): boolean {
  return focus !== null && layer !== undefined && layer !== focus && layer !== 'map';
}

export function visibleEntities(
  rendered: RenderScene | null,
  scene: Scene | null,
  hiddenLayers: ReadonlySet<LayerId>,
  focus: LayerId | null = null,
): RenderEntity[] {
  return (rendered?.entities ?? []).flatMap((entity) => {
    if (isEntityHidden(entity, scene, hiddenLayers)) return [];
    const layer = scene?.entities[entity.id]?.layer;
    // MV-244: objects off the active layer are drawn in a darker shade (see `layerShade`).
    return isOffFocus(layer, focus) ? [{ ...entity, dimmed: true }] : [entity];
  });
}

/**
 * MV-244: inactive-layer objects keep their opacity and take a darker shade instead. A tint reads
 * the same on 2D sprites and lit 3D props, and leaves opacity to the 3D occlusion fade (CAM-05).
 */
export const INACTIVE_LAYER_SHADE = 0.45;

/** `color` as drawn: unchanged, or darkened when its entity sits on an inactive layer. */
export function layerShade(color: string, dimmed: boolean | undefined): string {
  if (!dimmed) return color;
  return `#${new Color(color).multiplyScalar(INACTIVE_LAYER_SHADE).getHexString()}`;
}
