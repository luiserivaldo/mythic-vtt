import type { Campaign, Entity, LayerId, Scene } from '../schema/index.js';
import type { Actor } from './envelope.js';
import { isCoDm, isHost, seatOf } from './define.js';

export type EntityCapability = 'move' | 'edit' | 'delete';

export function isAdmin(state: Campaign, actor: Actor): boolean {
  return isHost(actor) || isCoDm(state, actor);
}

export function isLayerLocked(scene: Scene, layer: LayerId): boolean {
  return scene.layers[layer]?.locked ?? false;
}

/** PERM-01/02: a player needs both a seat capability and ownership/an entity grant. */
export function canUseEntity(
  state: Campaign,
  actor: Actor,
  entity: Entity,
  capability: EntityCapability,
): boolean {
  if (isAdmin(state, actor)) return true;
  const seat = seatOf(state, actor);
  if (!seat || entity.layer === 'dm' || !seat.permissions.view) return false;

  const owns = entity.owners.includes(seat.id);
  const canView = owns || entity.perms?.view !== false;
  const hasGrant = owns || entity.perms?.[capability] === true;
  return canView && seat.permissions[capability] && hasGrant;
}
