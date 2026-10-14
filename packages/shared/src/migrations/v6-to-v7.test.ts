import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { IDS, makeCampaign, makeEntity } from '../actions/testing.js';
import { createStoreMigrate } from './registry.js';

const migrate = createStoreMigrate(undefined, 7);

describe('v6 to v7 seat archive migration', () => {
  it.each([true, false, undefined])(
    'preserves interaction %s and archived history through a round trip',
    (interactionEnabled) => {
      const state = { ...makeCampaign(), schemaVersion: 6 };
      const seat = state.seats[IDS.owner];
      if (!seat) throw new Error('missing seat');
      if (interactionEnabled !== undefined) seat.interactionEnabled = interactionEnabled;
      seat.archived = true;
      seat.identityId = IDS.identity;
      const scene = state.scenes[IDS.scene];
      if (!scene) throw new Error('missing scene');
      scene.entities[IDS.entity] = makeEntity(IDS.entity, {
        token: {
          sizeCells: 1,
          heightCells: 1,
          labelVisibility: 'all',
          quickFields: { hp: { value: 18, visibility: 'owner', color: '#123456' } },
        },
      });
      const before = structuredClone(state);
      const expected = { ...state, schemaVersion: 7 };
      const campaign = migrate('campaign', 6, state);
      expect(campaign).toEqual(expected);
      expect(Campaign.parse(JSON.parse(JSON.stringify(campaign)))).toEqual(expected);
      expect(migrate('snapshot', 6, { schemaVersion: 6, state, seq: 42 })).toEqual({
        schemaVersion: 7,
        state: expected,
        seq: 42,
      });
      expect(state).toEqual(before);
    },
  );
  it('keeps old seats active without fabricating archive records and preserves other roots', () => {
    const state = { ...makeCampaign(), schemaVersion: 6 };
    expect(migrate('campaign', 6, state)).toEqual({ ...state, schemaVersion: 7 });
    const scene = { name: 'scene' };
    expect(migrate('scene', 6, scene)).toBe(scene);
    expect(migrate('session', 6, { schemaVersion: 6, name: 'session' })).toEqual({
      schemaVersion: 7,
      name: 'session',
    });
  });
});
