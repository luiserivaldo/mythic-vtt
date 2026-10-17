import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Campaign, DoorComponent } from '../schema/index.js';
import { diffPatchesFor, patchesFor, visibleTo } from '../visibility/index.js';
import type { Actor, ActionEnvelope } from './envelope.js';
import { canPerform, checkIntent, reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';
import { wallSetDoor } from './wall.setDoor.js';

const T = 'wall.setDoor';
const DOOR = IDS.entity;
const payload = (open = true) => ({ sceneId: IDS.scene, entityId: DOOR, open });
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

function withDoor(door: DoorComponent | null = { open: false }, interactTool = false) {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (!scene) throw new Error('scene');
  scene.entities[DOOR] = makeEntity(DOOR, {
    layer: 'map',
    // Ownership and every grant must not matter: doors follow the Interact permission only.
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
  if (owner && interactTool)
    owner.tools = { measure: true, draw: true, pins: true, interact: true };
  return state;
}

const doorOf = (state: Campaign) => state.scenes[IDS.scene]?.entities[DOOR]?.wall?.door;

describe(`${T} schema`, () => {
  it('accepts open true or false; rejects anything else', () => {
    for (const open of [true, false])
      expect(wallSetDoor.schema.safeParse(payload(open)).success).toBe(true);
    for (const bad of [
      { sceneId: IDS.scene, entityId: DOOR },
      { ...payload(), open: 'yes' },
      { sceneId: IDS.scene, entityId: DOOR, state: 'open' },
      { ...payload(), secret: false },
      { ...payload(), entityId: 'nope' },
    ])
      expect(wallSetDoor.schema.safeParse(bad).success).toBe(false);
  });
});

describe(`${T} permissions (D47 + MV-303)`, () => {
  it('without the interact permission only the host and co-DM may toggle, whatever the player grants', () => {
    expect(permissionMatrix(withDoor(), T, payload())).toEqual({
      host: true,
      coDm: true,
      owner: false,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
  });

  it('a seat with the interact permission may open and close a non-secret door', () => {
    expect(permissionMatrix(withDoor({ open: false }, true), T, payload(true))).toEqual({
      host: true,
      coDm: true,
      owner: true,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    expect(canPerform(withDoor({ open: true }, true), ACTORS.owner, T, payload(false))).toBe(true);
    expect(
      canPerform(withDoor({ open: false, secret: false }, true), ACTORS.owner, T, payload(true)),
    ).toBe(true);
  });

  it('a secret door is admin-only, open or closed', () => {
    for (const open of [true, false]) {
      const secret = withDoor({ open, secret: true }, true);
      expect(canPerform(secret, ACTORS.owner, T, payload(!open))).toBe(false);
      expect(canPerform(secret, ACTORS.host, T, payload(!open))).toBe(true);
      expect(canPerform(secret, ACTORS.coDm, T, payload(!open))).toBe(true);
    }
  });

  it('PERM-03: a player gets the same rejection for a secret door, a wall, a prop and an unknown id', () => {
    const secret = withDoor({ open: false, secret: true }, true);
    const wall = withDoor(null, true);
    const prop = withDoor(null, true);
    const propScene = prop.scenes[IDS.scene];
    if (propScene)
      propScene.entities[DOOR] = makeEntity(DOOR, {
        layer: 'props',
        shape: { kind: 'box', color: '#888888', walkable: false },
      });
    const unknown = withDoor({ open: false }, true);
    const results = [
      checkIntent(secret, ACTORS.owner, T, payload()),
      checkIntent(wall, ACTORS.owner, T, payload()),
      checkIntent(prop, ACTORS.owner, T, payload()),
      checkIntent(unknown, ACTORS.owner, T, { ...payload(), entityId: testId(30) }),
    ];
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]).toEqual({ ok: false, reason: 'forbidden' });
    // The same tool-holding seat may open an ordinary door, so the rejections above are the rule.
    expect(checkIntent(unknown, ACTORS.owner, T, payload()).ok).toBe(true);
  });

  it('the tool is bound by the seat switches, the active scene and view permission', () => {
    const disabled = withDoor({ open: false }, true);
    const owner = disabled.seats[IDS.owner];
    if (owner) owner.interactionEnabled = false;
    expect(canPerform(disabled, ACTORS.owner, T, payload())).toBe(false);
    const blind = withDoor({ open: false }, true);
    const blindSeat = blind.seats[IDS.owner];
    if (blindSeat) blindSeat.permissions.view = false;
    expect(canPerform(blind, ACTORS.owner, T, payload())).toBe(false);
    const inactive = withDoor({ open: false }, true);
    inactive.activeSceneId = null;
    expect(canPerform(inactive, ACTORS.owner, T, payload())).toBe(false);
    expect(canPerform(inactive, ACTORS.host, T, payload())).toBe(true);
    const archived = withDoor({ open: false }, true);
    const archivedSeat = archived.seats[IDS.owner];
    if (archivedSeat) archivedSeat.archived = true;
    expect(canPerform(archived, ACTORS.owner, T, payload())).toBe(false);
  });

  it('rejects non-doors, missing entities and no-op changes', () => {
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
    expect(canPerform(withDoor({ open: true }), ACTORS.host, T, payload(true))).toBe(false);
  });

  it('a locked map layer does not block a door, but still blocks moving or editing the wall', () => {
    const lock = (state: Campaign) => {
      const scene = state.scenes[IDS.scene];
      if (scene) scene.layers.map = { locked: true };
      return state;
    };
    // Opening a door is play state, not map editing.
    expect(permissionMatrix(lock(withDoor({ open: false }, true)), T, payload())).toEqual({
      host: true,
      coDm: true,
      owner: true,
      otherSeat: false,
      spectator: false,
      mod: false,
    });
    // Secret doors stay admin-only, with the same PERM-03 rejection.
    const secret = lock(withDoor({ open: false, secret: true }, true));
    expect(checkIntent(secret, ACTORS.owner, T, payload())).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(canPerform(secret, ACTORS.host, T, payload())).toBe(true);
    // Moving or editing the wall still follows the locked-layer rule, for everyone.
    const locked = lock(withDoor({ open: false }, true));
    const move = {
      sceneId: IDS.scene,
      entityId: DOOR,
      changes: {
        transform: {
          position: { x: 3, y: 0, z: 3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    };
    const edit = { sceneId: IDS.scene, entityId: DOOR, changes: { name: 'Gate' } };
    for (const actor of [ACTORS.host, ACTORS.coDm, ACTORS.owner]) {
      expect(canPerform(locked, actor, 'entity.update', move)).toBe(false);
      expect(canPerform(locked, actor, 'entity.update', edit)).toBe(false);
    }
    // Unlocked, the host may move and edit the same wall, so the lock is what rejects above.
    const unlocked = withDoor({ open: false }, true);
    expect(canPerform(unlocked, ACTORS.host, 'entity.update', move)).toBe(true);
    expect(canPerform(unlocked, ACTORS.host, 'entity.update', edit)).toBe(true);
    expect(canPerform(unlocked, ACTORS.owner, 'entity.update', move)).toBe(false);
  });
});

describe(`${T} reducer, undo and visibility`, () => {
  it('sets only the door flag, keeping secret and points', () => {
    const before = withDoor({ open: false, secret: true });
    const { state, patches } = reduceAction(before, envelope(payload(true)));
    expect(doorOf(state)).toEqual({ open: true, secret: true });
    expect(state.scenes[IDS.scene]?.entities[DOOR]?.wall?.points).toHaveLength(2);
    expect(patches).toEqual([
      {
        op: 'replace',
        path: ['scenes', IDS.scene, 'entities', DOOR, 'wall', 'door', 'open'],
        value: true,
      },
    ]);
    expect(doorOf(before)).toEqual({ open: false, secret: true });
  });

  it('is deterministic and undoes through the ordinary inverse patches', () => {
    const before = withDoor({ open: false }, true);
    const e = envelope(payload(true), ACTORS.owner);
    const result = reduceAction(before, e);
    expect(reduceAction(before, e)).toEqual(result);
    expect(applyPatches(result.state, result.inversePatches)).toEqual(before);
    const undo = reduceAction(result.state, {
      ...e,
      type: 'history.undo',
      payload: { targetSeqs: [1], patches: result.inversePatches },
    });
    expect(doorOf(undo.state)).toEqual({ open: false });
  });

  it('a player or spectator never sees a closed secret door, before or after any toggle', () => {
    let state = withDoor({ open: false, secret: true });
    const audiences = [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const;
    const check = (s: Campaign) => {
      for (const audience of audiences) {
        const view = visibleTo(audience, s).scenes[IDS.scene]?.entities[DOOR];
        if (doorOf(s)?.open) expect(view?.wall?.door).toEqual({ open: true });
        else
          expect(view?.wall).toEqual({ points: s.scenes[IDS.scene]?.entities[DOOR]?.wall?.points });
        expect(JSON.stringify(visibleTo(audience, s))).not.toContain('secret');
      }
    };
    check(state);
    for (const next of [true, false, true, false]) {
      const result = reduceAction(state, envelope(payload(next)));
      for (const audience of audiences) {
        const patches = patchesFor(audience, state, result.state, result.patches);
        expect(patches).toEqual(diffPatchesFor(audience, state, result.state));
        expect(JSON.stringify(patches)).not.toContain('secret');
      }
      // The co-DM sees the true state on every step.
      expect(
        visibleTo({ kind: 'seat', seatId: IDS.coDm }, result.state).scenes[IDS.scene]?.entities[
          DOOR
        ]?.wall?.door,
      ).toEqual({ open: next, secret: true });
      state = result.state;
      check(state);
    }
  });
});
