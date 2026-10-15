import { isLayerLocked, type Campaign } from '@mythic/shared';
import type { IntentFailure } from '../net/intents.js';

export interface RejectContext {
  campaign: Campaign | null;
  /** The seat this client acts as; null for the host or a spectator. */
  seatId: string | null;
  isHost: boolean;
  type: string;
  payload: unknown;
}

function idsOf(payload: unknown): { sceneId?: string; entityId?: string } {
  if (typeof payload !== 'object' || payload === null) return {};
  const out: { sceneId?: string; entityId?: string } = {};
  if ('sceneId' in payload && typeof payload.sceneId === 'string') out.sceneId = payload.sceneId;
  if ('entityId' in payload && typeof payload.entityId === 'string')
    out.entityId = payload.entityId;
  return out;
}

/**
 * Plain-language reason for a `forbidden` reject, worked out from what this client may already
 * see. It never distinguishes "hidden" from "absent" (PERM-03): an entity missing from the
 * client's view gets the same generic answer as one the seat simply may not use.
 */
function explainForbidden(ctx: RejectContext): string {
  if (ctx.isHost) return 'You cannot do that right now.';
  const seat = ctx.seatId ? ctx.campaign?.seats[ctx.seatId] : undefined;
  if (!seat || seat.archived) return 'Spectators can only watch; you need a seat to do that.';
  if (seat.interactionEnabled === false) return 'The DM has turned off interaction for your seat.';
  const { sceneId, entityId } = idsOf(ctx.payload);
  const scene = sceneId ? ctx.campaign?.scenes[sceneId] : undefined;
  const entity = scene && entityId ? scene.entities[entityId] : undefined;
  if (scene && entity) {
    if (isLayerLocked(scene, entity.layer)) return 'That layer is locked.';
    if (!entity.owners.includes(seat.id) && entity.perms?.[capabilityOf(ctx.type)] !== true)
      return 'That token is not yours.';
    return 'Your seat is not allowed to do that to this token.';
  }
  return 'You do not have permission to do that.';
}

function capabilityOf(type: string): 'move' | 'edit' | 'delete' {
  if (type.endsWith('.move')) return 'move';
  if (/\.(remove|delete)$/.test(type)) return 'delete';
  return 'edit';
}

/** One sentence a player can act on, for every failure a UI intent can hit. */
export function explainFailure(reason: IntentFailure, ctx: RejectContext): string {
  switch (reason) {
    case 'forbidden':
      return explainForbidden(ctx);
    case 'invalid-payload':
      return 'That change is not valid.';
    case 'unknown-action':
      return 'This host does not support that action.';
    case 'rate-limited':
      return 'You are doing that too quickly. Wait a moment and try again.';
    case 'conflict':
      return 'That changed while you were acting. Try again.';
    case 'connection-lost':
      return 'The connection dropped before the host answered. Check the table, then try again.';
    case 'timeout':
      return 'The host did not answer in time. Try again.';
    case 'queue-full':
      return 'Too many actions are waiting for the connection. Wait until you are back online.';
  }
}
