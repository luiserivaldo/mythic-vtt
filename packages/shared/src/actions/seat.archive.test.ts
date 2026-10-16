import { expect, it } from 'vitest';
import { Campaign, CURRENT_SCHEMA_VERSION, DEFAULT_SEAT_TOOLS } from '../schema/index.js';
import { storeMigrate } from '../migrations/index.js';
import { patchesFor, visibleTo } from '../visibility/index.js';
import { checkIntent, reduceAction } from './run.js';
import { seatArchive } from './seat.archive.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import type { ActionEnvelope } from './envelope.js';

const payload = { seatId: IDS.coDm };
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'seat.archive',
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};
const campaign = () => {
  const state = makeCampaign();
  const seat = state.seats[IDS.coDm];
  const scene = state.scenes[IDS.scene];
  if (!seat || !scene) throw new Error('fixture incomplete');
  seat.identityId = IDS.identity;
  seat.interactionEnabled = false;
  scene.entities[IDS.entity] = makeEntity(IDS.entity, {
    owners: [IDS.coDm],
    token: {
      sizeCells: 1,
      heightCells: 1,
      labelVisibility: 'all',
      characterInstanceId: IDS.otherIdentity,
    },
  });
  scene.entities[IDS.otherIdentity] = makeEntity(IDS.otherIdentity, {
    layer: 'dm',
    name: 'SECRET-DM',
    owners: [IDS.coDm, IDS.owner],
  });
  return state;
};
it('requires a strict seat id and permits only the host', () => {
  expect(seatArchive.schema.safeParse(payload).success).toBe(true);
  for (const candidate of [{}, { seatId: 'bad' }, { ...payload, junk: true }])
    expect(seatArchive.schema.safeParse(candidate).success).toBe(false);
  expect(permissionMatrix(campaign(), 'seat.archive', payload)).toEqual({
    host: true,
    owner: false,
    otherSeat: false,
    coDm: false,
    spectator: false,
    mod: false,
  });
});
it('archives deterministically without deleting tokens, character links or login history', () => {
  const before = campaign();
  const result = reduceAction(before, envelope);
  expect(result).toEqual(reduceAction(before, envelope));
  expect(result.state.seats[IDS.coDm]).toMatchObject({
    archived: true,
    identityId: IDS.identity,
    interactionEnabled: false,
  });
  expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]).toMatchObject({
    owners: [],
    token: { characterInstanceId: IDS.otherIdentity },
  });
  expect(result.state.scenes[IDS.scene]?.entities[IDS.otherIdentity]?.owners).toEqual([IDS.owner]);
  expect(before.seats[IDS.coDm]?.archived).toBeUndefined();
  expect(checkIntent(result.state, ACTORS.host, 'seat.archive', payload).ok).toBe(false);
  expect(Campaign.safeParse(result.state).success).toBe(true);
});
it('denies stale seat actions, joins, assignments and ownership but allows the login to claim another seat', () => {
  const after = reduceAction(campaign(), envelope).state;
  expect(
    checkIntent(after, ACTORS.host, 'seat.assign', { ...payload, identityId: IDS.identity }).ok,
  ).toBe(false);
  expect(
    checkIntent(after, ACTORS.host, 'session.join', { ...payload, identityId: IDS.identity }).ok,
  ).toBe(false);
  expect(checkIntent(after, ACTORS.coDm, 'seat.release', payload).ok).toBe(false);
  expect(
    checkIntent(after, ACTORS.host, 'entity.setOwners', {
      sceneId: IDS.scene,
      entityId: IDS.entity,
      owners: [IDS.coDm],
    }).ok,
  ).toBe(false);
  expect(
    checkIntent(after, { kind: 'seat', identityId: IDS.identity }, 'session.join', {
      seatId: IDS.other,
      identityId: IDS.identity,
    }).ok,
  ).toBe(true);
});
it('never sends archived seat data or DM data to player/spectator or stale co-DM views', () => {
  const before = campaign();
  const { state, patches } = reduceAction(before, envelope);
  for (const audience of [
    { kind: 'spectators' },
    { kind: 'seat', seatId: IDS.other },
    { kind: 'seat', seatId: IDS.coDm },
  ] as const) {
    const view = visibleTo(audience, state);
    expect(view.seats[IDS.coDm]).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('SECRET-DM');
    const wire = patchesFor(audience, before, state, patches);
    expect(wire.some((p) => p.op !== 'remove' && JSON.stringify(p).includes('SECRET-DM'))).toBe(
      false,
    );
    expect(wire.some((p) => p.op !== 'remove' && JSON.stringify(p).includes('archived'))).toBe(
      false,
    );
  }
});
it('migrates campaign and nested snapshots without losing historical seat data', () => {
  const state = { ...campaign(), schemaVersion: 6 };
  const before = structuredClone(state);
  expect(storeMigrate('campaign', 6, state)).toEqual({
    ...state,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });
  // UX-46 (v11): the snapshot also gains each seat's tools, folded from its scenes' defaults.
  expect(storeMigrate('snapshot', 6, { seq: 10, state })).toEqual({
    seq: 10,
    state: {
      ...state,
      seats: Object.fromEntries(
        Object.entries(state.seats).map(([id, seat]) => [
          id,
          { ...seat, tools: { ...DEFAULT_SEAT_TOOLS } },
        ]),
      ),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
  });
  expect(state).toEqual(before);
});
