import { describe, expect, it } from 'vitest';
import { canPerform } from './actions/run.js';
import { IDS, makeCampaign, makeEntity, testId } from './actions/testing.js';
import { visibleTo } from './visibility/index.js';
import { SEAT_TEMPLATES, seatTemplate } from './seat-templates.js';

describe('seat role templates (M1-44)', () => {
  it('defines the four adjustable presets on the existing role contract', () => {
    expect(SEAT_TEMPLATES.map((template) => template.id)).toEqual([
      'dm',
      'codm',
      'player',
      'spectator',
    ]);
    expect(seatTemplate('dm')).toMatchObject({ role: 'codm' });
    expect(seatTemplate('codm')).toMatchObject({ role: 'codm' });
    expect(seatTemplate('player')).toMatchObject({
      role: 'player',
      permissions: { view: true, move: true, edit: false, delete: false },
    });
    expect(seatTemplate('spectator')).toMatchObject({
      role: 'player',
      permissions: { view: true, move: false, edit: false, delete: false },
    });
  });

  it('keeps a seat-less spectator read-only and strips the DM layer', () => {
    const campaign = makeCampaign();
    const scene = campaign.scenes[IDS.scene];
    if (!scene) throw new Error('missing scene fixture');
    const publicEntity = makeEntity(IDS.entity, { layer: 'tokens', name: 'PUBLIC' });
    const secretEntity = makeEntity(IDS.otherIdentity, { layer: 'dm', name: 'SECRET-DM' });
    scene.entities[publicEntity.id] = publicEntity;
    scene.entities[secretEntity.id] = secretEntity;

    const spectator = { kind: 'seat' } as const;
    expect(
      canPerform(campaign, spectator, 'token.move', {
        sceneId: IDS.scene,
        entityId: publicEntity.id,
        to: { x: 1, y: 0, z: 1 },
      }),
    ).toBe(false);
    const view = visibleTo({ kind: 'spectators' }, campaign);
    expect(view.scenes[IDS.scene]?.entities[publicEntity.id]?.name).toBe('PUBLIC');
    expect(view.scenes[IDS.scene]?.entities[secretEntity.id]).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('SECRET-DM');
  });

  it('maps template roles to movement, prop creation and DM-layer visibility', () => {
    const campaign = makeCampaign();
    const ids = {
      dm: testId(20),
      codm: testId(21),
      player: testId(22),
      spectator: testId(23),
    } as const;
    for (const template of SEAT_TEMPLATES) {
      const id = ids[template.id];
      campaign.seats[id] = {
        id,
        label: template.label,
        binding: 'persistent',
        identityId: null,
        role: template.role,
        permissions: { ...template.permissions },
      };
    }
    const scene = campaign.scenes[IDS.scene];
    if (!scene) throw new Error('missing scene fixture');
    const ownedToken = makeEntity(IDS.entity, {
      owners: [ids.player, ids.spectator],
      token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
    });
    const secret = makeEntity(IDS.otherIdentity, { layer: 'dm', name: 'SECRET-DM' });
    scene.entities[ownedToken.id] = ownedToken;
    scene.entities[secret.id] = secret;
    const createdProp = makeEntity(testId(24), { layer: 'props' });
    const actor = (seatId: string) => ({ kind: 'seat' as const, seatId });

    for (const id of [ids.dm, ids.codm]) {
      expect(
        canPerform(campaign, actor(id), 'entity.create', {
          sceneId: IDS.scene,
          entity: createdProp,
        }),
      ).toBe(true);
      expect(
        visibleTo({ kind: 'seat', seatId: id }, campaign).scenes[IDS.scene]?.entities[secret.id],
      ).toBeDefined();
    }
    for (const id of [ids.player, ids.spectator]) {
      expect(
        canPerform(campaign, actor(id), 'entity.create', {
          sceneId: IDS.scene,
          entity: createdProp,
        }),
      ).toBe(false);
      expect(
        visibleTo({ kind: 'seat', seatId: id }, campaign).scenes[IDS.scene]?.entities[secret.id],
      ).toBeUndefined();
    }
    expect(
      canPerform(campaign, actor(ids.player), 'token.move', {
        sceneId: IDS.scene,
        entityId: ownedToken.id,
        to: { x: 1, y: 0, z: 1 },
      }),
    ).toBe(true);
    expect(
      canPerform(campaign, actor(ids.spectator), 'token.move', {
        sceneId: IDS.scene,
        entityId: ownedToken.id,
        to: { x: 1, y: 0, z: 1 },
      }),
    ).toBe(false);
  });
});
