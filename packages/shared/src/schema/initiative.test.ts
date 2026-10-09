import { expect, it } from 'vitest';
import fc from 'fast-check';
import { Initiative, MAX_ROUND, nextInitiative } from './initiative.js';

it('validates unique bounded orders and existing active members', () => {
  const id = '0'.repeat(26);
  const valid = { round: 1, order: [id], activeEntityId: id };
  expect(Initiative.safeParse(valid).success).toBe(true);
  for (const value of [
    { ...valid, round: 0 },
    { ...valid, round: Infinity },
    { ...valid, round: 1.5 },
    { ...valid, order: [id, id] },
    { ...valid, activeEntityId: '1'.repeat(26) },
    { ...valid, order: Array.from({ length: 201 }, (_, index) => String(index).padStart(26, '0')) },
    { ...valid, extra: true },
  ])
    expect(Initiative.safeParse(value).success).toBe(false);
});
it('advances exactly one turn, wraps rounds and never mutates input', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 200 }),
      fc.integer({ min: 1, max: MAX_ROUND - 1 }),
      fc.nat(),
      (count, round, seed) => {
        const order = Array.from({ length: count }, (_, index) => String(index).padStart(26, '0'));
        const index = seed % count;
        const before = { round, order, activeEntityId: order[index] ?? null };
        const copy = structuredClone(before);
        const next = nextInitiative(before);
        expect(next?.activeEntityId).toBe(order[(index + 1) % count]);
        expect(next?.round).toBe(round + (index === count - 1 ? 1 : 0));
        expect(before).toEqual(copy);
      },
    ),
  );
});
it('starts a paused order, refuses an empty order and bounds round overflow', () => {
  const id = '0'.repeat(26);
  expect(nextInitiative({ round: 1, order: [], activeEntityId: null })).toBeUndefined();
  expect(nextInitiative({ round: MAX_ROUND, order: [id], activeEntityId: id })).toBeUndefined();
  expect(nextInitiative({ round: 3, order: [id], activeEntityId: null })).toMatchObject({
    round: 3,
    activeEntityId: id,
  });
});
