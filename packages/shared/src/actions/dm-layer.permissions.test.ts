import { describe, expect, it } from 'vitest';
import { entityCreate } from './entity.create.js';
import { entityDelete } from './entity.delete.js';
import { entitySetLayer } from './entity.setLayer.js';
import { entitySetOwners } from './entity.setOwners.js';
import { entityUpdate } from './entity.update.js';
import { layerLock } from './layer.lock.js';
import { permissionUpdate } from './permission.update.js';
import { ACTORS, IDS, makeCampaign, makeEntity } from './testing.js';

// D32: co-DM seats are admins outside the DM layer but read-only on it unless granted.
const dmId = IDS.entity;
const stateWith = (entity: Parameters<typeof makeEntity>[1] = {}) => {
  const state = makeCampaign();
  const scene = state.scenes[IDS.scene];
  if (scene) scene.entities[dmId] = makeEntity(dmId, { layer: 'dm', ...entity });
  return state;
};
const base = { sceneId: IDS.scene, entityId: dmId };
const coDm = ACTORS.coDm;

describe('co-DM on the DM layer (D32)', () => {
  it('cannot edit, move, delete or re-layer DM-layer entities by default', () => {
    const s = stateWith();
    expect(entityUpdate.permission(s, coDm, { ...base, changes: { name: 'x' } })).toBe(false);
    expect(
      entityUpdate.permission(s, coDm, {
        ...base,
        changes: { transform: makeEntity(dmId).transform },
      }),
    ).toBe(false);
    expect(entityDelete.permission(s, coDm, base)).toBe(false);
    expect(entitySetLayer.permission(s, coDm, { ...base, layer: 'tokens' })).toBe(false);
  });

  it('cannot create there, lock it, move entities onto it, re-own or re-permission', () => {
    const s = stateWith();
    expect(
      entityCreate.permission(s, coDm, {
        sceneId: IDS.scene,
        entity: makeEntity(IDS.action, { layer: 'dm' }),
      }),
    ).toBe(false);
    expect(layerLock.permission(s, coDm, { sceneId: IDS.scene, layer: 'dm', locked: true })).toBe(
      false,
    );
    expect(entitySetOwners.permission(s, coDm, { ...base, owners: [IDS.coDm] })).toBe(false);
    expect(
      permissionUpdate.permission(s, coDm, {
        target: 'entity',
        ...base,
        permissions: { edit: true },
      }),
    ).toBe(false);
    const visible = stateWith({ layer: 'tokens' });
    expect(entitySetLayer.permission(visible, coDm, { ...base, layer: 'dm' })).toBe(false);
  });

  it('keeps full admin control outside the DM layer, and the host keeps everything', () => {
    const s = stateWith({ layer: 'tokens' });
    expect(entityUpdate.permission(s, coDm, { ...base, changes: { name: 'x' } })).toBe(true);
    expect(entityDelete.permission(s, coDm, base)).toBe(true);
    expect(
      layerLock.permission(s, coDm, { sceneId: IDS.scene, layer: 'tokens', locked: true }),
    ).toBe(true);
    const dm = stateWith();
    expect(entityUpdate.permission(dm, ACTORS.host, { ...base, changes: { name: 'x' } })).toBe(
      true,
    );
    expect(entitySetLayer.permission(dm, ACTORS.host, { ...base, layer: 'tokens' })).toBe(true);
  });

  it('can act when the entity grants the capability or they own it with the seat permission', () => {
    const granted = stateWith({ perms: { edit: true, delete: true, move: true } });
    expect(entityUpdate.permission(granted, coDm, { ...base, changes: { name: 'x' } })).toBe(true);
    expect(entityDelete.permission(granted, coDm, base)).toBe(true);
    expect(entitySetLayer.permission(granted, coDm, { ...base, layer: 'tokens' })).toBe(true);
    const owned = stateWith({ owners: [IDS.coDm] }); // test seats have move but not edit
    expect(entitySetLayer.permission(owned, coDm, { ...base, layer: 'tokens' })).toBe(true);
    expect(entityUpdate.permission(owned, coDm, { ...base, changes: { name: 'x' } })).toBe(false);
  });
});
