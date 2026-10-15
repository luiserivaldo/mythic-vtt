import { describe, expect, it } from 'vitest';
import { Entity, Scene, Seat, type LayerId } from '@mythic/shared';
import { tid } from '../testing.js';
import { mapScene } from './scene-model.js';
import {
  INACTIVE_LAYER_SHADE,
  focusedLayer,
  isOffFocus,
  layerShade,
  visibleEntities,
} from './layer-visibility.js';

function entity(n: number, layer: LayerId) {
  return Entity.parse({
    id: tid(n),
    layer,
    name: `E${String(n)}`,
    owners: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  });
}

const scene = Scene.parse({
  id: tid(9),
  name: 'Layers',
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'alternating',
    snap: true,
  },
  environment: { background: '#102030' },
  layers: {},
  entities: {
    [tid(1)]: entity(1, 'dm'),
    [tid(2)]: entity(2, 'tokens'),
    [tid(3)]: entity(3, 'props'),
  },
});

describe('visibleEntities', () => {
  const rendered = mapScene(scene);
  const ids = (hidden: LayerId[]) =>
    visibleEntities(rendered, scene, new Set(hidden)).map((e) => e.id);

  it('keeps everything when no layer is hidden', () => {
    expect(ids([])).toHaveLength(3);
  });
  it('drops entities on any hidden layer, not just DM only', () => {
    expect(ids(['dm']).sort()).toEqual([tid(2), tid(3)].sort());
    expect(ids(['tokens', 'props'])).toEqual([tid(1)]);
  });
});

describe('inactive layers (MV-244)', () => {
  const rendered = mapScene(scene);
  const dimmed = (focus: LayerId | null) =>
    visibleEntities(rendered, scene, new Set(), focus)
      .filter((e) => e.dimmed)
      .map((e) => e.id)
      .sort();

  it('marks every object off the focused layer, and nothing without a focus', () => {
    expect(dimmed('tokens')).toEqual([tid(1), tid(3)].sort());
    expect(dimmed('dm')).toEqual([tid(2), tid(3)].sort());
    expect(dimmed(null)).toEqual([]);
  });
  it('never marks the map layer, whatever layer is focused', () => {
    expect(isOffFocus('map', 'tokens')).toBe(false);
    expect(isOffFocus('map', 'dm')).toBe(false);
    expect(isOffFocus('props', 'tokens')).toBe(true);
    expect(isOffFocus('props', 'props')).toBe(false);
    expect(isOffFocus('props', null)).toBe(false);
    const withMap = { ...scene, entities: { ...scene.entities, [tid(4)]: entity(4, 'map') } };
    const marked = visibleEntities(mapScene(withMap), withMap, new Set(), 'tokens');
    expect(marked.find((e) => e.id === tid(4))?.dimmed).toBeUndefined();
  });
  it('still drops hidden layers before shading', () => {
    const ids = visibleEntities(rendered, scene, new Set<LayerId>(['dm']), 'tokens');
    expect(ids.map((e) => [e.id, e.dimmed ?? false])).toEqual(
      expect.arrayContaining([
        [tid(2), false],
        [tid(3), true],
      ]),
    );
    expect(ids).toHaveLength(2);
  });

  const seat = (role: 'player' | 'codm') =>
    Seat.parse({
      id: tid(20),
      label: 'Seat',
      binding: 'persistent',
      identityId: null,
      role,
      permissions: { view: true, move: true, edit: false, delete: false },
    });
  it('focuses the active layer for the host and co-DMs only', () => {
    expect(focusedLayer({ kind: 'host' }, 'map')).toBe('map');
    expect(focusedLayer({ kind: 'seat', seat: seat('codm') }, 'props')).toBe('props');
    expect(focusedLayer({ kind: 'seat', seat: seat('player') }, 'tokens')).toBeNull();
    expect(focusedLayer({ kind: 'spectator' }, 'tokens')).toBeNull();
  });

  it('darkens a colour by the shade factor and leaves active-layer colours alone', () => {
    expect(layerShade('#ffffff', false)).toBe('#ffffff');
    expect(layerShade('#ffffff', undefined)).toBe('#ffffff');
    const shaded = layerShade('#ffffff', true);
    expect(shaded).not.toBe('#ffffff');
    expect(shaded).toMatch(/^#[0-9a-f]{6}$/);
    expect(INACTIVE_LAYER_SHADE).toBeGreaterThan(0);
    expect(INACTIVE_LAYER_SHADE).toBeLessThan(1);
  });
});
