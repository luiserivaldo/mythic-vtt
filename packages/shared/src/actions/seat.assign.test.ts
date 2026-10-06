import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { seatAssign } from './seat.assign.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'seat.assign';
const payload = { seatId: IDS.owner, identityId: IDS.identity };
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
    expect(seatAssign.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing identity', { seatId: IDS.owner }],
    ['wrong type', { seatId: IDS.owner, identityId: 3 }],
    ['bad seat id', { seatId: 'bad', identityId: IDS.identity }],
    ['bad identity id', { seatId: IDS.owner, identityId: 'bad' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_name, candidate) => {
    expect(seatAssign.schema.safeParse(candidate).success).toBe(false);
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
  it('rejects an unknown or occupied target and duplicate identity occupancy', () => {
    const occupied = makeCampaign();
    const owner = occupied.seats[IDS.owner];
    if (owner) owner.identityId = IDS.otherIdentity;
    expect(permissionMatrix(occupied, T, payload).host).toBe(false);
    expect(permissionMatrix(makeCampaign(), T, { ...payload, seatId: IDS.entity }).host).toBe(
      false,
    );
    const duplicate = makeCampaign();
    const other = duplicate.seats[IDS.other];
    if (other) other.identityId = IDS.identity;
    expect(permissionMatrix(duplicate, T, payload).host).toBe(false);
  });
});

describe(`${T} reducer`, () => {
  it('assigns an identity and produces an inverse patch', () => {
    const before = makeCampaign();
    const { state, inversePatches } = reduceAction(before, envelope());
    expect(state.seats[IDS.owner]?.identityId).toBe(IDS.identity);
    expect(before.seats[IDS.owner]?.identityId).toBeNull();
    expect(inversePatches).toEqual([
      { op: 'replace', path: ['seats', IDS.owner, 'identityId'], value: null },
    ]);
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
