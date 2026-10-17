import {
  canPerform,
  isAdmin,
  isLayerLocked,
  isProp,
  type Actor,
  type Campaign,
  type Entity,
} from '@mythic/shared';
import type { IntentSpec } from './intent-specs.js';

// MV-243 / UI-TOKEN-05: a prop is ground or not. The right-click menu and (later) object-edit mode
// share this model, so both show and change the same flag through the ordinary entity.update path.
// `shape.walkable` is the stored collidable flag (ENV-04): walkable surfaces are what tokens stand on.

export const COLLIDABLE_LABEL = 'Collidable';
/** MV-290: a seat's Edit permission covers its tokens; props are DM work. */
export const PROP_DM_ONLY_REASON = 'Only the DM can edit props.';

export interface PropCollidableModel {
  checked: boolean;
  enabled: boolean;
  /** null when the viewer may use it; else why it is shown disabled. */
  reason: string | null;
}

/** The toggle for one prop, or null when the entity has no shape. Mirrors what the host would allow. */
export function propCollidableModel(
  campaign: Campaign,
  sceneId: string,
  entity: Entity,
  actor: Actor,
): PropCollidableModel | null {
  const shape = entity.shape;
  if (!shape) return null;
  const scene = campaign.scenes[sceneId];
  if (scene && isLayerLocked(scene, entity.layer))
    return { checked: shape.walkable, enabled: false, reason: 'That layer is locked.' };
  const enabled = canPerform(campaign, actor, 'entity.update', {
    sceneId,
    entityId: entity.id,
    changes: { shape },
  });
  return {
    checked: shape.walkable,
    enabled,
    reason: enabled
      ? null
      : isProp(entity) && !isAdmin(campaign, actor)
        ? PROP_DM_ONLY_REASON
        : 'You cannot edit this prop.',
  };
}

/** entity.update merges top-level fields, so the whole shape is replaced with the flag changed. */
export const propCollidableIntent = (
  sceneId: string,
  entityId: string,
  shape: NonNullable<Entity['shape']>,
  collidable: boolean,
): IntentSpec => ({
  type: 'entity.update',
  payload: { sceneId, entityId, changes: { shape: { ...shape, walkable: collidable } } },
  sceneId,
});
