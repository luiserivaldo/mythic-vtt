import { describe, expect, it } from 'vitest';
import {
  checkIntent,
  reduceAction,
  visibleTo,
  type ActionEnvelope,
  type TokenStatusMarker,
} from '../index.js';
import { ACTORS, IDS, makeCampaign, makeEntity } from './testing.js';
const hidden: TokenStatusMarker[] = [{ kind: 'text', text: 'Secret curse' }];
const envelope: ActionEnvelope = {
  id: IDS.action,
  type: 'entity.update',
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 1,
  ts: 1000,
  payload: {},
};
describe('hidden marker preservation', () => {
  it.each(['dm', 'owner'] as const)(
    'blocks unreadable %s label marker edits through both action paths while allowing resize',
    (label) => {
      const state = makeCampaign();
      const player = state.seats[IDS.owner];
      if (!player) throw new Error('seat');
      player.permissions = { ...player.permissions, edit: true, move: true };
      const scene = state.scenes[IDS.scene];
      if (!scene) throw new Error('scene');
      scene.entities[IDS.entity] = makeEntity(IDS.entity, {
        owners: label === 'dm' ? [IDS.owner] : [],
        perms: { edit: true, move: true },
        token: { sizeCells: 1, heightCells: 1, labelVisibility: label, statusMarkers: hidden },
      });
      const client = visibleTo({ kind: 'seat', seatId: IDS.owner }, state),
        filtered = client.scenes[IDS.scene]?.entities[IDS.entity]?.token;
      if (!filtered) throw new Error('token');
      expect(filtered.statusMarkers).toBeUndefined();
      const markers = {
        sceneId: IDS.scene,
        entityId: IDS.entity,
        markers: [{ kind: 'icon', icon: 'blinded' }],
      };
      expect(checkIntent(state, ACTORS.owner, 'token.setStatusMarkers', markers)).toMatchObject({
        ok: false,
        reason: 'forbidden',
      });
      const resize = {
        sceneId: IDS.scene,
        entityId: IDS.entity,
        changes: { token: { ...filtered, sizeCells: 2 } },
      };
      expect(checkIntent(state, ACTORS.owner, 'entity.update', resize).ok).toBe(true);
      const resized = reduceAction(state, { ...envelope, payload: resize });
      expect(resized.state.scenes[IDS.scene]?.entities[IDS.entity]?.token).toMatchObject({
        sizeCells: 2,
        statusMarkers: hidden,
      });
      expect(resized).toEqual(reduceAction(state, { ...envelope, payload: resize }));
      expect(
        visibleTo({ kind: 'seat', seatId: IDS.owner }, resized.state).scenes[IDS.scene]?.entities[
          IDS.entity
        ]?.token?.statusMarkers,
      ).toBeUndefined();
      for (const statusMarkers of [[], markers.markers])
        expect(
          checkIntent(state, ACTORS.owner, 'entity.update', {
            ...resize,
            changes: { token: { ...filtered, statusMarkers } },
          }),
        ).toMatchObject({ ok: false, reason: 'forbidden' });
      expect(checkIntent(state, ACTORS.host, 'token.setStatusMarkers', markers).ok).toBe(true);
      expect(checkIntent(state, ACTORS.coDm, 'token.setStatusMarkers', markers).ok).toBe(true);
    },
  );
  it('allows a visible owner to edit/remove markers and preserves omitted markers for all actors', () => {
    const state = makeCampaign(),
      scene = state.scenes[IDS.scene],
      owner = state.seats[IDS.owner];
    if (!scene || !owner) throw new Error('fixture');
    owner.permissions = { ...owner.permissions, edit: true };
    scene.entities[IDS.entity] = makeEntity(IDS.entity, {
      owners: [IDS.owner],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'owner', statusMarkers: hidden },
    });
    const token = scene.entities[IDS.entity]?.token;
    if (!token) throw new Error('token');
    const withoutMarkers = { ...token };
    delete withoutMarkers.statusMarkers;
    const payload = {
      sceneId: IDS.scene,
      entityId: IDS.entity,
      changes: { token: { ...withoutMarkers, sizeCells: 2 } },
    };
    for (const actor of [ACTORS.owner, ACTORS.host, ACTORS.coDm])
      expect(
        reduceAction(state, { ...envelope, actor, payload }).state.scenes[IDS.scene]?.entities[
          IDS.entity
        ]?.token?.statusMarkers,
      ).toEqual(hidden);
    const clear = { sceneId: IDS.scene, entityId: IDS.entity, markers: [] };
    expect(checkIntent(state, ACTORS.owner, 'token.setStatusMarkers', clear).ok).toBe(true);
    expect(
      reduceAction(state, { ...envelope, type: 'token.setStatusMarkers', payload: clear }).state
        .scenes[IDS.scene]?.entities[IDS.entity]?.token?.statusMarkers,
    ).toEqual([]);
  });
});
