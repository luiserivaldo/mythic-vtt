import { describe, expect, it } from 'vitest';
import { patchesFor } from '../visibility/index.js';
import type { ActionEnvelope } from './envelope.js';
import { reduceAction } from './run.js';
import { seatUpdate } from './seat.update.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';

const T = 'seat.update';
const payload = {
  seatId: IDS.owner,
  label: 'Wizard',
  binding: 'session' as const,
  role: 'codm' as const,
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
    expect(seatUpdate.schema.safeParse(payload).success).toBe(true);
  });
  it.each([
    ['no updates', { seatId: IDS.owner }],
    ['empty label', { seatId: IDS.owner, label: ' ' }],
    ['wrong role', { seatId: IDS.owner, role: 'host' }],
    ['bad id', { seatId: 'bad', label: 'x' }],
    ['extra junk', { ...payload, extra: true }],
  ])('rejects %s', (_name, candidate) => {
    expect(seatUpdate.schema.safeParse(candidate).success).toBe(false);
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
  it('rejects an unknown seat', () => {
    expect(permissionMatrix(makeCampaign(), T, { ...payload, seatId: IDS.entity }).host).toBe(
      false,
    );
  });
});

describe(`${T} reducer`, () => {
  it('updates only supplied fields and preserves the binding identity', () => {
    const before = makeCampaign();
    const seat = before.seats[IDS.owner];
    if (seat) seat.identityId = IDS.identity;
    const { state, inversePatches } = reduceAction(
      before,
      envelope({ seatId: IDS.owner, binding: 'session' }),
    );
    expect(state.seats[IDS.owner]).toMatchObject({
      label: 'Owner',
      binding: 'session',
      identityId: IDS.identity,
      role: 'player',
    });
    expect(inversePatches).toEqual([
      { op: 'replace', path: ['seats', IDS.owner, 'binding'], value: 'persistent' },
    ]);
  });
  it('updates label, binding and role together', () => {
    expect(reduceAction(makeCampaign(), envelope()).state.seats[IDS.owner]).toMatchObject({
      id: IDS.owner,
      label: 'Wizard',
      binding: 'session',
      role: 'codm',
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
    for (const audience of [{ kind: 'seat', seatId: IDS.other }, { kind: 'spectators' }] as const) {
      expect(JSON.stringify(patchesFor(audience, before, state, patches))).not.toContain(
        'SECRET-DM',
      );
    }
    // D32: the seat promoted to co-DM now receives the DM layer (and is sent it as an add).
    expect(
      JSON.stringify(patchesFor({ kind: 'seat', seatId: IDS.owner }, before, state, patches)),
    ).toContain('SECRET-DM');
  });
});
