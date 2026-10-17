import { describe, expect, it } from 'vitest';
import { makeEntity, testId } from '../actions/testing.js';
import {
  Entity,
  MAX_VISION_POINTS,
  resolveSceneVision,
  resolveSeatTools,
  Scene,
  SeatTools,
  visionRuleViolation,
} from './index.js';

const id = testId(20);
const seg = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
];
const square = [
  { x: 0, z: 0 },
  { x: 2, z: 0 },
  { x: 2, z: 2 },
  { x: 0, z: 2 },
];
const shape = { kind: 'box' as const, color: '#888888', walkable: false };
const asset = { source: 'local' as const, hash: 'a'.repeat(64), kind: 'image' as const };
const wall = (overrides: Partial<Entity> = {}, wallFields: Record<string, unknown> = {}) => ({
  ...makeEntity(id, { layer: 'map' }),
  wall: { points: seg, ...wallFields },
  ...overrides,
});
const fogRegion = (overrides: Partial<Entity> = {}, points: unknown = square) => ({
  ...makeEntity(id, { layer: 'map' }),
  fogRegion: { points },
  ...overrides,
});
const ok = (value: unknown) => Entity.safeParse(value).success;
const reason = (value: unknown) => {
  const result = Entity.safeParse(value);
  return result.success ? undefined : result.error.issues.map((i) => i.message).join('; ');
};

