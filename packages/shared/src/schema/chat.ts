import { z } from 'zod';
import { Id } from './ids.js';

/** ACT-01: destinations describe seats, never transport identities. */
export const ChatAudience = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('public') }),
  z.strictObject({ kind: z.literal('whisper'), seatId: Id }),
  z.strictObject({ kind: z.literal('dm') }),
]);
export type ChatAudience = z.infer<typeof ChatAudience>;
export const ChatAuthor = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('host'), label: z.string().max(200) }),
  z.strictObject({ kind: z.literal('seat'), seatId: Id, label: z.string().max(200) }),
]);
export type ChatAuthor = z.infer<typeof ChatAuthor>;
export const ChatPost = z.strictObject({
  audience: ChatAudience,
  text: z.string().trim().min(1).max(4000),
});
/** Every die draw is retained, including discarded keep/drop and explosion draws. */
export const RollDie = z
  .strictObject({
    sides: z.number().int().min(2).max(1_000_000),
    value: z.number().int().min(1).max(1_000_000),
    kept: z.boolean(),
    sign: z.union([z.literal(1), z.literal(-1)]),
  })
  .refine((die) => die.value <= die.sides, 'die value exceeds sides');
export const RollResult = z
  .strictObject({
    notation: z.string().trim().min(1).max(200),
    dice: z.array(RollDie).min(1).max(1000),
    modifier: z.number().int().min(-1_000_000).max(1_000_000),
    total: z.number().int().min(-1_001_000_000).max(1_001_000_000),
  })
  .refine(
    (roll) =>
      roll.total ===
      roll.modifier +
        roll.dice.reduce((sum, die) => sum + (die.kept ? die.sign * die.value : 0), 0),
    'roll total does not match kept dice and modifier',
  );
export type RollResult = z.infer<typeof RollResult>;
export const DiceRecord = z.strictObject({ audience: ChatAudience, result: RollResult });
export type DiceRecord = z.infer<typeof DiceRecord>;
const metadata = {
  id: Id,
  sessionId: Id,
  seq: z.number().int().positive(),
  ts: z.number().nonnegative(),
  author: ChatAuthor,
  audience: ChatAudience,
};
export const ChatMessage = z.discriminatedUnion('kind', [
  z.strictObject({ ...metadata, kind: z.literal('text'), text: ChatPost.shape.text }),
  z.strictObject({ ...metadata, kind: z.literal('roll'), result: RollResult }),
]);
export type ChatMessage = z.infer<typeof ChatMessage>;
/** The durable log retains older entries; snapshots carry bounded recent scrollback. */
export const CHAT_HISTORY_LIMIT = 1000;
export const ChatHistory = z.array(ChatMessage).max(CHAT_HISTORY_LIMIT);

/** ACT-02: replay verifies each face against the host's logged draw, as well as the total. */
export function verifyRollDraws(result: RollResult, rng: readonly number[]): boolean {
  return (
    rng.length === result.dice.length &&
    result.dice.every((die, i) => {
      const draw = rng[i];
      return (
        draw !== undefined &&
        Number.isFinite(draw) &&
        draw >= 0 &&
        draw < 1 &&
        die.value === Math.floor(draw * die.sides) + 1
      );
    })
  );
}
