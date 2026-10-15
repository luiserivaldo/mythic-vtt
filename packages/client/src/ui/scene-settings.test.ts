import { describe, expect, it } from 'vitest';
import type { Campaign, Entity, Scene } from '@mythic/shared';
import { makeCampaign, tid } from '../testing.js';
import { folderNames, sceneFolders, scenePreviewAsset } from './scene-list.js';
import { sceneSettingsIntents } from './scene-settings.js';

const scene = (n: number, name: string, extra: Partial<Scene> = {}): Scene => ({
  id: tid(n),
  name,
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'alternating',
    snap: true,
  },
  environment: { background: '#000000' },
  layers: {},
  entities: {},
  ...extra,
});

function campaign(...scenes: Scene[]): Campaign {
  return { ...makeCampaign(), scenes: Object.fromEntries(scenes.map((s) => [s.id, s])) };
}

describe('scene folders (UI-SCN-01)', () => {
  it('groups unfiled scenes first, then folders alphabetically, scenes sorted by name', () => {
    const c = campaign(
      scene(1, 'Tavern', { folder: 'Act 2' }),
      scene(2, 'Road'),
      scene(3, 'Crypt', { folder: 'Act 1' }),
      scene(4, 'Bridge', { folder: 'Act 2' }),
    );
    expect(sceneFolders(c).map((g) => [g.folder, g.rows.map((r) => r.name)])).toEqual([
      [null, ['Road']],
      ['Act 1', ['Crypt']],
      ['Act 2', ['Bridge', 'Tavern']],
    ]);
    expect(folderNames(c)).toEqual(['Act 1', 'Act 2']);
  });

  it('previews the first map-layer image and ignores token images', () => {
    const asset = (h: string) => ({ source: 'local', hash: h.repeat(64), kind: 'image' }) as const;
    const ent = (n: number, layer: Entity['layer'], h: string): Entity => ({
      id: tid(n),
      layer,
      name: 'x',
      owners: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      image: { asset: asset(h), calibrated: true },
    });
    expect(scenePreviewAsset(scene(1, 'Empty'))).toBeNull();
    const withMap = scene(1, 'Map', {
      entities: { [tid(10)]: ent(10, 'tokens', 'a'), [tid(11)]: ent(11, 'map', 'b') },
    });
    expect(scenePreviewAsset(withMap)).toEqual(asset('b'));
  });
});

describe('scene settings intents (UI-SCN-01)', () => {
  const base = scene(1, 'Cave', { folder: 'Act 1', bounds: { width: 20, height: 10 } });
  const draft = { name: 'Cave', folder: 'Act 1', bounds: { width: 20, height: 10 }, cellPx: 70 };

  it('sends nothing when nothing changed', () => {
    expect(sceneSettingsIntents(base, draft)).toEqual([]);
  });

  it('sends only the changed scene fields and the cell size separately', () => {
    expect(
      sceneSettingsIntents(base, {
        ...draft,
        name: ' Deep cave ',
        bounds: { width: 30, height: 10 },
        cellPx: 100,
      }),
    ).toEqual([
      {
        type: 'scene.update',
        payload: { sceneId: tid(1), name: 'Deep cave', bounds: { width: 30, height: 10 } },
        sceneId: tid(1),
      },
      { type: 'grid.update', payload: { sceneId: tid(1), sizePx: 100 }, sceneId: tid(1) },
    ]);
  });

  it('clears the folder with null and compares bounds against the 40 x 30 default', () => {
    expect(sceneSettingsIntents(base, { ...draft, folder: '  ' })[0]?.payload).toEqual({
      sceneId: tid(1),
      folder: null,
    });
    const unbounded = scene(2, 'Old');
    expect(
      sceneSettingsIntents(unbounded, {
        name: 'Old',
        folder: '',
        bounds: { width: 40, height: 30 },
        cellPx: 70,
      }),
    ).toEqual([]);
  });
});
