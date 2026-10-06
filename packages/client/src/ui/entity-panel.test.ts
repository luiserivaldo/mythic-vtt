import { canPerform, type Campaign, type Scene } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import {
  entityDeleteIntent,
  entityRenameIntent,
  entityShowGridOnTopIntent,
  entityRows,
  isValidColour,
  isValidPropSize,
  ownerOptions,
  placementPosition,
  SPAWN_STEPS,
  propCreateIntent,
  tokenCreateIntent,
  TOKEN_SIZE_NAMES,
} from './entity-panel.js';
import { toolbarItems } from './toolbar-items.js';

const S = tid(2);
const P = tid(4);
const host = { kind: 'host' } as const;

function world(snap = true): Campaign {
  const base = makeCampaign();
  return {
    ...base,
    seats: {
      [P]: {
        id: P,
        label: 'Pia',
        binding: 'persistent',
        identityId: null,
        role: 'player',
        permissions: { view: true, move: true, edit: false, delete: false },
      },
    },
    scenes: {
      [S]: {
        id: S,
        name: 'Cave',
        grid: {
          type: 'square',
          sizePx: 70,
          unitsPerCell: 5,
          unitLabel: 'ft',
          diagonal: 'alternating',
          snap,
        },
        environment: { background: '#000000' },
        layers: {},
        entities: {},
      },
    },
    activeSceneId: S,
  };
}

const sceneOf = (c: Campaign): Scene => {
  const scene = c.scenes[S];
  if (!scene) throw new Error('missing scene');
  return scene;
};

const draft = {
  sceneId: S,
  entityId: tid(30),
  name: ' Goblin ',
  size: 'medium',
  layer: 'tokens',
  labelVisibility: 'all',
  ownerId: null,
  imageHash: null,
} as const;

describe('entity panel intents', () => {
  const state = world();
  const scene = sceneOf(state);

  it('every token size produces an intent the host accepts', () => {
    for (const size of TOKEN_SIZE_NAMES) {
      const spec = tokenCreateIntent(scene, { ...draft, size });
      expect(canPerform(state, host, spec.type, spec.payload)).toBe(true);
    }
  });

  it('token: trims the name, carries the owner and image, snaps to a cell centre', () => {
    const hash = 'a'.repeat(64);
    const spec = tokenCreateIntent(scene, { ...draft, ownerId: P, imageHash: hash });
    expect(canPerform(state, host, spec.type, spec.payload)).toBe(true);
    expect(spec.payload).toMatchObject({
      entity: {
        name: 'Goblin',
        owners: [P],
        token: { sizeCells: 1, image: { source: 'local', hash, kind: 'image' } },
        transform: { position: { x: 20.5, y: 0, z: 15.5 } },
      },
    });
  });

  it('a large token snaps to a grid intersection at the scene centre', () => {
    const spec = tokenCreateIntent(scene, { ...draft, size: 'large' });
    expect(spec.payload).toMatchObject({
      entity: { transform: { position: { x: 20, y: 0, z: 15 } } },
    });
  });

  it('D38: an image-less token carries a valid colour, an invalid one is dropped', () => {
    const ok = tokenCreateIntent(scene, { ...draft, color: '#aa3300' });
    expect(canPerform(state, host, ok.type, ok.payload)).toBe(true);
    expect(ok.payload).toMatchObject({ entity: { token: { color: '#aa3300' } } });
    const bad = tokenCreateIntent(scene, { ...draft, color: 'red' });
    expect((bad.payload as { entity: { token: object } }).entity.token).not.toHaveProperty('color');
  });

  it('every primitive kind is accepted, at base elevation 0', () => {
    for (const kind of [
      'box',
      'cylinder',
      'cone',
      'pyramid',
      'sphere',
      'plane',
      'wedge',
    ] as const) {
      const spec = propCreateIntent(scene, {
        sceneId: S,
        entityId: tid(31),
        name: 'Crate',
        kind,
        color: '#aa5500',
        size: { x: 1, y: 2, z: 1 },
        walkable: true,
        layer: 'props',
      });
      expect(canPerform(state, host, spec.type, spec.payload)).toBe(true);
      expect(spec.payload).toMatchObject({
        entity: { shape: { kind, walkable: true }, transform: { position: { y: 0 } } },
      });
    }
  });

  it('rename and delete intents are accepted once the entity exists', () => {
    const create = tokenCreateIntent(scene, draft);
    const withEntity: Campaign = {
      ...state,
      scenes: {
        [S]: { ...scene, entities: { [tid(30)]: (create.payload as { entity: never }).entity } },
      },
    };
    for (const spec of [entityRenameIntent(S, tid(30), ' Boss '), entityDeleteIntent(S, tid(30))]) {
      expect(canPerform(withEntity, host, spec.type, spec.payload)).toBe(true);
    }
    expect(entityRenameIntent(S, tid(30), ' Boss ').payload).toMatchObject({
      changes: { name: 'Boss' },
    });
  });

  it('a non-snapping grid keeps the origin', () => {
    expect(placementPosition(sceneOf(world(false)), 1)).toEqual({ x: 20, y: 0, z: 15 });
  });

  it('centres on the scene bounds, snapped for the footprint (D37)', () => {
    const small = { ...scene, bounds: { width: 10, height: 6 } };
    expect(placementPosition(small, 1)).toEqual({ x: 5.5, y: 0, z: 3.5 });
    expect(placementPosition(small, 2)).toEqual({ x: 5, y: 0, z: 3 });
  });

  it('offsets successive spawns, wraps, and stays inside the canvas', () => {
    const a = placementPosition(scene, 1, 0);
    const b = placementPosition(scene, 1, 1);
    expect({ x: b.x - a.x, z: b.z - a.z }).toEqual({ x: 1, z: 1 });
    expect(placementPosition(scene, 1, SPAWN_STEPS)).toEqual(a);
    const tiny = { ...scene, bounds: { width: 1, height: 1 } };
    for (let i = 0; i < SPAWN_STEPS; i++) {
      const p = placementPosition(tiny, 1, i);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.z).toBeLessThanOrEqual(1);
    }
  });

  it('every spawn position is accepted by the host', () => {
    for (let i = 0; i < SPAWN_STEPS; i++) {
      const spec = propCreateIntent(
        {
          ...scene,
          entities: Object.fromEntries(
            Array.from({ length: i }, (_, k) => [`k${String(k)}`, {} as never]),
          ),
        },
        {
          sceneId: S,
          entityId: tid(31),
          name: 'p',
          kind: 'box',
          color: '#aa5500',
          size: { x: 1, y: 1, z: 1 },
          walkable: false,
          layer: 'props',
        },
      );
      expect(canPerform(state, host, spec.type, spec.payload)).toBe(true);
    }
  });
});

