import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { seatRelease } from './seat.release.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'seat.release';
const payload = { seatId: IDS.owner };
const occupiedCampaign = () => {
  const state = makeCampaign();
  const seat = state.seats[IDS.owner];
  if (seat) seat.identityId = IDS.identity;
  return state;
};
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
    expect(seatRelease.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing seat', {}],
    ['wrong type', { seatId: 3 }],
    ['bad id', { seatId: 'bad' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_name, candidate) => {
    expect(seatRelease.schema.safeParse(candidate).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows the host and occupying seat', () => {
    expect(permissionMatrix(occupiedCampaign(), T, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
  });
  it('rejects an empty or unknown seat', () => {
    expect(permissionMatrix(makeCampaign(), T, payload).host).toBe(false);
    expect(permissionMatrix(occupiedCampaign(), T, { seatId: IDS.entity }).host).toBe(false);
  });
});

describe(`${T} reducer`, () => {
  it('clears the identity while retaining binding mode', () => {
    const before = occupiedCampaign();
    const { state, inversePatches } = reduceAction(before, envelope());
    expect(state.seats[IDS.owner]).toMatchObject({ identityId: null, binding: 'persistent' });
    expect(inversePatches).toEqual([
      { op: 'replace', path: ['seats', IDS.owner, 'identityId'], value: IDS.identity },
    ]);
  });
  it('is deterministic', () => {
    expect(reduceAction(occupiedCampaign(), envelope())).toEqual(
      reduceAction(occupiedCampaign(), envelope()),
    );
  });
});

describe(`${T} visibility`, () => {
  it('does not expose DM-layer data', () => {
    const before = occupiedCampaign();
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
