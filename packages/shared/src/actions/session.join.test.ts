import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { sessionJoin } from './session.join.js';
import { IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'session.join';
const payload = { seatId: IDS.owner, identityId: IDS.identity };
const joiningActor = { kind: 'seat', identityId: IDS.identity } as const;
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: joiningActor,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1_000,
});

describe(`${T} schema`, () => {
  it('accepts a valid payload', () => {
    expect(sessionJoin.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['missing identity', { seatId: IDS.owner }],
    ['wrong type', { seatId: IDS.owner, identityId: 3 }],
    ['bad seat id', { seatId: 'bad', identityId: IDS.identity }],
    ['bad identity id', { seatId: IDS.owner, identityId: 'bad' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_name, candidate) => {
    expect(sessionJoin.schema.safeParse(candidate).success).toBe(false);
  });
});

describe(`${T} permissions`, () => {
  it('allows the host but no standard non-host actor without the matching identity', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
  });
  it('allows an authenticated identity to claim an empty seat and rejoin its seat', () => {
    expect(sessionJoin.permission(makeCampaign(), joiningActor, payload)).toBe(true);
    const joined = makeCampaign();
    const seat = joined.seats[IDS.owner];
    if (seat) seat.identityId = IDS.identity;
    expect(sessionJoin.permission(joined, joiningActor, payload)).toBe(true);
  });
  it('rejects identity spoofing, occupied seats, and an identity in another seat', () => {
    expect(
      sessionJoin.permission(
        makeCampaign(),
        { ...joiningActor, identityId: IDS.otherIdentity },
        payload,
      ),
    ).toBe(false);
    const occupied = makeCampaign();
    const owner = occupied.seats[IDS.owner];
    if (owner) owner.identityId = IDS.otherIdentity;
    expect(sessionJoin.permission(occupied, joiningActor, payload)).toBe(false);
    const duplicate = makeCampaign();
    const other = duplicate.seats[IDS.other];
    if (other) other.identityId = IDS.identity;
    expect(sessionJoin.permission(duplicate, joiningActor, payload)).toBe(false);
  });
});

describe(`${T} co-DM seats (MV-269)`, () => {
  const coDmPayload = { seatId: IDS.coDm, identityId: IDS.identity };
  const withCoDm = (identityId: string | null, activeSceneId: string | null = IDS.scene) => {
    const state = makeCampaign();
    state.activeSceneId = activeSceneId;
    const seat = state.seats[IDS.coDm];
    if (seat) seat.identityId = identityId;
    return state;
  };
  it('refuses a self-claim of a free co-DM seat, with or without an active scene', () => {
    expect(sessionJoin.permission(withCoDm(null), joiningActor, coDmPayload)).toBe(false);
    expect(sessionJoin.permission(withCoDm(null, null), joiningActor, coDmPayload)).toBe(false);
  });
  it('lets the host seat anyone, and a granted identity rejoin its co-DM seat', () => {
    expect(sessionJoin.permission(withCoDm(null), { kind: 'host' }, coDmPayload)).toBe(true);
    expect(sessionJoin.permission(withCoDm(IDS.identity), joiningActor, coDmPayload)).toBe(true);
  });
  it('lets the holder rejoin its co-DM seat before a scene is active (MV-270)', () => {
    expect(sessionJoin.permission(withCoDm(IDS.identity, null), joiningActor, coDmPayload)).toBe(
      true,
    );
  });
  it('still refuses a visitor before a scene: a free co-DM seat or one held by someone else', () => {
    const visitor = { kind: 'seat', identityId: IDS.otherIdentity } as const;
    const visitorPayload = { seatId: IDS.coDm, identityId: IDS.otherIdentity };
    expect(sessionJoin.permission(withCoDm(null, null), visitor, visitorPayload)).toBe(false);
    expect(sessionJoin.permission(withCoDm(IDS.identity, null), visitor, visitorPayload)).toBe(
      false,
    );
    // The bypass is for a co-DM seat only: a player seat still waits for a scene.
    const player = makeCampaign();
    player.activeSceneId = null;
    const own = player.seats[IDS.owner];
    if (own) own.identityId = IDS.identity;
    expect(sessionJoin.permission(player, joiningActor, payload)).toBe(false);
  });
});

describe(`${T} reducer`, () => {
  it('binds the joining identity to either binding mode', () => {
    const persistent = reduceAction(makeCampaign(), envelope()).state;
    expect(persistent.seats[IDS.owner]).toMatchObject({
      binding: 'persistent',
      identityId: IDS.identity,
    });
    const sessionState = makeCampaign();
    const seat = sessionState.seats[IDS.owner];
    if (seat) seat.binding = 'session';
    expect(reduceAction(sessionState, envelope()).state.seats[IDS.owner]).toMatchObject({
      binding: 'session',
      identityId: IDS.identity,
    });
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
