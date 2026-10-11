import { expect, it } from 'vitest';
import fc from 'fast-check';
import { applyPatches } from 'immer';
import { ACTORS, IDS, makeCampaign, makeEntity } from '../actions/testing.js';
import { reduceAction } from '../actions/run.js';
import { patchesFor, visibleTo } from './index.js';

it('sends hover/click text immediately but keeps proximity text and backups private across edits', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('hover', 'click'),
      fc.double({ min: 0, max: 100, noNaN: true }),
      (reveal, proximity) => {
        const before = makeCampaign();
        const scene = before.scenes[IDS.scene];
        if (!scene) throw new Error('scene');
        scene.entities[IDS.entity] = makeEntity(IDS.entity, {
          pin: { text: 'Immediate text', reveal },
          legacyPin: { text: 'Private archive' },
        });
        const prefabEntity = { ...scene.entities[IDS.entity] };
        Reflect.deleteProperty(prefabEntity, 'id');
        before.prefabs = {
          [IDS.entity]: {
            id: IDS.entity,
            name: 'Template',
            entity: { ...makeEntity(IDS.entity), ...prefabEntity },
          },
        };
        const after = reduceAction(before, {
          id: IDS.action,
          actor: ACTORS.host,
          type: 'pin.update',
          campaignId: IDS.campaign,
          sessionId: IDS.session,
          seq: 1,
          ts: 1000,
          payload: {
            sceneId: IDS.scene,
            entityId: IDS.entity,
            changes: { text: 'Proximity secret', reveal: { proximity } },
          },
        });
        for (const audience of [
          { kind: 'spectators' },
          { kind: 'seat', seatId: IDS.owner },
        ] as const) {
          expect(JSON.stringify(visibleTo(audience, before))).toContain('Immediate text');
          const view = visibleTo(audience, after.state);
          const patches = patchesFor(audience, before, after.state, after.patches);
          expect(JSON.stringify([view, patches])).not.toMatch(
            /Proximity secret|Private archive|legacyPin/,
          );
          expect(applyPatches(visibleTo(audience, before), patches)).toEqual(view);
          expect(view.scenes[IDS.scene]?.entities[IDS.entity]).not.toHaveProperty('pin');
          const restored = reduceAction(after.state, {
            id: IDS.action,
            actor: ACTORS.host,
            type: 'pin.update',
            campaignId: IDS.campaign,
            sessionId: IDS.session,
            seq: 2,
            ts: 1001,
            payload: { sceneId: IDS.scene, entityId: IDS.entity, changes: { reveal } },
          });
          expect(
            applyPatches(view, patchesFor(audience, after.state, restored.state, restored.patches)),
          ).toEqual(visibleTo(audience, restored.state));
        }
        const coDm = visibleTo({ kind: 'seat', seatId: IDS.coDm }, after.state);
        expect(coDm.scenes[IDS.scene]?.entities[IDS.entity]?.pin?.text).toBe('Proximity secret');
        expect(coDm.scenes[IDS.scene]?.entities[IDS.entity]).not.toHaveProperty('legacyPin');
        expect(JSON.stringify(visibleTo({ kind: 'seat', seatId: IDS.coDm }, before))).not.toContain(
          'Private archive',
        );
      },
    ),
    { numRuns: 50 },
  );
});
