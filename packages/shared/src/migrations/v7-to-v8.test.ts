import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { IDS, makeCampaign } from '../actions/testing.js';
import { createStoreMigrate } from './registry.js';

const migrate = createStoreMigrate(undefined, 8);

describe('v7 to v8 initiative migration', () => {
  it('bumps only the campaign schemaVersion and leaves scenes without initiative', () => {
    const state = { ...makeCampaign(), schemaVersion: 7 };
    const before = structuredClone(state);
    const expected = { ...state, schemaVersion: 8 };
    const campaign = migrate('campaign', 7, state);
    expect(campaign).toEqual(expected);
    expect(Campaign.parse(JSON.parse(JSON.stringify(campaign)))).toEqual(expected);
    expect(state).toEqual(before);
  });
  it('bumps snapshot state, keeps seq and any scene initiative exactly', () => {
    const base = makeCampaign();
    const scene = base.scenes[IDS.scene];
    if (!scene) throw new Error('missing scene');
    scene.initiative = { round: 3, order: [IDS.entity], activeEntityId: IDS.entity };
    const state = { ...base, schemaVersion: 7 };
    expect(migrate('snapshot', 7, { schemaVersion: 7, state, seq: 42 })).toEqual({
      schemaVersion: 8,
      state: { ...state, schemaVersion: 8 },
      seq: 42,
    });
  });
  it('passes scenes through and bumps session metadata', () => {
    const scene = { name: 'scene' };
    expect(migrate('scene', 7, scene)).toBe(scene);
    expect(migrate('session', 7, { schemaVersion: 7, name: 'session' })).toEqual({
      schemaVersion: 8,
      name: 'session',
    });
  });
});
