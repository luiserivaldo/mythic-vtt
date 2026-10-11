import { describe, expect, it } from 'vitest';
import { storeMigrate } from './registry.js';
import { makeCampaign, IDS } from '../actions/testing.js';
import { Campaign } from '../schema/index.js';

describe('v3 to v4 interaction migration', () => {
  it('preserves data and defaults old seats on in campaigns and snapshots', () => {
    const state = { ...makeCampaign(), schemaVersion: 3 };
    const old = structuredClone(state);
    const next = Campaign.parse(storeMigrate('campaign', 3, state));
    expect(next.seats[IDS.owner]?.interactionEnabled).toBe(true);
    expect(state).toEqual(old);
    const snapshot = storeMigrate('snapshot', 3, { schemaVersion: 3, state, seq: 42 });
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
    expect(storeMigrate('scene', 3, scene)).toBe(scene);
  });
});
