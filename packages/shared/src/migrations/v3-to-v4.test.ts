import { expect, it } from 'vitest';
import fc from 'fast-check';
import { IDS, makeCampaign, makeEntity } from '../actions/testing.js';
import { Campaign, PIN_TEXT_MAX_LENGTH } from '../schema/index.js';
import { storeMigrate } from './registry.js';
import { visibleTo } from '../visibility/index.js';

it('normalizes old scene, prefab and snapshot pins without losing or mutating source data', () => {
  fc.assert(
    fc.property(fc.integer({ min: 4097, max: 6000 }), (length) => {
      const pin = { text: 'x'.repeat(length), reveal: 'click', extra: 'keep-original' };
      const entity = { ...makeEntity(IDS.entity), pin };
      const blueprint = { ...entity };
      Reflect.deleteProperty(blueprint, 'id');
      const state = {
        ...makeCampaign(),
        schemaVersion: 3,
        scenes: {
          [IDS.scene]: { ...makeCampaign().scenes[IDS.scene], entities: { [IDS.entity]: entity } },
        },
        prefabs: {
          [IDS.entity]: {
            id: IDS.entity,
            name: 'Old template',
            entity: blueprint,
          },
        },
      };
      const original = structuredClone(state);
      const result = storeMigrate('snapshot', 3, { state, seq: 7 }) as {
        state: unknown;
        seq: number;
      };
      const after = Campaign.parse(result.state);
      expect(after.schemaVersion).toBe(4);
      expect(result.seq).toBe(7);
      expect(after.scenes[IDS.scene]?.entities[IDS.entity]).toMatchObject({
        pin: { text: 'x'.repeat(PIN_TEXT_MAX_LENGTH), reveal: 'click' },
        legacyPin: pin,
      });
      expect(after.prefabs?.[IDS.entity]?.entity.legacyPin).toEqual(pin);
      expect(state).toEqual(original);
      expect(storeMigrate('snapshot', 4, result)).toBe(result);
      const scene = storeMigrate('scene', 3, state.scenes[IDS.scene]);
      expect(scene).toEqual(after.scenes[IDS.scene]);
      const campaign = storeMigrate('campaign', 3, state) as Campaign;
      expect(campaign.prefabs).toEqual(after.prefabs);
    }),
    { numRuns: 50 },
  );
});

it('archives empty and malformed pins and removes the unusable active component', () => {
  for (const pin of [
    { text: '', reveal: 'hover' },
    { text: 'note', reveal: { proximity: -1 } },
    null,
  ]) {
    const state = makeCampaign();
    const scene = state.scenes[IDS.scene];
    if (!scene) throw new Error('scene');
    const oldScene = { ...scene, entities: { [IDS.entity]: { ...makeEntity(IDS.entity), pin } } };
    const migrated = storeMigrate('scene', 3, oldScene) as typeof scene;
    expect(migrated.entities[IDS.entity]?.pin).toBeUndefined();
    expect(migrated.entities[IDS.entity]?.legacyPin).toEqual(pin);
    state.scenes[IDS.scene] = migrated;
    for (const audience of [{ kind: 'spectators' }, { kind: 'seat', seatId: IDS.coDm }] as const)
      expect(visibleTo(audience, state).scenes[IDS.scene]?.entities[IDS.entity]).not.toHaveProperty(
        'legacyPin',
      );
  }
});
