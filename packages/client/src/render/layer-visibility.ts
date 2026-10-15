import type { LayerId, Scene } from '@mythic/shared';
import type { RenderEntity, RenderScene } from './scene-model.js';

/**
 * UI-LAY-01: the single place that applies the viewer's local "hidden layers" to what is drawn
 * and picked. An entity on a hidden layer is not mounted at all, so it is neither drawn nor
 * hit by a pointer ray. Other view filters (e.g. dimming inactive layers) extend this function.
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

export function visibleEntities(
  rendered: RenderScene | null,
  scene: Scene | null,
  hiddenLayers: ReadonlySet<LayerId>,
): RenderEntity[] {
  return (rendered?.entities ?? []).filter(
    (entity) => !isEntityHidden(entity, scene, hiddenLayers),
  );
}
