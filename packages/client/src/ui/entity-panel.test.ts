import { canPerform, type Campaign, type Scene } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import {
  entityDeleteIntent,
  entityRenameIntent,
  entityRows,
  isValidColour,
  isValidPropSize,
  ownerOptions,
  placementPosition,
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
        transform: { position: { x: 0.5, y: 0, z: 0.5 } },
      },
    });
  });

  it('a large token snaps to a grid intersection', () => {
    const spec = tokenCreateIntent(scene, { ...draft, size: 'large' });
    expect(spec.payload).toMatchObject({
      entity: { transform: { position: { x: 0, y: 0, z: 0 } } },
    });
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
    expect(placementPosition(sceneOf(world(false)), 1)).toEqual({ x: 0, y: 0, z: 0 });
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