describe('Entity.wall (VIS-01)', () => {
  it('accepts a 2-64 point wall and open or closed doors, secret or not', () => {
    expect(ok(wall())).toBe(true);
    expect(ok(wall({}, { points: Array.from({ length: 64 }, (_, i) => ({ x: i, z: 0 })) }))).toBe(
      true,
    );
    for (const open of [true, false])
      for (const secret of [undefined, true, false])
        expect(ok(wall({}, { door: { open, ...(secret === undefined ? {} : { secret }) } }))).toBe(
          true,
        );
  });

  it('rejects bad point counts, non-finite points and a door that is not one segment', () => {
    expect(ok(wall({}, { points: [{ x: 0, z: 0 }] }))).toBe(false);
    expect(
      ok(
        wall(
          {},
          { points: Array.from({ length: MAX_VISION_POINTS + 1 }, (_, i) => ({ x: i, z: 0 })) },
        ),
      ),
    ).toBe(false);
    expect(
      ok(
        wall(
          {},
          {
            points: [
              { x: 0, z: 0 },
              { x: Infinity, z: 0 },
            ],
          },
        ),
      ),
    ).toBe(false);
    expect(
      ok(
        wall(
          {},
          {
            points: [
              { x: 0, z: 0 },
              { x: Number.NaN, z: 0 },
            ],
          },
        ),
      ),
    ).toBe(false);
    expect(
      ok(
        wall(
          {},
          {
            points: [
              { x: 0, z: 0, y: 1 },
              { x: 1, z: 0 },
            ],
          },
        ),
      ),
    ).toBe(false);
    expect(ok(wall({}, { points: [...seg, { x: 2, z: 0 }], door: { open: false } }))).toBe(false);
    expect(reason(wall({}, { points: [...seg, { x: 2, z: 0 }], door: { open: true } }))).toMatch(
      /a door has exactly 2 points/,
    );
    // D47: the door is a boolean; there is no state enum and no locked state.
    expect(ok(wall({}, { door: { state: 'open' } }))).toBe(false);
    expect(ok(wall({}, { door: { open: true, locked: true } }))).toBe(false);
    expect(ok(wall({}, { door: {} }))).toBe(false);
  });

  it.each([
    ['token', { token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' as const } }],
    ['shape', { shape }],
    ['model', { model: { asset: { ...asset, kind: 'model' as const } } }],
    ['image', { image: { asset, calibrated: false } }],
    ['aoe', { aoe: { kind: 'sphere' as const, radius: 1, color: '#ffffff' } }],
    ['pin', { pin: { text: 'x', reveal: 'hover' as const } }],
    ['aura', { aura: { radius: 1, color: '#ffffff' } }],
    ['blocksSight', { blocksSight: true as const }],
  ])('rejects a wall that also has %s', (_name, extra) => {
    expect(reason(wall(extra))).toMatch(/a wall has no other components/);
  });

  it('keeps walls on the map layer and visible to every player (D47 (4))', () => {
    for (const layer of ['props', 'tokens', 'dm', 'effects'] as const)
      expect(reason(wall({ layer }))).toMatch(/a wall lives on the map layer/);
    expect(reason(wall({ perms: { view: false } }))).toMatch(/visible to every player/);
    expect(ok(wall({ perms: { move: true } }))).toBe(true);
  });
});

describe('Entity.blocksSight (VIS-02)', () => {
  it('is valid on shape and model props outside the dm layer', () => {
    expect(ok(makeEntity(id, { layer: 'props', shape, blocksSight: true }))).toBe(true);
    expect(ok(makeEntity(id, { layer: 'map', shape, blocksSight: true }))).toBe(true);
    expect(
      ok(
        makeEntity(id, {
          layer: 'props',
          model: { asset: { ...asset, kind: 'model' } },
          blocksSight: true,
        }),
      ),
    ).toBe(true);
    expect(ok({ ...makeEntity(id, { layer: 'props', shape }), blocksSight: false })).toBe(false);
  });

  it('rejects tokens, battlemap images, AoEs, pins, bare entities and the dm layer', () => {
    const token = { sizeCells: 1, heightCells: 1, labelVisibility: 'all' as const };
    for (const bad of [
      makeEntity(id, { token, blocksSight: true }),
      makeEntity(id, { token, shape, blocksSight: true }),
      makeEntity(id, { layer: 'map', image: { asset, calibrated: true }, blocksSight: true }),
      makeEntity(id, {
        layer: 'map',
        image: { asset, calibrated: true },
        shape,
        blocksSight: true,
      }),
      makeEntity(id, {
        layer: 'effects',
        aoe: { kind: 'sphere', radius: 1, color: '#ffffff' },
        blocksSight: true,
      }),
      makeEntity(id, { pin: { text: 'x', reveal: 'hover' }, shape, blocksSight: true }),
      makeEntity(id, { layer: 'props', blocksSight: true }),
    ])
      expect(reason(bad)).toMatch(/only a shape or model prop can block sight/);
    expect(reason(makeEntity(id, { layer: 'dm', shape, blocksSight: true }))).toMatch(
      /cannot be on the dm layer/,
    );
    expect(
      reason(makeEntity(id, { layer: 'props', shape, blocksSight: true, perms: { view: false } })),
    ).toMatch(/visible to every player/);
  });
});

describe('Entity.fogRegion (D47 + MV-303)', () => {
  it('accepts a 3-64 point simple polygon on the map layer, active or revealed', () => {
    expect(ok(fogRegion())).toBe(true);
    expect(ok({ ...fogRegion(), fogRegion: { points: square, revealed: true } })).toBe(true);
    // Absent `revealed` is active; it is only ever `true`, and there is no `hidden` field.
    expect(ok({ ...fogRegion(), fogRegion: { points: square, revealed: false } })).toBe(false);
    expect(ok({ ...fogRegion(), fogRegion: { points: square, hidden: true } })).toBe(false);
  });

  it('rejects too few points, self-intersections, other components and other layers', () => {
    expect(ok(fogRegion({}, seg))).toBe(false);
    expect(
      reason(
        fogRegion({}, [
          { x: 0, z: 0 },
          { x: 2, z: 2 },
          { x: 2, z: 0 },
          { x: 0, z: 2 },
        ]),
      ),
    ).toMatch(/simple polygon/);
    expect(
      ok(
        fogRegion(
          {},
          Array.from({ length: 65 }, (_, i) => ({ x: i, z: i * i })),
        ),
      ),
    ).toBe(false);
    expect(reason(fogRegion({ shape }))).toMatch(/a fog region has no other components/);
    expect(reason(fogRegion({ blocksSight: true }))).toMatch(/no other components/);
    expect(reason({ ...fogRegion(), wall: { points: seg } })).toMatch(/no other components/);
    for (const extra of [
      { token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' as const } },
      { image: { asset, calibrated: false } },
      { aoe: { kind: 'sphere' as const, radius: 1, color: '#ffffff' } },
      { pin: { text: 'x', reveal: 'hover' as const } },
      { aura: { radius: 1, color: '#ffffff' } },
    ])
      expect(reason(fogRegion(extra))).toMatch(/no other components/);
    for (const layer of ['dm', 'props', 'tokens', 'effects'] as const)
      expect(reason(fogRegion({ layer }))).toMatch(/a fog region lives on the map layer/);
  });

  it('visionRuleViolation is the single rule set and passes ordinary entities', () => {
    expect(visionRuleViolation(makeEntity(id))).toBeUndefined();
    expect(visionRuleViolation(makeEntity(id, { layer: 'props', shape }))).toBeUndefined();
  });
});

describe('Scene.vision and SeatTools.doors', () => {
  const scene = {
    id,
    name: 'Crypt',
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
  };

  it('absent vision is off; the switch round-trips and nothing else is accepted', () => {
    expect(resolveSceneVision(Scene.parse(scene))).toEqual({ dynamicLighting: false });
    const on = Scene.parse({ ...scene, vision: { dynamicLighting: true } });
    expect(resolveSceneVision(on)).toEqual({ dynamicLighting: true });
    // MV-303 Q3/Q4: no `outside` look and no explored memory.
    expect(Scene.safeParse({ ...scene, vision: { fog: true } }).success).toBe(false);
    expect(
      Scene.safeParse({ ...scene, vision: { dynamicLighting: true, outside: 'dim' } }).success,
    ).toBe(false);
  });

  it('rejects a scene holding an invalid wall, so a save cannot smuggle one in', () => {
    expect(
      Scene.safeParse({ ...scene, entities: { [id]: wall({ layer: 'tokens' }) } }).success,
    ).toBe(false);
    expect(Scene.safeParse({ ...scene, entities: { [id]: wall() } }).success).toBe(true);
  });

  it('doors is optional and resolves to off; v11 tools still parse', () => {
    expect(SeatTools.safeParse({ measure: true, draw: false, pins: false }).success).toBe(true);
    expect(
      SeatTools.safeParse({ measure: true, draw: false, pins: false, doors: true }).success,
    ).toBe(true);
    expect(
      SeatTools.safeParse({ measure: true, draw: false, pins: false, doors: 'y' }).success,
    ).toBe(false);
    expect(resolveSeatTools({})).toMatchObject({ doors: false });
    expect(resolveSeatTools({ tools: { measure: true, draw: false, pins: false } }).doors).toBe(
      false,
    );
    expect(
      resolveSeatTools({ tools: { measure: true, draw: false, pins: false, doors: true } }).doors,
    ).toBe(true);
  });
});
