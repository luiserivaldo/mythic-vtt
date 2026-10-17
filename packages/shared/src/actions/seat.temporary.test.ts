import { describe, expect, it } from 'vitest';
import { Campaign } from '../schema/index.js';
import { patchesFor, visibleTo } from '../visibility/index.js';
import { checkIntent, reduceAction } from './run.js';
import { seatDiscardTemporary } from './seat.discardTemporary.js';
import { seatJoinTemporary } from './seat.joinTemporary.js';
import { MAX_TEMPORARY_SEATS, withoutTemporarySeats } from './temporary-seats.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix, testId } from './testing.js';
import type { ActionEnvelope, Actor } from './envelope.js';

const NEW_SEAT = testId(20);
const joiner: Actor = { kind: 'seat', identityId: IDS.identity };
const join = { seatId: NEW_SEAT, identityId: IDS.identity, label: 'Visiting Bard' };
const envelope = (type: string, payload: unknown, actor: Actor): ActionEnvelope => ({
  id: IDS.action,
  type,
  payload,
  actor,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
});

describe('seat.joinTemporary', () => {
  it('validates strictly', () => {
    expect(seatJoinTemporary.schema.safeParse(join).success).toBe(true);
    for (const bad of [
      {},
      { ...join, label: '   ' },
      { ...join, label: 'x'.repeat(81) },
      { ...join, seatId: 'bad' },
      { ...join, junk: true },
      { seatId: NEW_SEAT, identityId: IDS.identity },
    ])
      expect(seatJoinTemporary.schema.safeParse(bad).success).toBe(false);
  });

  it('lets only the unseated identity itself create the seat', () => {
    const state = makeCampaign();
    expect(permissionMatrix(state, 'seat.joinTemporary', join)).toEqual({
      host: false,
      owner: false,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
    expect(checkIntent(state, joiner, 'seat.joinTemporary', join).ok).toBe(true);
    // Someone else's identity, or a seated actor, cannot make one for it.
    expect(
      checkIntent(
        state,
        { kind: 'seat', identityId: IDS.otherIdentity },
        'seat.joinTemporary',
        join,
      ).ok,
    ).toBe(false);
    expect(
      checkIntent(state, { ...joiner, seatId: IDS.owner }, 'seat.joinTemporary', join).ok,
    ).toBe(false);
  });

  it('needs an active scene, a free seat id and an identity without a seat', () => {
    const noScene = { ...makeCampaign(), activeSceneId: null };
    expect(checkIntent(noScene, joiner, 'seat.joinTemporary', join).ok).toBe(false);
    const taken = makeCampaign();
    expect(
      checkIntent(taken, joiner, 'seat.joinTemporary', { ...join, seatId: IDS.owner }).ok,
    ).toBe(false);
    const seated = makeCampaign();
    const seat = seated.seats[IDS.owner];
    if (seat) seat.identityId = IDS.identity;
    expect(checkIntent(seated, joiner, 'seat.joinTemporary', join).ok).toBe(false);
  });

  it('caps the number of temporary seats', () => {
    let state = makeCampaign();
    for (let i = 0; i < MAX_TEMPORARY_SEATS; i += 1) {
      const suffix = '0123456789ABCDEF'.charAt(i);
      const identityId = `1${'0'.repeat(24)}${suffix}`;
      const payload = {
        seatId: `2${'0'.repeat(24)}${suffix}`,
        identityId,
        label: `Guest ${suffix}`,
      };
      const actor: Actor = { kind: 'seat', identityId };
      expect(checkIntent(state, actor, 'seat.joinTemporary', payload).ok).toBe(true);
      state = reduceAction(state, envelope('seat.joinTemporary', payload, actor)).state;
    }
    expect(checkIntent(state, joiner, 'seat.joinTemporary', join).ok).toBe(false);
  });

  it('creates a bound, session-only player seat deterministically', () => {
    const before = makeCampaign();
    const e = envelope('seat.joinTemporary', join, joiner);
    const result = reduceAction(before, e);
    expect(result).toEqual(reduceAction(before, e));
    expect(result.state.seats[NEW_SEAT]).toEqual({
      id: NEW_SEAT,
      label: 'Visiting Bard',
      binding: 'session',
      identityId: IDS.identity,
      role: 'player',
      interactionEnabled: true,
      permissions: { view: true, move: true, edit: false, delete: false },
      tools: { measure: true, draw: true, pins: true, interact: false },
      temporary: true,
    });
    expect(Campaign.safeParse(result.state).success).toBe(true);
    expect(before.seats[NEW_SEAT]).toBeUndefined();
  });
});

describe('seat.discardTemporary and withoutTemporarySeats', () => {
  const withTemporary = () => {
    const base = makeCampaign();
    const scene = base.scenes[IDS.scene];
    if (!scene) throw new Error('fixture');
    // The DM makes a token for the temporary seat from the Seats tab.
    scene.entities[IDS.entity] = makeEntity(IDS.entity, { owners: [NEW_SEAT, IDS.owner] });
    return reduceAction(base, envelope('seat.joinTemporary', join, joiner)).state;
  };

  it('is host only and only for temporary seats', () => {
    const state = withTemporary();
    expect(permissionMatrix(state, 'seat.discardTemporary', { seatId: NEW_SEAT })).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: false,
      spectator: false,
      mod: false,
    });
    expect(seatDiscardTemporary.schema.safeParse({ seatId: NEW_SEAT, junk: 1 }).success).toBe(
      false,
    );
    expect(checkIntent(state, ACTORS.host, 'seat.discardTemporary', { seatId: IDS.owner }).ok).toBe(
      false,
    );
    // A temporary seat is never archived into the saved file.
    expect(checkIntent(state, ACTORS.host, 'seat.archive', { seatId: NEW_SEAT }).ok).toBe(false);
  });

  it('removes the seat and its ownership but keeps the token', () => {
    const state = withTemporary();
    const e = envelope('seat.discardTemporary', { seatId: NEW_SEAT }, ACTORS.host);
    const result = reduceAction(state, e);
    expect(result).toEqual(reduceAction(state, e));
    expect(result.state.seats[NEW_SEAT]).toBeUndefined();
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.owners).toEqual([IDS.owner]);
  });

  it('drops every temporary seat from a state that is about to be saved', () => {
    const state = withTemporary();
    const saved = withoutTemporarySeats(state);
    expect(JSON.stringify(saved)).not.toContain('Visiting Bard');
    expect(JSON.stringify(saved)).not.toContain(NEW_SEAT);
    expect(Object.keys(saved.seats).sort()).toEqual(Object.keys(makeCampaign().seats).sort());
    expect(saved.scenes[IDS.scene]?.entities[IDS.entity]?.owners).toEqual([IDS.owner]);
    const plain = makeCampaign();
    expect(withoutTemporarySeats(plain)).toBe(plain);
    expect(state.seats[NEW_SEAT]).toBeDefined();
  });
});

describe('temporary seats and audiences (PERM-03)', () => {
  it('shows the seat label to players but hides who holds it from spectators', () => {
    const state = reduceAction(makeCampaign(), envelope('seat.joinTemporary', join, joiner)).state;
    const spectators = visibleTo({ kind: 'spectators' }, state);
    const seen = spectators.seats[NEW_SEAT];
    expect(seen?.label).toBe('Visiting Bard');
    // "taken" survives, the identity does not.
    expect(seen?.identityId).not.toBeNull();
    expect(JSON.stringify(spectators)).not.toContain(IDS.identity);
    expect(visibleTo({ kind: 'host' }, state).seats[NEW_SEAT]?.identityId).toBe(IDS.identity);
  });

  it('keeps the identity out of the patch a spectator receives when a seat is claimed', () => {
    const before = makeCampaign();
    const e = envelope('seat.joinTemporary', join, joiner);
    const { state: after, patches } = reduceAction(before, e);
    const forSpectators = patchesFor({ kind: 'spectators' }, before, after, patches);
    expect(JSON.stringify(forSpectators)).toContain('Visiting Bard');
    expect(JSON.stringify(forSpectators)).not.toContain(IDS.identity);
  });
});
