import type { Campaign, Entity, LayerId, Scene, Seat } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import type { SelectionActor } from '../tools/selection.js';
import { resolveActiveTab, visibleDockTabs } from './dock-tabs.js';
import { hierarchyGroups, type HierarchyView } from './hierarchy.js';
import { LAYER_ROWS } from './layer-panel.js';

const S = tid(2);
const CODM = tid(3);

const transform = {
  position: { x: 1, y: 0, z: 1 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};
const prop = (n: number, name: string, layer: LayerId = 'props'): Entity => ({
  id: tid(10 + n),
  name,
  layer,
  owners: [],
  transform,
  shape: { kind: 'box', color: '#808080', walkable: true },
});
const token = (n: number, name: string, layer: LayerId = 'tokens'): Entity => ({
  id: tid(10 + n),
  name,
  layer,
  owners: [],
  transform,
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
});

const codmSeat: Seat = {
  id: CODM,
  label: 'Co',
  binding: 'persistent',
  identityId: null,
  role: 'codm',
  permissions: { view: true, move: true, edit: true, delete: true },
};

function world(entities: Entity[], layers: Scene['layers'] = {}): [Campaign, Scene] {
  const scene = {
    id: S,
    name: 'Cave',
    grid: {
      type: 'square',
      sizePx: 70,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'alternating',
      snap: true,
    },
    environment: { background: '#000000' },
    layers,
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
  } as Scene;
  return [{ ...makeCampaign(), seats: { [CODM]: codmSeat }, scenes: { [S]: scene } }, scene];
}

const hostActor: SelectionActor = { kind: 'host' };
const view = (over: Partial<HierarchyView> = {}): HierarchyView => ({
  role: 'host',
  actor: hostActor,
  activeLayer: 'props',
  hiddenLayers: new Set(),
  ...over,
});

const rowOf = (groups: ReturnType<typeof hierarchyGroups>, name: string) => {
  const row = groups.flatMap((g) => g.rows).find((r) => r.name === name);
  if (!row) throw new Error(`no row ${name}`);
  return row;
};

describe('UI-ENT-01 (MV-245) object hierarchy model', () => {
  it('groups every object by layer in the Layers tab order, empty layers included', () => {
    const [campaign, scene] = world([
      prop(1, 'Crate'),
      token(2, 'Goblin'),
      token(3, 'Lurker', 'dm'),
      prop(4, 'Floor', 'map'),
    ]);
    const groups = hierarchyGroups(campaign, scene, view());
    expect(groups.map((g) => g.layer)).toEqual([...LAYER_ROWS]);
    expect(Object.fromEntries(groups.map((g) => [g.layer, g.rows.map((r) => r.name)]))).toEqual({
      map: ['Floor'],
      props: ['Crate'],
      tokens: ['Goblin'],
      dm: ['Lurker'],
      effects: [],
    });
    expect(rowOf(groups, 'Crate')).toMatchObject({ kind: 'Box', prop: true });
    expect(rowOf(groups, 'Goblin')).toMatchObject({ kind: 'Token', prop: false });
  });

  it('orders rows by name, then id, inside a group', () => {
    const [campaign, scene] = world([prop(1, 'b'), prop(3, 'a'), prop(2, 'b')]);
    const props = hierarchyGroups(campaign, scene, view()).find((g) => g.layer === 'props');
    expect(props?.rows.map((r) => r.id)).toEqual([tid(13), tid(11), tid(12)]);
  });

  it('marks the active, locked and hidden layers on their group', () => {
    const [campaign, scene] = world([], { tokens: { locked: true } });
    const groups = hierarchyGroups(campaign, scene, view({ hiddenLayers: new Set(['effects']) }));
    const by = (layer: LayerId) => groups.find((g) => g.layer === layer);
    expect(by('props')).toMatchObject({ active: true, locked: false, hidden: false });
    expect(by('tokens')).toMatchObject({ active: false, locked: true });
    expect(by('effects')).toMatchObject({ hidden: true });
  });

  it('MV-258: rows off the active layer are dimmed and not selectable; the map layer is exempt', () => {
    const [campaign, scene] = world([
      prop(1, 'Crate'),
      token(2, 'Goblin'),
      prop(4, 'Floor', 'map'),
    ]);
    const groups = hierarchyGroups(campaign, scene, view({ activeLayer: 'props' }));
    expect(rowOf(groups, 'Crate')).toMatchObject({ dimmed: false, selectable: true, reason: null });
    expect(rowOf(groups, 'Goblin')).toMatchObject({
      dimmed: true,
      selectable: false,
      reason: 'Tokens is not the active layer',
    });
    expect(rowOf(groups, 'Floor')).toMatchObject({ dimmed: false, selectable: true });

    const onTokens = hierarchyGroups(campaign, scene, view({ activeLayer: 'tokens' }));
    expect(rowOf(onTokens, 'Crate')).toMatchObject({ dimmed: true, selectable: false });
    expect(rowOf(onTokens, 'Goblin')).toMatchObject({ dimmed: false, selectable: true });
  });

  it('rows on a hidden or locked layer cannot be selected, as on the board', () => {
    const [campaign, scene] = world([prop(1, 'Crate'), prop(4, 'Floor', 'map')], {
      props: { locked: true },
    });
    const groups = hierarchyGroups(campaign, scene, view({ hiddenLayers: new Set(['map']) }));
    expect(rowOf(groups, 'Crate')).toMatchObject({
      dimmed: false,
      selectable: false,
      reason: 'Props is locked',
    });
    expect(rowOf(groups, 'Floor')).toMatchObject({
      dimmed: true,
      selectable: false,
      reason: 'Map is hidden',
    });
  });

  it('LAY-04: a non-admin role is never given the DM layer group', () => {
    const [campaign, scene] = world([token(3, 'Lurker', 'dm')]);
    const groups = hierarchyGroups(campaign, scene, view({ role: 'player' }));
    expect(groups.some((g) => g.layer === 'dm')).toBe(false);
    expect(groups.flatMap((g) => g.rows)).toEqual([]);
    const codm = hierarchyGroups(
      campaign,
      scene,
      view({ role: 'codm', actor: { kind: 'seat', seat: codmSeat }, activeLayer: 'dm' }),
    );
    expect(rowOf(codm, 'Lurker')).toMatchObject({ selectable: true });
  });
});

describe('C16: the Hierarchy dock tab', () => {
  it('is offered to the host and co-DM in 3D only, never to players or spectators', () => {
    const has = (role: Parameters<typeof visibleDockTabs>[0], mode: '2d' | '3d') =>
      visibleDockTabs(role, null, mode).some((tab) => tab.id === 'hierarchy');
    expect(has('host', '3d')).toBe(true);
    expect(has('codm', '3d')).toBe(true);
    for (const role of ['host', 'codm', 'player', 'observer'] as const)
      expect(has(role, '2d')).toBe(false);
    for (const role of ['player', 'observer'] as const) expect(has(role, '3d')).toBe(false);
  });

  it('falls back to Chat when the view returns to 2D, and back again in 3D', () => {
    expect(resolveActiveTab('host', null, 'hierarchy', '3d')).toBe('hierarchy');
    expect(resolveActiveTab('host', null, 'hierarchy', '2d')).toBe('chat');
    expect(resolveActiveTab('player', null, 'hierarchy', '3d')).toBe('chat');
  });
});
