import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { IDS, makeCampaign } from '../actions/testing.js';
import { createStoreMigrate } from './registry.js';

const migrate = createStoreMigrate(undefined, 5);

describe('v4 to v5 seat archive migration', () => {
  it.each([true, false, undefined])(
    'preserves interaction %s and archived history through a round trip',
    (interactionEnabled) => {
      const state = { ...makeCampaign(), schemaVersion: 4 };
      const seat = state.seats[IDS.owner];
      if (!seat) throw new Error('missing seat');
      if (interactionEnabled !== undefined) seat.interactionEnabled = interactionEnabled;
      seat.archived = true;
      seat.identityId = IDS.identity;
      const before = structuredClone(state);
      const expected = { ...state, schemaVersion: 5 };
      const campaign = migrate('campaign', 4, state);
      expect(campaign).toEqual(expected);
      expect(Campaign.parse(JSON.parse(JSON.stringify(campaign)))).toEqual(expected);
      expect(migrate('snapshot', 4, { schemaVersion: 4, state, seq: 42 })).toEqual({
        schemaVersion: 5,
        state: expected,
        seq: 42,
      });
      expect(state).toEqual(before);
    },
  );
  it('keeps old seats active without fabricating archive records and preserves other roots', () => {
    const state = { ...makeCampaign(), schemaVersion: 4 };
    expect(migrate('campaign', 4, state)).toEqual({ ...state, schemaVersion: 5 });
    const scene = { name: 'scene' };
    expect(migrate('scene', 4, scene)).toBe(scene);
    expect(migrate('session', 4, { schemaVersion: 4, name: 'session' })).toEqual({
      schemaVersion: 5,
      name: 'session',
    });
  });
});
