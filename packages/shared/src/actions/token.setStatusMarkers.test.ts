import { describe, expect, it } from 'vitest';
import { patchesFor, visibleTo } from '../visibility/index.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, makeEntity, permissionMatrix } from './testing.js';
import { tokenSetStatusMarkers } from './token.setStatusMarkers.js';
import type { ActionEnvelope } from './envelope.js';
import type { TokenStatusMarker } from '../schema/index.js';

const markers: TokenStatusMarker[] = [
  { kind: 'icon', icon: 'blinded' },
  { kind: 'text', text: 'Moon marked' },
];
const payload = { sceneId: IDS.scene, entityId: IDS.entity, markers };
const state = () => {
  const campaign = makeCampaign();
  const owner = campaign.seats[IDS.owner];
  if (owner) owner.permissions = { ...owner.permissions, edit: true };
  const scene = campaign.scenes[IDS.scene];
  if (scene)
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
  return campaign;
};
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'token.setStatusMarkers',
  payload,
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sceneId: IDS.scene,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
};

describe('token.setStatusMarkers', () => {
  it('validates strict icon/text entries, bounds, whitespace and duplicates', () => {
    expect(tokenSetStatusMarkers.schema.parse(payload)).toEqual(payload);
    expect(
      tokenSetStatusMarkers.schema.parse({
        ...payload,
        markers: [{ kind: 'text', text: '  Moon  ' }],
      }).markers,
    ).toEqual([{ kind: 'text', text: 'Moon' }]);
    for (const invalid of [
      [{ kind: 'icon', icon: 'unknown' }],
      [{ kind: 'text', text: '  ' }],
      [{ kind: 'text', text: 'x'.repeat(81) }],
      [{ kind: 'icon', icon: 'blinded', junk: true }],
      [markers[0], markers[0]],
      [
        { kind: 'text', text: 'Moon' },
        { kind: 'text', text: ' Moon ' },
      ],
      Array.from({ length: 33 }, (_, i) => ({ kind: 'text', text: String(i) })),
    ])
      expect(tokenSetStatusMarkers.schema.safeParse({ ...payload, markers: invalid }).success).toBe(
        false,
      );
    expect(tokenSetStatusMarkers.schema.safeParse({ ...payload, extra: true }).success).toBe(false);
    expect(
      tokenSetStatusMarkers.schema.safeParse({ sceneId: IDS.scene, entityId: IDS.entity }).success,
    ).toBe(false);
  });
  it('requires token edit rights, independently of move, and respects locked/DM layers', () => {
    const campaign = state();
    expect(permissionMatrix(campaign, envelope.type, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: false,
      coDm: true,
      spectator: false,
      mod: false,
    });
    const owner = campaign.seats[IDS.owner];
    if (owner) owner.permissions.move = false;
    expect(tokenSetStatusMarkers.permission(campaign, ACTORS.owner, payload)).toBe(true);
    if (owner) owner.permissions.edit = false;
    expect(tokenSetStatusMarkers.permission(campaign, ACTORS.owner, payload)).toBe(false);
    const other = campaign.seats[IDS.other];
    const entity = campaign.scenes[IDS.scene]?.entities[IDS.entity];
    if (other) other.permissions = { ...other.permissions, edit: true };
    if (entity) entity.perms = { edit: true };
    expect(tokenSetStatusMarkers.permission(campaign, ACTORS.otherSeat, payload)).toBe(true);
    if (entity) {
      entity.layer = 'dm';
      entity.perms = {};
    }
    expect(tokenSetStatusMarkers.permission(campaign, ACTORS.coDm, payload)).toBe(false);
    expect(tokenSetStatusMarkers.permission(campaign, ACTORS.otherSeat, payload)).toBe(false);
    const scene = campaign.scenes[IDS.scene];
    if (scene) scene.layers.dm = { locked: true };
    expect(tokenSetStatusMarkers.permission(campaign, ACTORS.host, payload)).toBe(false);
    expect(tokenSetStatusMarkers.permission(makeCampaign(), ACTORS.host, payload)).toBe(false);
  });
  it('sets and removes markers deterministically without mutating input', () => {
    const before = state();
    const result = reduceAction(before, envelope);
    expect(result).toEqual(reduceAction(before, envelope));
    expect(result.state.scenes[IDS.scene]?.entities[IDS.entity]?.token?.statusMarkers).toEqual(
      markers,
    );
    expect(before.scenes[IDS.scene]?.entities[IDS.entity]?.token?.statusMarkers).toBeUndefined();
    expect(
      reduceAction(result.state, { ...envelope, payload: { ...payload, markers: [] } }).state
        .scenes[IDS.scene]?.entities[IDS.entity]?.token?.statusMarkers,
    ).toEqual([]);
  });
  it.each(['all', 'owner', 'dm'] as const)(
    'filters markers according to %s label visibility',
    (labelVisibility) => {
      const campaign = state();
      const entity = campaign.scenes[IDS.scene]?.entities[IDS.entity];
      if (!entity?.token) throw new Error('missing token fixture');
      entity.name = ''; // An already blank name must not bypass the marker filter.
      entity.token.labelVisibility = labelVisibility;
      entity.token.statusMarkers = markers;
      const view = (audience: Parameters<typeof visibleTo>[0]) =>
        visibleTo(audience, campaign).scenes[IDS.scene]?.entities[IDS.entity]?.token?.statusMarkers;
      expect(view({ kind: 'host' })).toEqual(markers);
      expect(view({ kind: 'seat', seatId: IDS.coDm })).toEqual(markers);
      expect(view({ kind: 'seat', seatId: IDS.owner })).toEqual(
        labelVisibility === 'dm' ? undefined : markers,
      );
      expect(view({ kind: 'seat', seatId: IDS.other })).toEqual(
        labelVisibility === 'all' ? markers : undefined,
      );
      expect(view({ kind: 'spectators' })).toEqual(labelVisibility === 'all' ? markers : undefined);
      expect(entity.token.statusMarkers).toEqual(markers);
    },
  );
  it('removes owner-only markers when ownership changes without exposing their contents', () => {
    const before = state();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (!entity?.token) throw new Error('missing token fixture');
    entity.token.labelVisibility = 'owner';
    entity.token.statusMarkers = markers;
    const result = reduceAction(before, {
      ...envelope,
      actor: ACTORS.host,
      type: 'entity.setOwners',
      payload: { sceneId: IDS.scene, entityId: IDS.entity, owners: [IDS.other] },
    });
    const removal = patchesFor(
      { kind: 'seat', seatId: IDS.owner },
      before,
      result.state,
      result.patches,
    );
    expect(removal).toContainEqual({
      op: 'remove',
      path: ['scenes', IDS.scene, 'entities', IDS.entity, 'token', 'statusMarkers'],
    });
    expect(JSON.stringify(removal)).not.toContain('Moon marked');
    expect(
      JSON.stringify(
        patchesFor({ kind: 'seat', seatId: IDS.other }, before, result.state, result.patches),
      ),
    ).toContain('Moon marked');
  });
  it('omits hidden updates and emits removal/reveal patches when label visibility changes', () => {
    const before = state();
    const entity = before.scenes[IDS.scene]?.entities[IDS.entity];
    if (!entity?.token) throw new Error('missing token fixture');
    entity.token.labelVisibility = 'dm';
    const hidden = reduceAction(before, { ...envelope, actor: ACTORS.host });
    const audience = { kind: 'spectators' } as const;
    expect(patchesFor(audience, before, hidden.state, hidden.patches)).toEqual([]);
    const token = hidden.state.scenes[IDS.scene]?.entities[IDS.entity]?.token;
    const revealed = reduceAction(hidden.state, {
      ...envelope,
      actor: ACTORS.host,
      type: 'entity.update',
      payload: {
        sceneId: IDS.scene,
        entityId: IDS.entity,
        changes: { token: { ...token, labelVisibility: 'all' } },
      },
    });
    const reveal = patchesFor(audience, hidden.state, revealed.state, revealed.patches);
    expect(JSON.stringify(reveal)).toContain('Moon marked');
    const privateAgain = reduceAction(revealed.state, {
      ...envelope,
      actor: ACTORS.host,
      type: 'entity.update',
      payload: {
        sceneId: IDS.scene,
        entityId: IDS.entity,
        changes: { token: { ...token, labelVisibility: 'dm' } },
      },
    });
    const removal = patchesFor(audience, revealed.state, privateAgain.state, privateAgain.patches);
    expect(removal).toContainEqual({
      op: 'remove',
      path: ['scenes', IDS.scene, 'entities', IDS.entity, 'token', 'statusMarkers'],
    });
    expect(JSON.stringify(removal)).not.toContain('Moon marked');
    const dm = state();
    const dmEntity = dm.scenes[IDS.scene]?.entities[IDS.entity];
    if (dmEntity) dmEntity.layer = 'dm';
    const dmResult = reduceAction(dm, { ...envelope, actor: ACTORS.host });
    expect(patchesFor(audience, dm, dmResult.state, dmResult.patches)).toEqual([]);
  });
});
