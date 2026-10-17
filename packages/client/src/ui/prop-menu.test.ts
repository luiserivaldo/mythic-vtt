import { describe, expect, it } from 'vitest';
import { blankScene, Campaign, type Entity } from '@mythic/shared';
import { makeCampaign, tid } from '../testing.js';
import { PROP_DM_ONLY_REASON, propCollidableIntent, propCollidableModel } from './prop-menu.js';

describe('propCollidableIntent', () => {
  it('replaces the shape with walkable changed through entity.update', () => {
    const shape = { kind: 'box' as const, color: '#fff', walkable: true, showGridOnTop: true };
    expect(propCollidableIntent('s1', 'e1', shape, false)).toEqual({
      type: 'entity.update',
      payload: { sceneId: 's1', entityId: 'e1', changes: { shape: { ...shape, walkable: false } } },
      sceneId: 's1',
    });
  });
});

describe('propCollidableModel (MV-290)', () => {
  const PROP = tid(2);
  const SEAT = tid(3);
  const CODM = tid(4);
  const SCENE = tid(5);
  const shape = { kind: 'box' as const, color: '#888888', walkable: true };
  const seat = (id: string, role: 'player' | 'codm') => ({
    id,
    label: id,
    binding: 'persistent' as const,
    identityId: null,
    role,
    permissions: { view: true, move: true, edit: true, delete: true },
  });
  // The player owns the prop and it grants edit, so only the prop rule can deny them.
  const prop: Entity = {
    id: PROP,
    layer: 'props',
    name: 'Crate',
    owners: [SEAT],
    perms: { edit: true },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    shape,
  };
  const campaign = (): Campaign => {
    const base = makeCampaign();
    return Campaign.parse({
      ...base,
      seats: { [SEAT]: seat(SEAT, 'player'), [CODM]: seat(CODM, 'codm') },
      scenes: { [SCENE]: { ...blankScene(SCENE), entities: { [PROP]: prop } } },
      activeSceneId: SCENE,
    });
  };

  it('disables the toggle for a player seat with Edit, with the DM-only reason', () => {
    expect(propCollidableModel(campaign(), SCENE, prop, { kind: 'seat', seatId: SEAT })).toEqual({
      checked: true,
      enabled: false,
      reason: PROP_DM_ONLY_REASON,
    });
  });

  it('keeps it enabled for the host and a co-DM', () => {
    for (const actor of [{ kind: 'host' }, { kind: 'seat', seatId: CODM }] as const)
      expect(propCollidableModel(campaign(), SCENE, prop, actor)?.enabled).toBe(true);
  });
});
