import { describe, expect, it } from 'vitest';
import { IDS, makeCampaign, makeEntity, testId, ACTORS } from '../actions/testing.js';
import { reduceAction } from '../actions/run.js';
import type { ActionEnvelope } from '../actions/envelope.js';
import type { Campaign, DoorComponent, Entity } from '../schema/index.js';
import type { Audience } from './audience.js';
import { diffPatchesFor, patchesFor } from './patches-for.js';
import { viewEntity, visibleTo } from './visible-to.js';

// FOG-01 (D47 + MV-303) / PERM-03: the only projection this task adds. Secret doors are plain walls
// while closed, and wall and fog-region names are blank for players and spectators.

const DOOR = testId(21);
const FOG = testId(23);
const DOOR_NAME = 'Secret panel';
const FOG_NAME = 'Dragon lair';
const points = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
];
const regionPoints = [
  { x: 0, z: 0 },
  { x: 3, z: 0 },
  { x: 0, z: 3 },
];
const door = (d: DoorComponent): Entity =>
  makeEntity(DOOR, { layer: 'map', name: DOOR_NAME, wall: { points, door: d } });
const fog = (): Entity =>
  makeEntity(FOG, { layer: 'map', name: FOG_NAME, fogRegion: { points: regionPoints } });

const player: Audience = { kind: 'seat', seatId: IDS.owner };
const spectators: Audience = { kind: 'spectators' };
const coDm: Audience = { kind: 'seat', seatId: IDS.coDm };

describe('viewEntity: secret doors and vision names', () => {
  const state = makeCampaign();
  const seat = (audience: Audience) =>
    audience.kind === 'seat' ? state.seats[audience.seatId] : undefined;

  it.each([
    [{ open: false, secret: true }, { points }],
    [
      { open: true, secret: true },
      { points, door: { open: true } },
    ],
    [
      { open: false, secret: false },
      { points, door: { open: false } },
    ],
    [{ open: true }, { points, door: { open: true } }],
  ] as const)('projects %j for players and spectators as %j', (d, expected) => {
    const entity = door(d);
    for (const audience of [player, spectators]) {
      const view = viewEntity(audience, entity, seat(audience));
      expect(view?.wall).toEqual(expected);
      expect(view?.name).toBe('');
    }
    // Host and co-DMs get it whole.
    expect(viewEntity({ kind: 'host' }, entity)).toBe(entity);
    expect(viewEntity(coDm, entity, seat(coDm))).toEqual(entity);
  });

  it('a fog region reaches everyone on the map layer, with its name blank for non-admins', () => {
    const entity = fog();
    for (const audience of [player, spectators])
      expect(viewEntity(audience, entity, seat(audience))).toEqual({ ...entity, name: '' });
    expect(viewEntity(coDm, entity, seat(coDm))).toBe(entity);
    expect(viewEntity({ kind: 'host' }, entity)).toBe(entity);
  });

  it('a plain wall name is blank too; other map entities keep theirs', () => {
    const wall = makeEntity(testId(24), { layer: 'map', name: 'North wall', wall: { points } });
    expect(viewEntity(player, wall, seat(player))?.name).toBe('');
    const prop = makeEntity(testId(25), {
      layer: 'map',
      name: 'Altar',
      shape: { kind: 'box', color: '#888888', walkable: false },
    });
    expect(viewEntity(player, prop, seat(player))?.name).toBe('Altar');
  });

  it('the memo never lets one audience view reach another, in either order', () => {
    const first = door({ open: false, secret: true });
    expect(viewEntity(coDm, first, seat(coDm))).toEqual(first);
    expect(viewEntity(player, first, seat(player))).toEqual({
      ...first,
      name: '',
      wall: { points },
    });
    expect(viewEntity(spectators, first)).toEqual({ ...first, name: '', wall: { points } });
    const second = door({ open: false, secret: true });
    expect(viewEntity(spectators, second)?.wall).toEqual({ points });
    expect(viewEntity(player, second, seat(player))?.name).toBe('');
    expect(viewEntity(coDm, second, seat(coDm))).toEqual(second);
    const region = fog();
    expect(viewEntity(player, region, seat(player))?.name).toBe('');
    expect(viewEntity(coDm, region, seat(coDm))?.name).toBe(FOG_NAME);
    expect(viewEntity(spectators, region)?.name).toBe('');
    // A co-DM seat that is archived is a spectator again.
    const archived = { ...state.seats[IDS.coDm], archived: true } as NonNullable<
      ReturnType<typeof seat>
    >;
    expect(viewEntity(coDm, second, archived)).toEqual({ ...second, name: '', wall: { points } });
  });
});

describe('patchesFor fast path equals diffPatchesFor', () => {
  function table(): Campaign {
    const state = makeCampaign();
    const scene = state.scenes[IDS.scene];
    if (scene) {
      scene.entities[DOOR] = door({ open: false, secret: true });
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
    ['wall.setDoor open', 'wall.setDoor', { sceneId: IDS.scene, entityId: DOOR, open: true }],
    [
      'entity.update reveal the secret',
      'entity.update',
      {
        sceneId: IDS.scene,
        entityId: DOOR,
        changes: { wall: { points, door: { open: false } } },
      },
    ],
    [
      'entity.update rename the door',
      'entity.update',
      { sceneId: IDS.scene, entityId: DOOR, changes: { name: 'Hidden passage' } },
    ],
    [
      'entity.update rename the fog region',
      'entity.update',
      { sceneId: IDS.scene, entityId: FOG, changes: { name: 'Throne room' } },
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
        entity: { ...door({ open: false, secret: true }), id: testId(30) },
      },
    ],
    [
      'entity.create a fog region',
      'entity.create',
      { sceneId: IDS.scene, entity: { ...fog(), id: testId(31) } },
    ],
    [
      'entity.update reveal a fog region',
      'entity.update',
      {
        sceneId: IDS.scene,
        entityId: FOG,
        changes: { fogRegion: { points: regionPoints, revealed: true } },
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
        const all = JSON.stringify(fast) + JSON.stringify(visibleTo(audience, result.state));
        for (const secret of ['secret', DOOR_NAME, FOG_NAME, 'Hidden passage', 'Throne room'])
          expect(all).not.toContain(secret);
      }
    }
  });

  it('a toggle sequence keeps the fast path equal and a closed secret door doorless', () => {
    let state = table();
    for (const open of [true, false, true, false]) {
      const result = run(state, 'wall.setDoor', { sceneId: IDS.scene, entityId: DOOR, open });
      for (const audience of [player, spectators]) {
        const fast = patchesFor(audience, state, result.state, result.patches);
        expect(fast).toEqual(diffPatchesFor(audience, state, result.state));
        const view = visibleTo(audience, result.state).scenes[IDS.scene]?.entities[DOOR];
        expect(view?.wall).toEqual(open ? { points, door: { open: true } } : { points });
      }
      state = result.state;
    }
  });
});
