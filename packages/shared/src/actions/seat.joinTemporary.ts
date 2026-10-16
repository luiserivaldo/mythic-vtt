import { z } from 'zod';
import { Id, PLAYER_TEMPLATE_TOOLS } from '../schema/index.js';
import { defineAction, isHost } from './define.js';
import { MAX_TEMPORARY_SEATS } from './temporary-seats.js';

const DEFAULT_PERMISSIONS = { view: true, move: true, edit: false, delete: false } as const;

/**
 * UI-JOIN-01 (UX-44): "Join As Temporary Player". The host builds the payload (it picks `seatId`),
 * the joiner supplies only a display name. The seat is session-only: `seat.discardTemporary` ends
 * it and the save paths drop it (`withoutTemporarySeats`).
 */
export const seatJoinTemporary = defineAction({
  type: 'seat.joinTemporary',
  schema: z.strictObject({
    seatId: Id,
    identityId: Id,
    label: z.string().trim().min(1).max(80),
  }),
  permission: (state, actor, p) => {
    if (p.seatId in state.seats) return false;
    if (state.activeSceneId === null && !isHost(actor)) return false;
    const seats = Object.values(state.seats);
    if (seats.filter((s) => s.temporary).length >= MAX_TEMPORARY_SEATS) return false;
    // SES-03: one seat per identity.
    if (seats.some((s) => !s.archived && s.identityId === p.identityId)) return false;
    // A seated actor (or a spectator with no identity) cannot create one for somebody else.
    return actor.kind === 'seat' && actor.seatId === undefined && actor.identityId === p.identityId;
  },
  reduce: (draft, a) => {
    draft.seats[a.payload.seatId] = {
      id: a.payload.seatId,
      label: a.payload.label,
      binding: 'session',
      identityId: a.payload.identityId,
      role: 'player',
      interactionEnabled: true,
      permissions: { ...DEFAULT_PERMISSIONS },
      // MV-288: stored explicitly, so a temporary player gets the Player template's tools and
      // not the frozen `DEFAULT_SEAT_TOOLS` fallback. Temporary seats never reach a save.
      tools: { ...PLAYER_TEMPLATE_TOOLS },
      temporary: true,
    };
  },
  modExposed: false,
});
