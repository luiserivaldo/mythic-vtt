import { Entity, Scene } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import { mapCalibrateIntent, mapPlaceIntent, mapRows } from './map-panel.js';

const hash = 'd'.repeat(64);
const place = mapPlaceIntent({
  sceneId: tid(1),
  entityId: tid(2),
  name: 'Crypt',
  hash,
  heightPx: 1400,
});

describe('map panel intents', () => {
  it('places an uncalibrated image on the map layer using a valid entity', () => {
    const payload = place.payload as { sceneId: string; entity: unknown };
    const entity = Entity.parse(payload.entity);
    expect(place.type).toBe('entity.create');
    expect(entity).toMatchObject({ layer: 'map', image: { calibrated: false } });
    expect(entity.transform.scale).toEqual({ x: 20, y: 20, z: 20 });
  });

  it('commits calibration as one entity.update with transform and calibrated flag', () => {
    const entity = Entity.parse((place.payload as { entity: unknown }).entity);
    const spec = mapCalibrateIntent({
      sceneId: tid(1),
      entity,
      scale: 4,
      position: { x: 1, y: 0, z: 2 },
    });
    expect(spec).toMatchObject({
      type: 'entity.update',
      payload: {
        entityId: tid(2),
        changes: {
          transform: { position: { x: 1, y: 0, z: 2 }, scale: { x: 4, y: 4, z: 4 } },
          image: { calibrated: true },
        },
      },
    });
  });

  it('refuses to calibrate an entity without an image', () => {
    const entity = Entity.parse({
      ...(place.payload as { entity: object }).entity,
      image: undefined,
    });
    expect(
      mapCalibrateIntent({ sceneId: tid(1), entity, scale: 1, position: { x: 0, y: 0, z: 0 } }),
    ).toBeNull();
  });

  it('lists only map-layer entities that have an image', () => {
    const mapEntity = Entity.parse((place.payload as { entity: unknown }).entity);
    const scene = Scene.parse({
      id: tid(1),
      name: 'S',
      grid: {
        type: 'square',
        sizePx: 70,
        unitsPerCell: 5,
        unitLabel: 'ft',
        diagonal: 'chebyshev',
        snap: true,
      },
      environment: { background: '#000000' },
      layers: {},
      entities: {
        [mapEntity.id]: mapEntity,
        [tid(3)]: { ...mapEntity, id: tid(3), layer: 'props', name: 'Not a map' },
        [tid(4)]: { ...mapEntity, id: tid(4), name: 'Bare map', image: undefined },
      },
    });
    expect(mapRows(scene)).toEqual([{ id: tid(2), name: 'Crypt', calibrated: false }]);
  });
});
