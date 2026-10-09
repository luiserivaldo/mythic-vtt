import { describe, expect, it } from 'vitest';
import {
  AssetRef,
  AoEEntity,
  AoEShape,
  DEFAULT_GRID_COLOR,
  DEFAULT_GRID_OPACITY,
  Grid,
  PIN_TEXT_MAX_LENGTH,
  PinComponent,
  resolveGridStyle,
  resolveSceneBounds,
  Campaign,
  Entity,
  Id,
  Quat,
  Scene,
  Seat,
  Vec3,
} from './index.js';

const id = (c: string) => c.repeat(26);
const A = id('A');
const B = id('B');
const C = id('C');
const hash = 'a'.repeat(64);

const entity = {
  id: B,
  layer: 'tokens',
  name: 'Goblin',
  owners: [A],
  transform: {
    position: { x: 1, y: 0, z: 2 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
  pin: { text: 'secret', reveal: { proximity: 3 } },
};
const scene = {
  id: C,
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
  layers: { tokens: { locked: false }, dm: { locked: true } },
  entities: { [B]: entity },
};
const seat = {
  id: A,
  label: 'Seat 1',
  binding: 'persistent',
  identityId: null,
  role: 'player',
  permissions: { view: true, move: true, edit: false, delete: false },
};
const campaign = {
  id: id('D'),
  name: 'Test',
  schemaVersion: 1,
  settings: {
    defaultBinding: 'persistent',
    instanceMode: 'linked',
    spectators: { enabled: false, view: 'players' },
  },
  seats: { [A]: seat },
  scenes: { [C]: scene },
  activeSceneId: C,
};

describe('scene environment zenith (ENV-07)', () => {
  it('is optional and additive', () => {
    expect(Scene.safeParse(scene).success).toBe(true);
    const withZenith = { ...scene, environment: { background: '#000000', zenith: '#335577' } };
    expect(Scene.parse(withZenith).environment.zenith).toBe('#335577');
    expect(
      Scene.safeParse({ ...scene, environment: { background: '#000', zenith: 5 } }).success,
    ).toBe(false);
  });
});

describe('round-trip parse', () => {
  it.each([
    ['Campaign', Campaign, campaign],
    ['Scene', Scene, scene],
    ['Entity', Entity, entity],
    ['Seat', Seat, seat],
    ['Vec3', Vec3, { x: 0, y: 1, z: -2.5 }],
    ['Quat', Quat, { x: 0, y: 0, z: 0, w: 1 }],
  ])('%s parses to an identical value and re-parses stably', (_n, schema, value) => {
    const parsed = schema.parse(value);
    expect(parsed).toEqual(value);
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(value);
  });
});

describe('pin component (TRIG-01)', () => {
  it('accepts bounded text and hover, click or proximity reveal rules', () => {
    for (const reveal of ['hover', 'click', { proximity: 0 }, { proximity: 3.5 }]) {
      expect(
        PinComponent.safeParse({ text: 'x'.repeat(PIN_TEXT_MAX_LENGTH), reveal }).success,
      ).toBe(true);
    }
  });

  it('rejects empty or oversized text and malformed reveal rules', () => {
    for (const value of [
      { text: '', reveal: 'hover' },
      { text: 'x'.repeat(PIN_TEXT_MAX_LENGTH + 1), reveal: 'click' },
      { text: 'note', reveal: { proximity: -1 } },
      { text: 'note', reveal: { proximity: 1, extra: true } },
      { text: 'note', reveal: 'always' },
      { text: 'note', reveal: 'hover', extra: true },
    ]) {
      expect(PinComponent.safeParse(value).success).toBe(false);
    }
  });

  it('keeps entities without a pin valid and unchanged', () => {
    const withoutPin = { ...entity, pin: undefined };
    const parsed = Entity.parse(withoutPin);
    expect(parsed.pin).toBeUndefined();
  });
});

describe('Id', () => {
  it('accepts a ULID and rejects other strings', () => {
    expect(Id.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(true);
    expect(Id.safeParse('not-an-id').success).toBe(false);
    expect(Id.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAU').success).toBe(false); // U is not Crockford
    expect(Id.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FA').success).toBe(false); // too short
  });
});

describe('AssetRef (D16)', () => {
  it('accepts local and library refs', () => {
    expect(AssetRef.safeParse({ source: 'local', hash, kind: 'image' }).success).toBe(true);
    expect(
      AssetRef.safeParse({
        source: 'library',
        libraryId: 'lib',
        version: '1.0.0',
        kind: 'model',
        fallback: { kind: 'primitive', sizeCells: 1 },
      }).success,
    ).toBe(true);
  });
  it('rejects bad hashes, unknown sources and a missing fallback', () => {
    expect(AssetRef.safeParse({ source: 'local', hash: 'xyz', kind: 'image' }).success).toBe(false);
    expect(AssetRef.safeParse({ source: 'cloud', hash, kind: 'image' }).success).toBe(false);
    expect(
      AssetRef.safeParse({ source: 'library', libraryId: 'l', version: '1', kind: 'image' })
        .success,
    ).toBe(false);
  });
});

describe('token colour (D38)', () => {
  it('is optional: tokens without a colour still parse, with none invented', () => {
    const parsed = Entity.parse(entity);
    expect(parsed.token?.color).toBeUndefined();
  });
  it('accepts #rrggbb and rejects anything else', () => {
    const withColor = (color: unknown) => ({ ...entity, token: { ...entity.token, color } });
    expect(Entity.safeParse(withColor('#A1b2C3')).success).toBe(true);
    for (const bad of ['red', '#fff', '#12345g', 'a1b2c3', '#a1b2c3d', 3])
      expect(Entity.safeParse(withColor(bad)).success).toBe(false);
  });
});

describe('rejections', () => {
  it('rejects NaN/Infinity coordinates', () => {
    expect(Vec3.safeParse({ x: Number.NaN, y: 0, z: 0 }).success).toBe(false);
    expect(Vec3.safeParse({ x: 0, y: Infinity, z: 0 }).success).toBe(false);
  });
  it('rejects an unknown layer and a non-record entities field', () => {
    expect(Entity.safeParse({ ...entity, layer: 'secret' }).success).toBe(false);
    expect(Scene.safeParse({ ...scene, entities: [entity] }).success).toBe(false);
  });
  it('rejects a seat with a malformed id or missing permissions', () => {
    expect(Seat.safeParse({ ...seat, id: 'x' }).success).toBe(false);
    expect(Seat.safeParse({ ...seat, permissions: { view: true } }).success).toBe(false);
  });
});

describe('grid colour and opacity (GRID-01)', () => {
  it('accepts a legacy grid without colour or opacity and resolves defaults', () => {
    const parsed = Grid.parse(scene.grid);
    expect(parsed.color).toBeUndefined();
    expect(resolveGridStyle(parsed)).toEqual({
      color: DEFAULT_GRID_COLOR,
      opacity: DEFAULT_GRID_OPACITY,
    });
  });
  it('keeps explicit values, including opacity 0', () => {
    const parsed = Grid.parse({ ...scene.grid, color: '#FF8800', opacity: 0 });
    expect(resolveGridStyle(parsed)).toEqual({ color: '#FF8800', opacity: 0 });
  });
  it.each([{ color: 'red' }, { color: '#fff' }, { opacity: 1.01 }, { opacity: -1 }])(
    'rejects %o',
    (extra) => {
      expect(Grid.safeParse({ ...scene.grid, ...extra }).success).toBe(false);
    },
  );
});

describe('AoE schemas (MEAS-03)', () => {
  const shapes = [
    { kind: 'sphere', radius: 3, color: '#ff0000' },
    { kind: 'cylinder', radius: 2, height: 4, color: '#00ff00' },
    { kind: 'cone', radius: 3, length: 6, color: '#0000ff' },
    { kind: 'cube', size: 4, color: '#ffffff' },
    { kind: 'line', length: 6, width: 1, height: 1, color: '#ffff00' },
  ] as const;

  it.each(shapes)('round-trips the $kind geometry fields', (shape) => {
    expect(AoEShape.parse(shape)).toEqual(shape);
    expect(
      AoEEntity.safeParse({
        id: entity.id,
        layer: entity.layer,
        name: entity.name,
        owners: entity.owners,
        transform: entity.transform,
        aoe: shape,
      }).success,
    ).toBe(true);
  });

  it('rejects missing, negative, non-finite and extra dimensions', () => {
    expect(AoEShape.safeParse({ kind: 'sphere', color: '#fff' }).success).toBe(false);
    expect(AoEShape.safeParse({ kind: 'sphere', radius: -1, color: '#fff' }).success).toBe(false);
    expect(AoEShape.safeParse({ kind: 'sphere', radius: Infinity, color: '#fff' }).success).toBe(
      false,
    );
    expect(
      AoEShape.safeParse({ kind: 'sphere', radius: 1, length: 2, color: '#fff' }).success,
    ).toBe(false);
  });

  it('keeps the pre-M3 placeholder component parseable', () => {
    expect(
      Entity.safeParse({ ...entity, aoe: { kind: 'sphere', size: 3, color: '#fff' } }).success,
    ).toBe(true);
  });
});

describe('scene bounds (D37)', () => {
  it('is optional, whole cells 1..200, and defaults to 40 x 30 at read time', () => {
    expect(Scene.safeParse(scene).success).toBe(true);
    expect(resolveSceneBounds(Scene.parse(scene))).toEqual({ width: 40, height: 30 });
    const withBounds = Scene.parse({ ...scene, bounds: { width: 200, height: 1 } });
    expect(resolveSceneBounds(withBounds)).toEqual({ width: 200, height: 1 });
    for (const bounds of [
      { width: 0, height: 5 },
      { width: 5, height: 201 },
      { width: 2.5, height: 5 },
      { width: 5 },
    ]) {
      expect(Scene.safeParse({ ...scene, bounds }).success).toBe(false);
    }
  });
});
