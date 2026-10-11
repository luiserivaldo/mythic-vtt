import { DiceRecord, verifyRollDraws } from '../schema/index.js';
import { defineAction } from './define.js';
import { appendChat, chatAuthor } from './chat-access.js';

/** ACT-02: internal host output, never a client intent (including the DM's browser). */
export const diceRecord = defineAction({
  type: 'dice.record',
  schema: DiceRecord,
  permission: () => false,
  reduce(state, a) {
    if (!verifyRollDraws(a.payload.result, a.rng ?? [])) throw new Error('invalid roll proof');
    appendChat(state, {
      id: a.id,
      sessionId: a.sessionId,
      seq: a.seq,
      ts: a.ts,
      author: chatAuthor(state, a.actor),
      kind: 'roll',
      ...a.payload,
    });
  },
  modExposed: false,
});
