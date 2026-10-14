import { describe, expect, it } from 'vitest';
import { createStoreMigrate, storeMigrate } from './registry.js';
import { v3ToV4 } from './v3-to-v4.js';
import { makeCampaign, IDS } from '../actions/testing.js';
import { Campaign } from '../schema/index.js';

describe('v3 to v4 interaction migration', () => {
  it('preserves data and defaults old seats on in campaigns and snapshots', () => {
    const state = { ...makeCampaign(), schemaVersion: 3 };
    const old = structuredClone(state);
    const next = Campaign.parse(storeMigrate('campaign', 3, state));
    expect(next.seats[IDS.owner]?.interactionEnabled).toBe(true);
    expect(state).toEqual(old);
    // Run this step alone so the assertion keeps describing v4, not whatever the chain ends at.
    const snapshot = createStoreMigrate([v3ToV4], 4)('snapshot', 3, {
      schemaVersion: 3,
      state,
      seq: 42,
    });
    expect(snapshot).toMatchObject({
      schemaVersion: 4,
      seq: 42,
      state: { schemaVersion: 4, seats: next.seats },
    });
  });
  it('preserves an explicit false and leaves scene payloads unchanged', () => {
    const state = makeCampaign();
    const seat = state.seats[IDS.owner];
    if (!seat) throw new Error('missing seat');
    seat.interactionEnabled = false;
    expect(
      Campaign.parse(storeMigrate('campaign', 3, state)).seats[IDS.owner]?.interactionEnabled,
    ).toBe(false);
    const scene = { name: 'Old scene' };
    expect(createStoreMigrate([v3ToV4], 4)('scene', 3, scene)).toBe(scene);
  });
});
