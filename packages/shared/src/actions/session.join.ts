import { z } from 'zod';
import { Id } from '../schema/index.js';
import { defineAction, isHost } from './define.js';

export const sessionJoin = defineAction({
  type: 'session.join',
  schema: z.strictObject({ seatId: Id, identityId: Id }),
  permission: (state, actor, p) => {
    const seat = state.seats[p.seatId];
    if (state.activeSceneId === null && !isHost(actor)) return false;
    if (!seat || seat.archived || (seat.identityId !== null && seat.identityId !== p.identityId))
      return false;
    // MV-269: only the host grants a co-DM seat (`seat.assign`, or a SES-04 invite). Anyone else
    // may only rejoin a co-DM seat their identity already holds.
    if (seat.role === 'codm' && !isHost(actor) && seat.identityId !== p.identityId) return false;
    if (
      Object.values(state.seats).some(
        (candidate) =>
          !candidate.archived && candidate.identityId === p.identityId && candidate.id !== p.seatId,
      )
    ) {
      return false;
    }
    return isHost(actor) || (actor.kind === 'seat' && actor.identityId === p.identityId);
  },
  reduce: (draft, a) => {
    const seat = draft.seats[a.payload.seatId];
    if (seat) seat.identityId = a.payload.identityId;
  },
  modExposed: false,
});
