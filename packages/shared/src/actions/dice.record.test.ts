import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DiceRecord, verifyRollDraws } from '../schema/index.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix } from './testing.js';

const payload = {
  audience: { kind: 'dm' as const },
  result: {
    notation: '2d20kh1+5',
    dice: [
      { sides: 20, value: 1, kept: false, sign: 1 as const },
      { sides: 20, value: 20, kept: true, sign: 1 as const },
    ],
    modifier: 5,
    total: 25,
  },
};
const action = {
  id: IDS.action,
  type: 'dice.record',
  payload,
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 123,
  rng: [0, 0.99],
};
describe('dice.record (ACT-02)', () => {
  it('rejects every client actor, including host and mods', () => {
    expect(Object.values(permissionMatrix(makeCampaign(), 'dice.record', payload))).toEqual(
      Array(6).fill(false),
    );
  });
  it('replays host output deterministically with all draws, dropped dice and total', () => {
    const state = makeCampaign();
    const result = reduceAction(state, action);
    expect(reduceAction(state, action)).toEqual(result);
    expect(result.state.chat?.[0]).toMatchObject({ kind: 'roll', result: payload.result });
    for (const rng of [[], [0], [0, 1], [0, NaN], [0, Infinity], [0, -0.1], [0, 0.1]])
      expect(() => reduceAction(state, { ...action, rng })).toThrow('invalid roll proof');
  });
  it('rejects invalid totals, dimensions, faces, extra fields and excessive dice', () => {
    for (const result of [
      { ...payload.result, total: 24 },
      { ...payload.result, dice: [{ sides: 6, value: 7, kept: true, sign: 1 }] },
      { ...payload.result, dice: Array(1001).fill(payload.result.dice[0]) },
      { ...payload.result, notation: '' },
      { ...payload.result, forged: true },
    ])
      expect(DiceRecord.safeParse({ ...payload, result }).success).toBe(false);
  });
  it('verifies faces for arbitrary bounded host random draws', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1_000_000 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (sides, bits) => {
          const draw = bits / 2 ** 32;
          const value = Math.floor(draw * sides) + 1;
          expect(
            verifyRollDraws(
              {
                notation: '1dN',
                dice: [{ sides, value, kept: true, sign: 1 }],
                modifier: 0,
                total: value,
              },
              [draw],
            ),
          ).toBe(true);
        },
      ),
    );
  });
});
