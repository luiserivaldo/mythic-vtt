import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { seatCreate } from './seat.create.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';

const T = 'seat.create';
const seatId = testId(20);
const payload = { seatId, label: 'Player 4', binding: 'session' as const, role: 'player' as const };
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

describe(`${T} schema`, () => {
  it('accepts a valid payload', () => {
    expect(seatCreate.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing label', { seatId }],
    ['empty label', { seatId, label: '  ' }],
    ['wrong binding', { seatId, label: 'P4', binding: 'forever' }],
    ['bad id', { seatId: 'bad', label: 'P4' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_name, candidate) => {
    expect(seatCreate.schema.safeParse(candidate).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows only the host', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
  });
  it('rejects an existing seat id', () => {
    expect(permissionMatrix(makeCampaign(), T, { ...payload, seatId: IDS.owner }).host).toBe(false);
  });
});

describe(`${T} reducer`, () => {
  it('creates an unoccupied seat with safe defaults', () => {
    const before = makeCampaign();
    const { state, inversePatches } = reduceAction(before, envelope());
    expect(state.seats[seatId]).toEqual({
      id: seatId,
      label: 'Player 4',
      binding: 'session',
      identityId: null,
      role: 'player',
      permissions: { view: true, move: true, edit: false, delete: false },
    });
    expect(before.seats[seatId]).toBeUndefined();
    expect(inversePatches).toEqual([{ op: 'remove', path: ['seats', seatId] }]);
  });

  it('uses the campaign binding and player role defaults', () => {
    const { state } = reduceAction(makeCampaign(), envelope({ seatId, label: 'Player 4' }));
    expect(state.seats[seatId]).toMatchObject({ binding: 'persistent', role: 'player' });
  });

  it('is deterministic', () => {
    expect(reduceAction(makeCampaign(), envelope())).toEqual(
      reduceAction(makeCampaign(), envelope()),
    );
  });
});

describe(`${T} visibility`, () => {
  it('does not expose DM-layer data', () => {
    const before = makeCampaign();
    const scene = before.scenes[IDS.scene];
    if (scene)
      scene.entities[IDS.otherIdentity] = makeEntity(IDS.otherIdentity, {
        layer: 'dm',
        name: 'SECRET-DM',
      });
    const { state, patches } = reduceAction(before, envelope());
    for (const audience of [{ kind: 'seat', seatId: IDS.owner }, { kind: 'spectators' }] as const) {
      expect(JSON.stringify(patchesFor(audience, before, state, patches))).not.toContain(
        'SECRET-DM',
      );
    }
  });
});
