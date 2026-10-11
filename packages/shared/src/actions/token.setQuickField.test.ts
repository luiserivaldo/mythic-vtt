import { expect, it } from 'vitest';
import { produce } from 'immer';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { reduceAction, canPerform } from './run.js';
import { QuickFields } from '../schema/index.js';
import { tokenSetQuickField } from './token.setQuickField.js';
import { visibleTo, patchesFor } from '../visibility/index.js';

const type = 'token.setQuickField';
const field = { value: 817263, visibility: 'owner' as const, color: '#aabbcc' };
const payload = { sceneId: IDS.scene, entityId: IDS.entity, fieldId: 'hp', field };
const envelope = {
  id: IDS.action,
  type,
  payload,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1,
};
function fixture() {
  return produce(makeCampaign(), (s) => {
    const scene = s.scenes[IDS.scene];
    const seat = s.seats[IDS.owner];
    if (seat) seat.permissions.edit = true;
    if (scene)
      scene.entities[IDS.entity] = makeEntity(IDS.entity, {
        owners: [IDS.owner],
        token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all', quickFields: { hp: field } },
      });
  });
}
const token = (state: ReturnType<typeof fixture>) =>
  state.scenes[IDS.scene]?.entities[IDS.entity]?.token;

it('validates finite values, bounded ids, colours, field count and strict payloads', () => {
  for (const value of [0, -1, 0.5, Number.MAX_VALUE])
    expect(
      tokenSetQuickField.schema.safeParse({ ...payload, field: { ...field, value } }).success,
    ).toBe(true);
  for (const value of [NaN, Infinity, -Infinity, '12'])
    expect(
      tokenSetQuickField.schema.safeParse({ ...payload, field: { ...field, value } }).success,
    ).toBe(false);
  for (const fieldId of ['', 'x'.repeat(33), '__proto__', 'constructor', 'prototype'])
    expect(tokenSetQuickField.schema.safeParse({ ...payload, fieldId }).success).toBe(false);
  expect(tokenSetQuickField.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
  expect(
    tokenSetQuickField.schema.safeParse({ ...payload, field: { ...field, extra: true } }).success,
  ).toBe(false);
  expect(
    tokenSetQuickField.schema.safeParse({ ...payload, field: { ...field, color: 'red' } }).success,
  ).toBe(false);
  expect(
    QuickFields.safeParse(
      Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${String(i)}`, field])),
    ).success,
  ).toBe(false);
});

it('allows editors to update visible values but reserves sharing, creation and deletion for admins', () => {
  const state = fixture();
  expect(permissionMatrix(state, type, payload)).toEqual({
    host: true,
    owner: true,
    otherSeat: false,
    coDm: true,
    spectator: false,
    mod: false,
  });
  for (const p of [
    { ...payload, field: null },
    { ...payload, fieldId: 'ac' },
    { ...payload, field: { ...field, visibility: 'all' } },
  ])
    expect(canPerform(state, ACTORS.owner, type, p)).toBe(false);
  const hidden = produce(state, (s) => {
    const t = token(s);
    if (t?.quickFields?.hp) t.quickFields.hp.visibility = 'dm';
  });
  expect(
    canPerform(hidden, ACTORS.owner, type, { ...payload, field: { ...field, visibility: 'dm' } }),
  ).toBe(false);
  const locked = produce(state, (s) => {
    const scene = s.scenes[IDS.scene];
    if (scene) scene.layers.tokens = { locked: true };
  });
  expect(canPerform(locked, ACTORS.host, type, payload)).toBe(false);
  expect(canPerform(makeCampaign(), ACTORS.host, type, payload)).toBe(false);
});

it('reduces deterministically and removes fields through the action pipeline', () => {
  const state = fixture();
  expect(reduceAction(state, envelope)).toEqual(reduceAction(state, envelope));
  const removed = reduceAction(state, { ...envelope, payload: { ...payload, field: null } }).state;
  expect(token(removed)?.quickFields).toEqual({});
  expect(token(state)?.quickFields?.hp).toEqual(field);
});

it('strips private values and colours from snapshots, updates and ownership revocation patches', () => {
  const state = fixture();
  const changed = reduceAction(state, {
    ...envelope,
    payload: { ...payload, field: { ...field, value: 918274 } },
  }).state;
  for (const audience of [
    { kind: 'seat' as const, seatId: IDS.other },
    { kind: 'spectators' as const },
  ]) {
    expect(JSON.stringify(visibleTo(audience, state))).not.toMatch(/817263|aabbcc/);
    expect(patchesFor(audience, state, changed)).toEqual([]);
  }
  for (const audience of [
    { kind: 'host' as const },
    { kind: 'seat' as const, seatId: IDS.owner },
    { kind: 'seat' as const, seatId: IDS.coDm },
  ])
    expect(JSON.stringify(visibleTo(audience, state))).toContain('817263');
  const revoked = produce(state, (s) => {
    const e = s.scenes[IDS.scene]?.entities[IDS.entity];
    if (e) e.owners = [];
  });
  const patches = patchesFor({ kind: 'seat', seatId: IDS.owner }, state, revoked);
  expect(JSON.stringify(patches)).not.toMatch(/817263|aabbcc/);
  expect(patches.some((p) => p.op === 'remove' && p.path.includes('hp'))).toBe(true);
});

it('preserves unseen fields during generic token edits and rejects field-edit bypasses', () => {
  const state = fixture();
  const publicToken = { sizeCells: 2, heightCells: 1, labelVisibility: 'all' as const };
  const p = { sceneId: IDS.scene, entityId: IDS.entity, changes: { token: publicToken } };
  expect(canPerform(state, ACTORS.owner, 'entity.update', p)).toBe(true);
  const after = reduceAction(state, { ...envelope, type: 'entity.update', payload: p }).state;
  expect(token(after)?.quickFields?.hp).toEqual(field);
  expect(
    canPerform(state, ACTORS.owner, 'entity.update', {
      ...p,
      changes: { token: { ...publicToken, quickFields: { hp: { ...field, value: 1 } } } },
    }),
  ).toBe(false);
});
