import { describe, expect, it } from 'vitest';
import { IDS, makeCampaign, makeEntity, testId, ACTORS } from '../actions/testing.js';
import { reduceAction } from '../actions/run.js';
import type { ActionEnvelope } from '../actions/envelope.js';
import type { Campaign, DoorComponent, Entity } from '../schema/index.js';
import type { Audience } from './audience.js';
import { diffPatchesFor, patchesFor } from './patches-for.js';
import { viewEntity, visibleTo } from './visible-to.js';

// FOG-01 (MV-303 Q1/Q2a) / PERM-03: the only filtering this task adds.

const DOOR = testId(21);
const FOG = testId(23);
const points = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
];
const door = (d: DoorComponent): Entity =>
  makeEntity(DOOR, { layer: 'map', name: 'Panel', wall: { points, door: d } });
const fog = (): Entity =>
  makeEntity(FOG, {
    layer: 'dm',
    fogRegion: {
      points: [
        { x: 0, z: 0 },
        { x: 3, z: 0 },
        { x: 0, z: 3 },
      ],
      hidden: true,
    },
  });

const player: Audience = { kind: 'seat', seatId: IDS.owner };
const spectators: Audience = { kind: 'spectators' };
const coDm: Audience = { kind: 'seat', seatId: IDS.coDm };

describe('viewEntity: secret doors', () => {
  const state = makeCampaign();
  const seat = (audience: Audience) =>
    audience.kind === 'seat' ? state.seats[audience.seatId] : undefined;

  it.each([
    [{ state: 'closed', secret: true }, { points }],
    [{ state: 'locked', secret: true }, { points }],
    [
      { state: 'open', secret: true },
      { points, door: { state: 'open' } },
    ],
    [
      { state: 'closed', secret: false },
      { points, door: { state: 'closed' } },
    ],
    [{ state: 'locked' }, { points, door: { state: 'locked' } }],
  ] as const)('projects %j for players and spectators as %j', (d, expected) => {
    const entity = door(d);
    for (const audience of [player, spectators])
      expect(viewEntity(audience, entity, seat(audience))?.wall).toEqual(expected);
    // Host and co-DMs get it whole.
    expect(viewEntity({ kind: 'host' }, entity)).toBe(entity);
    expect(viewEntity(coDm, entity, seat(coDm))?.wall).toEqual({ points, door: d });
  });

  it('the memo never lets one audience view reach another, in either order', () => {
    const first = door({ state: 'closed', secret: true });
    expect(viewEntity(coDm, first, seat(coDm))?.wall?.door).toEqual({
      state: 'closed',
      secret: true,
    });
    expect(viewEntity(player, first, seat(player))?.wall).toEqual({ points });
    expect(viewEntity(spectators, first)?.wall).toEqual({ points });
    const second = door({ state: 'closed', secret: true });
    expect(viewEntity(spectators, second)?.wall).toEqual({ points });
    expect(viewEntity(player, second, seat(player))?.wall).toEqual({ points });
    expect(viewEntity(coDm, second, seat(coDm))?.wall?.door?.secret).toBe(true);
    // A co-DM seat that is archived is a spectator again.
    const archived = { ...state.seats[IDS.coDm], archived: true } as NonNullable<
      ReturnType<typeof seat>
    >;
    expect(viewEntity(coDm, second, archived)?.wall).toEqual({ points });
  });

  it('a fog region reaches only the host and co-DMs', () => {
    const entity = fog();
    expect(viewEntity(player, entity, seat(player))).toBeNull();
    expect(viewEntity(spectators, entity)).toBeNull();
    expect(viewEntity(coDm, entity, seat(coDm))).toBe(entity);
    expect(viewEntity({ kind: 'host' }, entity)).toBe(entity);
  });
});

describe('patchesFor fast path equals diffPatchesFor', () => {
  function table(): Campaign {
    const state = makeCampaign();
    const scene = state.scenes[IDS.scene];
    if (scene) {
      scene.entities[DOOR] = door({ state: 'closed', secret: true });
      scene.entities[FOG] = fog();
    }
    return state;
  }
  const run = (state: Campaign, type: string, payload: unknown) => {
    const envelope: ActionEnvelope = {
      id: IDS.action,
      type,
      payload,
      actor: ACTORS.host,
      campaignId: IDS.campaign,
      sessionId: IDS.session,
      seq: 1,
      ts: 1,
    };
    return reduceAction(state, envelope);
  };

  it.each([
    ['wall.setDoor open', 'wall.setDoor', { sceneId: IDS.scene, entityId: DOOR, state: 'open' }],
    ['wall.setDoor lock', 'wall.setDoor', { sceneId: IDS.scene, entityId: DOOR, state: 'locked' }],
    [
      'entity.update reveal the secret',
      'entity.update',
      {
        sceneId: IDS.scene,
        entityId: DOOR,
        changes: { wall: { points, door: { state: 'closed' } } },
      },
    ],
    [
      'entity.update move the wall',
      'entity.update',
      {
        sceneId: IDS.scene,
        entityId: DOOR,
        changes: {
          transform: {
            position: { x: 2, y: 0, z: 2 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      },
    ],
    [
      'entity.create a secret door',
      'entity.create',
      {
        sceneId: IDS.scene,
        entity: { ...door({ state: 'locked', secret: true }), id: testId(30) },
      },
    ],
    [
      'entity.create a fog region',
      'entity.create',
      { sceneId: IDS.scene, entity: { ...fog(), id: testId(31) } },
    ],
    [
      'entity.update hide a fog region',
      'entity.update',
      {
        sceneId: IDS.scene,
        entityId: FOG,
        changes: { fogRegion: { points: fog().fogRegion?.points, hidden: false } },
      },
    ],
    ['entity.delete the secret door', 'entity.delete', { sceneId: IDS.scene, entityId: DOOR }],
  ] as const)('%s', (_name, type, payload) => {
    const before = table();
    const result = run(before, type, payload);
    expect(result.patches.length).toBeGreaterThan(0);
    for (const audience of [player, spectators, coDm]) {
      const fast = patchesFor(audience, before, result.state, result.patches);
      expect(fast).toEqual(diffPatchesFor(audience, before, result.state));
      if (audience !== coDm) {
        expect(JSON.stringify(fast)).not.toContain('secret');
        expect(JSON.stringify(fast)).not.toContain('fogRegion');
        expect(JSON.stringify(visibleTo(audience, result.state))).not.toContain('secret');
        expect(JSON.stringify(visibleTo(audience, result.state))).not.toContain(FOG);
      }
    }
  });
});