describe('entity panel view model', () => {
  it('lists entities by layer then name with kind and owner labels', () => {
    const state = world();
    const scene = sceneOf(state);
    const entities = {
      [tid(30)]: (
        tokenCreateIntent(scene, { ...draft, name: 'Zed', ownerId: P }).payload as {
          entity: never;
        }
      ).entity,
      [tid(31)]: (
        propCreateIntent(scene, {
          sceneId: S,
          entityId: tid(31),
          name: 'Crate',
          kind: 'box',
          color: '#ffffff',
          size: { x: 1, y: 1, z: 1 },
          walkable: false,
          layer: 'props',
        }).payload as { entity: never }
      ).entity,
    };
    const rows = entityRows(state, { ...scene, entities });
    expect(rows.map((r) => [r.name, r.kind, r.layerLabel, r.owners])).toEqual([
      ['Crate', 'Box', 'Props', ''],
      ['Zed', 'Token', 'Tokens', 'Pia'],
    ]);
    expect(ownerOptions(state)).toEqual([{ id: P, label: 'Pia' }]);
  });

  it('validates colours and sizes; only admins get the panel', () => {
    expect(isValidColour('#12abEF')).toBe(true);
    expect(isValidColour('red')).toBe(false);
    expect(isValidPropSize(0)).toBe(false);
    expect(isValidPropSize(Number.NaN)).toBe(false);
    expect(isValidPropSize(2.5)).toBe(true);
    expect(toolbarItems('player').map((i) => i.id)).not.toContain('entities');
    expect(toolbarItems('codm').map((i) => i.id)).toContain('entities');
  });
});

describe('entityShowGridOnTopIntent (GRID-05)', () => {
  it('replaces the shape with showGridOnTop set', () => {
    const shape = { kind: 'box' as const, color: '#aa5522', walkable: true };
    expect(entityShowGridOnTopIntent('S', 'E', shape, true)).toEqual({
      type: 'entity.update',
      payload: {
        sceneId: 'S',
        entityId: 'E',
        changes: { shape: { ...shape, showGridOnTop: true } },
      },
      sceneId: 'S',
    });
  });
});
