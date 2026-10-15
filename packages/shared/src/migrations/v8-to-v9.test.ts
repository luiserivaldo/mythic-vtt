import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { IDS, makeCampaign } from '../actions/testing.js';
import { createStoreMigrate } from './registry.js';

const migrate = createStoreMigrate(undefined, 9);

describe('v8 to v9 seat icon and branding migration', () => {
  it('bumps only the campaign schemaVersion and adds none of the optional fields', () => {
    const state = { ...makeCampaign(), schemaVersion: 8 };
    const before = structuredClone(state);
    const expected = { ...state, schemaVersion: 9 };
    const campaign = migrate('campaign', 8, state);
    expect(campaign).toEqual(expected);
    const parsed = Campaign.parse(JSON.parse(JSON.stringify(campaign)));
    expect(parsed).toEqual(expected);
    expect(parsed.icon).toBeUndefined();
    expect(Object.values(parsed.seats).every((seat) => seat.temporary === undefined)).toBe(true);
    expect(state).toEqual(before);
  });
  it('bumps snapshot state, keeps seq and existing seats exactly', () => {
    const base = makeCampaign();
    const seat = base.seats[IDS.owner];
    if (!seat) throw new Error('missing seat');
    seat.identityId = IDS.identity;
    seat.archived = true;
    const state = { ...base, schemaVersion: 8 };
    expect(migrate('snapshot', 8, { schemaVersion: 8, state, seq: 7 })).toEqual({
      schemaVersion: 9,
      state: { ...state, schemaVersion: 9 },
      seq: 7,
    });
  });
  it('passes scenes through and bumps session metadata', () => {
    const scene = { name: 'scene' };
    expect(migrate('scene', 8, scene)).toBe(scene);
    expect(migrate('session', 8, { schemaVersion: 8, name: 'session' })).toEqual({
      schemaVersion: 9,
      name: 'session',
    });
  });
});
