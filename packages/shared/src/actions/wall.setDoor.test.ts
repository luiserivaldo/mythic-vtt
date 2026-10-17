import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Campaign, DoorComponent } from '../schema/index.js';
import { diffPatchesFor, patchesFor, visibleTo } from '../visibility/index.js';
import type { Actor, ActionEnvelope } from './envelope.js';
import { canPerform, reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';
import { wallSetDoor } from './wall.setDoor.js';

const T = 'wall.setDoor';
const DOOR = IDS.entity;
const payload = (state: DoorComponent['state'] = 'open') => ({
  sceneId: IDS.scene,
  entityId: DOOR,
  state,
});
const envelope = (p: unknown, actor: Actor = ACTORS.host): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

function withDoor(door: DoorComponent | null = { state: 'closed' }, doorsTool = false) {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('scene');
  scene.entities[DOOR] = makeEntity(DOOR, {
    layer: 'map',
    // Ownership and every grant must not matter: doors follow the seat tool only.
    owners: [IDS.owner],
    perms: { move: true, edit: true, delete: true },
    wall: {
      points: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      ...(door ? { door } : {}),
    },
  });
  for (const id of [IDS.owner, IDS.other]) {
    const seat = state.seats[id];
    if (seat) seat.permissions = { view: true, move: true, edit: true, delete: true };
  }
  const owner = state.seats[IDS.owner];
  if (owner && doorsTool) owner.tools = { measure: true, draw: true, pins: true, doors: true };
  return state;
}

const doorOf = (state: Campaign) => state.scenes[IDS.scene]?.entities[DOOR]?.wall?.door;

describe(`${T} schema`, () => {
  it('accepts open, closed and locked; rejects anything else', () => {
    for (const s of ['open', 'closed', 'locked'] as const)
      expect(wallSetDoor.schema.safeParse(payload(s)).success).toBe(true);
    for (const bad of [
      { sceneId: IDS.scene, entityId: DOOR },
      { ...payload(), state: 'ajar' },
      { ...payload(), state: true },
      { sceneId: IDS.scene, entityId: DOOR, open: true },
      { ...payload(), secret: false },
      { ...payload(), entityId: 'nope' },
    ])
      expect(wallSetDoor.schema.safeParse(bad).success).toBe(false);
  });
});

describe(`${T} permissions (MV-303 Q1)`, () => {
  it('without the doors tool only the host and co-DM may toggle, whatever the player grants', () => {
    expect(permissionMatrix(withDoor(), T, payload())).toEqual({
      host: true,
      coDm: true,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
  });

  it('a seat with the doors tool may open and close an ordinary door, and nothing more', () => {
    expect(permissionMatrix(withDoor({ state: 'closed' }, true), T, payload('open'))).toEqual({
      host: true,
      coDm: true,
      owner: true,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    expect(canPerform(withDoor({ state: 'open' }, true), ACTORS.owner, T, payload('closed'))).toBe(
      true,
    );
    // Never lock or unlock.
    expect(
      canPerform(withDoor({ state: 'closed' }, true), ACTORS.owner, T, payload('locked')),
    ).toBe(false);
    expect(canPerform(withDoor({ state: 'open' }, true), ACTORS.owner, T, payload('locked'))).toBe(
      false,
    );
    expect(canPerform(withDoor({ state: 'locked' }, true), ACTORS.owner, T, payload('open'))).toBe(
      false,
    );
    expect(
      canPerform(withDoor({ state: 'locked' }, true), ACTORS.owner, T, payload('closed')),
    ).toBe(false);
    // Never touch a secret door, in any state.
    for (const state of ['open', 'closed'] as const) {
      const secret = withDoor({ state, secret: true }, true);
      const to = state === 'open' ? 'closed' : 'open';
      expect(canPerform(secret, ACTORS.owner, T, payload(to))).toBe(false);
      expect(canPerform(secret, ACTORS.host, T, payload(to))).toBe(true);
      expect(canPerform(secret, ACTORS.coDm, T, payload(to))).toBe(true);
    }
  });

  it('admins may set any state, including locking and unlocking secret doors', () => {
    for (const from of ['open', 'closed', 'locked'] as const)
      for (const to of ['open', 'closed', 'locked'] as const) {
        if (from === to) continue;
        for (const actor of [ACTORS.host, ACTORS.coDm])
          expect(canPerform(withDoor({ state: from, secret: true }), actor, T, payload(to))).toBe(
            true,
          );
      }
  });

  it('the tool is bound by the seat switches, the active scene and view permission', () => {
    const disabled = withDoor({ state: 'closed' }, true);
    const owner = disabled.seats[IDS.owner];
    if (owner) owner.interactionEnabled = false;
    expect(canPerform(disabled, ACTORS.owner, T, payload())).toBe(false);
    const blind = withDoor({ state: 'closed' }, true);
    const blindSeat = blind.seats[IDS.owner];
    if (blindSeat) blindSeat.permissions.view = false;
    expect(canPerform(blind, ACTORS.owner, T, payload())).toBe(false);
    const inactive = withDoor({ state: 'closed' }, true);
    inactive.activeSceneId = null;
    expect(canPerform(inactive, ACTORS.owner, T, payload())).toBe(false);
    expect(canPerform(inactive, ACTORS.host, T, payload())).toBe(true);
    const archived = withDoor({ state: 'closed' }, true);
    const archivedSeat = archived.seats[IDS.owner];
    if (archivedSeat) archivedSeat.archived = true;
    expect(canPerform(archived, ACTORS.owner, T, payload())).toBe(false);
  });

  it('rejects non-doors, missing entities, no-op changes and a locked map layer', () => {
    expect(canPerform(withDoor(null), ACTORS.host, T, payload())).toBe(false);
    const prop = withDoor();
    const scene = prop.scenes[IDS.scene];
    if (scene)
      scene.entities[DOOR] = makeEntity(DOOR, {
        layer: 'props',
        shape: { kind: 'box', color: '#888888', walkable: false },
      });
    expect(canPerform(prop, ACTORS.host, T, payload())).toBe(false);
    expect(canPerform(withDoor(), ACTORS.host, T, { ...payload(), entityId: testId(30) })).toBe(
      false,
    );
    expect(canPerform(withDoor({ state: 'open' }), ACTORS.host, T, payload('open'))).toBe(false);
    const locked = withDoor({ state: 'closed' }, true);
    const lockedScene = locked.scenes[IDS.scene];
    if (lockedScene) lockedScene.layers.map = { locked: true };
    for (const actor of [ACTORS.host, ACTORS.coDm, ACTORS.owner])
      expect(canPerform(locked, actor, T, payload())).toBe(false);
  });
});

describe(`${T} reducer, undo and visibility`, () => {
  it('sets only the door state, keeping secret and points', () => {
    const before = withDoor({ state: 'closed', secret: true });
    const { state, patches } = reduceAction(before, envelope(payload('locked')));
    expect(doorOf(state)).toEqual({ state: 'locked', secret: true });
    expect(state.scenes[IDS.scene]?.entities[DOOR]?.wall?.points).toHaveLength(2);
    expect(patches).toEqual([
      {
        op: 'replace',
        path: ['scenes', IDS.scene, 'entities', DOOR, 'wall', 'door', 'state'],
        value: 'locked',
      },
    ]);
    expect(doorOf(before)).toEqual({ state: 'closed', secret: true });
  });

  it('is deterministic and undoes through the ordinary inverse patches', () => {
    const before = withDoor({ state: 'closed' }, true);
    const e = envelope(payload('open'), ACTORS.owner);
    const result = reduceAction(before, e);
    expect(reduceAction(before, e)).toEqual(result);
    expect(applyPatches(result.state, result.inversePatches)).toEqual(before);
    const undo = reduceAction(result.state, {
      ...e,
      type: 'history.undo',
      payload: { targetSeqs: [1], patches: result.inversePatches },
    });
    expect(doorOf(undo.state)).toEqual({ state: 'closed' });
  });

  it('a player or spectator never sees a closed secret door, before or after any toggle', () => {
    let state = withDoor({ state: 'closed', secret: true });
    const audiences = [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const;
    const check = (s: Campaign) => {
      for (const audience of audiences) {
        const view = visibleTo(audience, s).scenes[IDS.scene]?.entities[DOOR];
        const door = doorOf(s);
        if (door?.state === 'open') expect(view?.wall?.door).toEqual({ state: 'open' });
        else
          expect(view?.wall).toEqual({ points: s.scenes[IDS.scene]?.entities[DOOR]?.wall?.points });
        expect(JSON.stringify(visibleTo(audience, s))).not.toContain('secret');
      }
    };
    check(state);
    for (const next of ['open', 'closed', 'locked', 'open', 'locked'] as const) {
      const result = reduceAction(state, envelope(payload(next)));
      for (const audience of audiences) {
        const patches = patchesFor(audience, state, result.state, result.patches);
        expect(patches).toEqual(diffPatchesFor(audience, state, result.state));
        expect(JSON.stringify(patches)).not.toContain('secret');
        if (next !== 'open' && doorOf(state)?.state !== 'open') expect(patches).toEqual([]);
      }
      // The co-DM sees the true state on every step.
      expect(
        visibleTo({ kind: 'seat', seatId: IDS.coDm }, result.state).scenes[IDS.scene]?.entities[
          DOOR
        ]?.wall?.door,
      ).toEqual({ state: next, secret: true });
      state = result.state;
      check(state);
    }
  });
});
