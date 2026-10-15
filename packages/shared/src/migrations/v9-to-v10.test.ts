import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { makeCampaign } from '../actions/testing.js';
import { createStoreMigrate } from './registry.js';

const migrate = createStoreMigrate(undefined, 10);

describe('v9 to v10 initiative score migration', () => {
  it('bumps only the campaign schemaVersion', () => {
    const state = { ...makeCampaign(), schemaVersion: 9 };
    const before = structuredClone(state);
    const expected = { ...state, schemaVersion: 10 };
    const campaign = migrate('campaign', 9, state);
    expect(campaign).toEqual(expected);
    expect(Campaign.parse(JSON.parse(JSON.stringify(campaign)))).toEqual(expected);
    expect(state).toEqual(before);
  });
  it('bumps snapshot state and keeps seq', () => {
    const state = { ...makeCampaign(), schemaVersion: 9 };
    expect(migrate('snapshot', 9, { schemaVersion: 9, state, seq: 4 })).toEqual({
      schemaVersion: 10,
      state: { ...state, schemaVersion: 10 },
      seq: 4,
    });
  });
  it('passes a scene with an unscored v9 initiative through unchanged', () => {
    const scene = {
      name: 'scene',
      initiative: { round: 2, order: ['0'.repeat(26)], activeEntityId: null },
    };
    expect(migrate('scene', 9, scene)).toBe(scene);
  });
});
