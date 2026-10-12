import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyPatches } from 'immer';
import { ACTORS, IDS, makeCampaign, makeEntity } from './testing.js';
import { aoePersist } from './aoe.persist.js';
import { canPerform, reduceAction } from './run.js';
import type { Actor, ActionEnvelope } from './envelope.js';
import { patchesFor, visibleTo } from '../visibility/index.js';

const actor = { ...ACTORS.owner, identityId: IDS.identity };
const payload = { sceneId: IDS.scene, sourceId: IDS.identity, entityId: IDS.otherIdentity };
const source = () =>
  makeEntity(IDS.identity, {
    layer: 'effects',
    owners: [IDS.owner],
    aoe: { kind: 'sphere', radius: 2, color: '#ff8800' },
    measuringAoE: true,
  });
function stateWithSource() {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('missing scene');
  scene.entities[IDS.identity] = source();
  return state;
}
function envelope(
  who: Actor = actor,
  type = 'aoe.persist',
  data: unknown = payload,
): ActionEnvelope {
  return {
    id: IDS.action,
    type,
    payload: data,
    actor: who,
    campaignId: IDS.campaign,
    sceneId: IDS.scene,
    sessionId: IDS.session,
    seq: 1,
    ts: 1000,
  };
}

describe('aoe.persist', () => {
  it('validates IDs and rejects client ownership/provenance and unrelated fields', () => {
    expect(aoePersist.schema.safeParse(payload).success).toBe(true);
    for (const value of [
      { ...payload, sourceId: 'bad' },
      { ...payload, entityId: '' },
      { sceneId: IDS.scene, sourceId: IDS.identity },
      { ...payload, owners: [IDS.other] },
    ])
      expect(aoePersist.schema.safeParse(value).success).toBe(false);
  });
  it('promotes exactly the own template with canonical ownership, deterministically', () => {
    const state = stateWithSource(),
      before = structuredClone(state);
    expect(canPerform(state, actor, 'aoe.persist', payload)).toBe(true);
    const result = reduceAction(state, envelope());
    expect(result).toEqual(reduceAction(state, envelope()));
    expect(state).toEqual(before);
    expect(result.state.scenes[IDS.scene]?.entities[IDS.identity]).toBeUndefined();
    const expected = {
      ...source(),
      id: IDS.otherIdentity,
      owners: [IDS.owner],
      lastingAoE: { creatorIdentityId: IDS.identity },
    };
    delete expected.measuringAoE;
    expect(result.state.scenes[IDS.scene]?.entities[IDS.otherIdentity]).toEqual(expected);
    const withMeasure = reduceAction(
      result.state,
      envelope(actor, 'aoe.place', {
        sceneId: IDS.scene,
        entity: Object.fromEntries(
          Object.entries({ ...source(), owners: [] }).filter(([key]) => key !== 'measuringAoE'),
        ),
      }),
    ).state;
    expect(withMeasure.scenes[IDS.scene]?.entities[IDS.identity]?.owners).toEqual([IDS.owner]);
    expect(withMeasure.scenes[IDS.scene]?.entities[IDS.otherIdentity]?.lastingAoE).toEqual({
      creatorIdentityId: IDS.identity,
    });
    expect(
      canPerform(withMeasure, actor, 'aoe.persist', { ...payload, entityId: IDS.entity }),
    ).toBe(false);
    const removed = reduceAction(
      withMeasure,
      envelope(ACTORS.host, 'aoe.remove', {
        sceneId: IDS.scene,
        entityId: IDS.otherIdentity,
      }),
    ).state;
    expect(canPerform(removed, actor, 'aoe.persist', payload)).toBe(true);
  });
  it('enforces caps exactly at numeric boundaries while admins remain uncapped', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 51 }),
        (limit, count) => {
          const state = stateWithSource(),
            scene = state.scenes[IDS.scene];
          if (!scene) throw new Error('missing scene');
          scene.maxLastingAoEsPerPlayer = limit;
          for (let i = 0; i < count; i++) {
            const id = String(i + 20).padStart(26, '0');
            scene.entities[id] = {
              ...source(),
              id,
              lastingAoE: { creatorIdentityId: IDS.identity },
            };
          }
          expect(canPerform(state, actor, 'aoe.persist', payload)).toBe(count < limit);
          for (const admin of [ACTORS.host, ACTORS.coDm])
            expect(
              canPerform(state, { ...admin, identityId: IDS.identity }, 'aoe.persist', payload),
            ).toBe(true);
        },
      ),
    );
    for (const limit of [-1, 0.5, 51, Infinity, NaN])
      expect(
        canPerform(stateWithSource(), ACTORS.host, 'scene.update', {
          sceneId: IDS.scene,
          maxLastingAoEsPerPlayer: limit,
        }),
      ).toBe(false);
  });
  it('charges the authenticated placer across ownership changes and seat switches', () => {
    const placed = structuredClone(reduceAction(stateWithSource(), envelope()).state);
    const scene = placed.scenes[IDS.scene];
    if (!scene) throw new Error('missing scene');
    const lasting = scene.entities[IDS.otherIdentity];
    if (!lasting) throw new Error('missing lasting AoE');
    lasting.owners = [IDS.other];
    scene.entities[IDS.identity] = source();
    expect(
      canPerform(placed, { ...ACTORS.otherSeat, identityId: IDS.identity }, 'aoe.persist', {
        ...payload,
        entityId: IDS.entity,
      }),
    ).toBe(false);
    scene.maxLastingAoEsPerPlayer = 2;
    expect(
      canPerform(placed, { ...ACTORS.otherSeat, identityId: IDS.identity }, 'aoe.persist', {
        ...payload,
        entityId: IDS.entity,
      }),
    ).toBe(true);
  });
  it('redacts placement provenance in snapshots and patches, including reused seats', () => {
    const before = stateWithSource();
    const seat = before.seats[IDS.owner];
    if (!seat) throw new Error('missing seat');
    seat.identityId = IDS.identity;
    const result = reduceAction(before, envelope());
    for (const audience of [
      { kind: 'seat' as const, seatId: IDS.other },
      { kind: 'spectators' as const },
    ]) {
      const patches = patchesFor(audience, before, result.state, result.patches);
      expect(applyPatches(visibleTo(audience, before), patches)).toEqual(
        visibleTo(audience, result.state),
      );
      const view = visibleTo(audience, result.state);
      expect(view.scenes[IDS.scene]?.entities[IDS.otherIdentity]?.lastingAoE).toEqual({});
      expect(JSON.stringify(patches)).not.toContain('creatorIdentityId');
    }
    const audience = { kind: 'seat' as const, seatId: IDS.owner };
    expect(
      visibleTo(audience, result.state).scenes[IDS.scene]?.entities[IDS.otherIdentity]?.lastingAoE,
    ).toEqual({ creatorIdentityId: IDS.identity });
    const rebound = {
      ...result.state,
      seats: { ...result.state.seats, [IDS.owner]: { ...seat, identityId: IDS.otherIdentity } },
    };
    // The entity and scene references are deliberately shared with the cached former view.
    expect(
      visibleTo(audience, rebound).scenes[IDS.scene]?.entities[IDS.otherIdentity]?.lastingAoE,
    ).toEqual({});
  });
  it('gates spectator/mod/stale actors, interaction, view, scene measure and private/locked scenes', () => {
    for (const who of [
      ACTORS.otherSeat,
      ACTORS.spectator,
      { kind: 'mod' as const, modId: IDS.other },
    ])
      expect(canPerform(stateWithSource(), who, 'aoe.persist', payload)).toBe(false);
    for (const mutate of [
      (state: ReturnType<typeof stateWithSource>) => {
        const seat = state.seats[IDS.owner];
        if (seat) seat.interactionEnabled = false;
      },
      (state: ReturnType<typeof stateWithSource>) => {
        const seat = state.seats[IDS.owner];
        if (seat) seat.permissions.view = false;
      },
      (state: ReturnType<typeof stateWithSource>) => {
        const scene = state.scenes[IDS.scene];
        if (scene) scene.playerToggles = { measure: false };
      },
      (state: ReturnType<typeof stateWithSource>) => {
        const scene = state.scenes[IDS.scene];
        if (scene) scene.dmOnly = true;
      },
      (state: ReturnType<typeof stateWithSource>) => {
        const scene = state.scenes[IDS.scene];
        if (scene) scene.layers.effects = { locked: true };
      },
    ]) {
      const state = stateWithSource();
      mutate(state);
      expect(canPerform(state, actor, 'aoe.persist', payload)).toBe(false);
    }
    expect(
      canPerform(stateWithSource(), actor, 'aoe.persist', { ...payload, entityId: IDS.identity }),
    ).toBe(false);
    const state = stateWithSource(),
      scene = state.scenes[IDS.scene];
    if (!scene) throw new Error('missing scene');
    scene.entities[IDS.otherIdentity] = source();
    expect(canPerform(state, actor, 'aoe.persist', payload)).toBe(false);
  });
  it('protects the lasting marker and keeps admin-only props and private objects hidden', () => {
    const state = stateWithSource();
    const result = reduceAction(state, envelope());
    const lasting = result.state.scenes[IDS.scene]?.entities[IDS.otherIdentity];
    expect(lasting).toBeDefined();
    expect(
      canPerform(result.state, { ...actor, identityId: IDS.otherIdentity }, 'aoe.place', {
        sceneId: IDS.scene,
        entity: { ...source(), id: IDS.otherIdentity },
      }),
    ).toBe(false);
    expect(
      canPerform(result.state, actor, 'entity.update', {
        sceneId: IDS.scene,
        entityId: IDS.otherIdentity,
        changes: { lastingAoE: true },
      }),
    ).toBe(false);
    expect(
      canPerform(state, actor, 'entity.create', {
        sceneId: IDS.scene,
        entity: makeEntity(IDS.entity, { layer: 'props' }),
      }),
    ).toBe(false);
    const hidden = stateWithSource(),
      scene = hidden.scenes[IDS.scene];
    if (!scene) throw new Error('missing scene');
    scene.entities[IDS.identity] = { ...source(), layer: 'dm' };
    const after = reduceAction(hidden, envelope({ ...ACTORS.host, identityId: IDS.identity }));
    const audience = { kind: 'spectators' as const };
    const patches = patchesFor(audience, hidden, after.state, after.patches);
    expect(applyPatches(visibleTo(audience, hidden), patches)).toEqual(
      visibleTo(audience, after.state),
    );
    expect(JSON.stringify(patches)).not.toContain(IDS.otherIdentity);
  });
});
