import { Entity, Scene, Seat, type AoEShape, type Grid, type Vec3 } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { tid } from '../testing.js';
import type { SelectionActor } from '../tools/selection.js';
import { affectedDistanceLabel, deriveAoEHighlights } from './aoe-highlight.js';

const transform = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
});

const GRID: Grid = {
  type: 'square',
  sizePx: 70,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonal: 'chebyshev',
  snap: true,
};

const seat = Seat.parse({
  id: tid(9),
  label: 'P',
  binding: 'persistent',
  identityId: null,
  role: 'player',
  permissions: { view: true, move: true, edit: false, delete: false },
});
const player: SelectionActor = { kind: 'seat', seat };

interface TokenOverrides {
  labelVisibility?: 'all' | 'owner' | 'dm';
  layer?: Entity['layer'];
  perms?: { view?: boolean };
  owners?: string[];
  x?: number;
  y?: number;
  z?: number;
}

const token = (id: number, name: string, over: TokenOverrides = {}) =>
  Entity.parse({
    id: tid(id),
    layer: over.layer ?? 'tokens',
    name,
    owners: over.owners ?? [],
    ...(over.perms === undefined ? {} : { perms: over.perms }),
    transform: transform(over.x ?? 2, over.y ?? 0, over.z ?? 2),
    token: { sizeCells: 1, heightCells: 1, labelVisibility: over.labelVisibility ?? 'all' },
  });

const volume = (id: number, name: string, shape: AoEShape, position: Vec3) =>
  Entity.parse({
    id: tid(id),
    layer: 'effects',
    name,
    owners: [],
    transform: transform(position.x, position.y, position.z),
    aoe: shape,
  });

const sceneOf = (entities: Entity[]) =>
  Scene.parse({
    id: tid(20),
    name: 'Highlights',
    bounds: { width: 8, height: 8 },
    grid: GRID,
    environment: { background: '#102030' },
    layers: {},
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
  });

const sphere = (radius: number): AoEShape => ({ kind: 'sphere', radius, color: '#ff7744' });
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The fixture of the original M3-05 derivation: inside, exact edge, outside, elevated, DM layer. */
const highlightScene = () =>
  sceneOf([
    token(1, 'Inside', { x: 2, z: 2 }),
    token(2, 'Edge', { x: 3, z: 2 }),
    token(3, 'Outside', { x: 3.01, z: 2 }),
    token(4, 'Elevated', { x: 2, y: 3, z: 2 }),
    token(5, 'Secret', { x: 2, z: 2, layer: 'dm' }),
    volume(10, 'Sphere', sphere(1), at(2, 0, 2)),
  ]);

describe('AoE affected highlight derivation', () => {
  it('uses centre inclusion for inside and exact-edge tokens, respects elevation, and excludes hidden entities', () => {
    const result = deriveAoEHighlights(highlightScene(), { hiddenLayers: new Set(['dm']) });

    expect(result.tokenNames).toEqual(['Edge', 'Inside']);
    expect(result.tokenIds).not.toContain(tid(3));
    expect(result.tokenIds).not.toContain(tid(4));
    expect(result.tokenIds).not.toContain(tid(5));
    expect(result.cells.every((cell) => cell.x >= 0 && cell.z >= 0)).toBe(true);
  });

  it('updates from an elevated local override and omits redacted names while retaining the token highlight', () => {
    const scene = highlightScene();
    const redacted = scene.entities[tid(4)];
    if (!redacted) throw new Error('missing elevated fixture');
    redacted.name = '';
    const result = deriveAoEHighlights(scene, {
      hiddenLayers: new Set(['dm']),
      override: {
        entityId: tid(10),
        aoe: { kind: 'sphere', position: { x: 2, y: 3, z: 2 }, radius: 0.1 },
      },
    });

    expect(result.tokenIds).toEqual([tid(4)]);
    expect(result.tokenNames).toEqual([]);
    expect(result.groups.map((group) => group.name)).toEqual(['Sphere']);
  });

  it('lists the tokens of every stored AoE, nearest to that AoE first', () => {
    const scene = sceneOf([
      token(1, 'Inside', { x: 2, z: 2 }),
      token(2, 'Edge', { x: 3, z: 2 }),
      token(3, 'Outside', { x: 5, z: 5 }),
      volume(10, 'Sphere', sphere(1), at(2, 0, 2)),
      volume(11, 'Empty cube', { kind: 'cube', size: 1, color: '#2255ff' }, at(7, 0, 7)),
    ]);
    const result = deriveAoEHighlights(scene);

    expect(result.groups.map((group) => [group.name, group.kind, group.tokens.length])).toEqual([
      ['Sphere', 'sphere', 2],
      ['Empty cube', 'cube', 0],
    ]);
    expect(result.groups[0]?.tokens.map((row) => [row.label, row.distanceCells])).toEqual([
      ['Inside', 0],
      ['Edge', 1],
    ]);
    expect(result.groups[0]?.tokens.every((row) => !row.labelHidden)).toBe(true);
    expect(result.groups[0]?.cellCount).toBeGreaterThan(0);
  });

  it('shows the neutral placeholder for a token the viewer sees but may not read (D35)', () => {
    const scene = sceneOf([
      token(1, 'Readable', { x: 2, z: 2 }),
      token(2, 'Owner only', { x: 2, z: 2, labelVisibility: 'owner' }),
      token(3, '', { x: 2, z: 2, labelVisibility: 'owner' }),
      volume(10, 'Sphere', sphere(1), at(2, 0, 2)),
    ]);
    const result = deriveAoEHighlights(scene, { actor: player });

    expect(result.groups[0]?.tokens.map((row) => row.label)).toEqual([
      'Readable',
      'Unknown token',
      'Unknown token',
    ]);
    expect(result.groups[0]?.tokens.map((row) => row.labelHidden)).toEqual([false, true, true]);
    // A host-redacted blank name is a hidden label, never an absent token.
    expect(result.tokenIds).toEqual([tid(1), tid(2), tid(3)]);
    expect(result.tokenNames).toEqual(['Readable']);
  });

  it('omits tokens the viewer cannot see at all, from the rows and from the counts (D35)', () => {
    const scene = sceneOf([
      token(1, 'Readable', { x: 2, z: 2 }),
      token(2, 'Secret', { x: 2, z: 2, layer: 'dm' }),
      token(3, 'Private', { x: 2, z: 2, perms: { view: false } }),
      volume(10, 'Sphere', sphere(1), at(2, 0, 2)),
    ]);

    const seen = deriveAoEHighlights(scene, { actor: player });
    expect(seen.groups[0]?.tokens.map((row) => row.label)).toEqual(['Readable']);
    expect(seen.tokenIds).toEqual([tid(1)]);
    expect(seen.tokenNames).toEqual(['Readable']);

    // The host's own view is unfiltered, which is what the WebGL overlay draws for a host.
    const host = deriveAoEHighlights(scene);
    expect(host.tokenIds).toEqual([tid(1), tid(2), tid(3)]);
    expect(host.groups[0]?.tokens.map((row) => row.label).sort()).toEqual([
      'Private',
      'Readable',
      'Secret',
    ]);
  });

  it('converts every affected distance through the scene units', () => {
    const scene = sceneOf([
      token(1, 'Origin', { x: 2, z: 2 }),
      token(2, 'Half cell', { x: 2.5, z: 2 }),
      volume(10, 'Sphere', sphere(1), at(2, 0, 2)),
    ]);
    const rows = deriveAoEHighlights(scene).groups[0]?.tokens ?? [];

    expect(rows.map((row) => affectedDistanceLabel(row.distanceCells, scene.grid))).toEqual([
      '0 ft',
      '2.5 ft',
    ]);
  });
});

describe('affectedDistanceLabel (MEAS-01/MEAS-04)', () => {
  const grid = { unitsPerCell: 5, unitLabel: 'ft' };

  it('prints zero and values exactly on a grid line', () => {
    expect(affectedDistanceLabel(0, grid)).toBe('0 ft');
    expect(affectedDistanceLabel(1, grid)).toBe('5 ft');
    expect(affectedDistanceLabel(2.5, grid)).toBe('12.5 ft');
    expect(affectedDistanceLabel(0, { unitsPerCell: 5, unitLabel: ' ' })).toBe('0');
  });

  it('clamps a negative distance instead of printing it', () => {
    expect(affectedDistanceLabel(-1, grid)).toBe('0 ft');
    expect(affectedDistanceLabel(-0.5, grid)).toBe('0 ft');
  });

  it('has no readout for NaN, an infinity, or a grid that cannot convert', () => {
    expect(affectedDistanceLabel(Number.NaN, grid)).toBe('');
    expect(affectedDistanceLabel(Number.POSITIVE_INFINITY, grid)).toBe('');
    expect(affectedDistanceLabel(Number.NEGATIVE_INFINITY, grid)).toBe('');
    expect(affectedDistanceLabel(1, { unitsPerCell: 0, unitLabel: 'ft' })).toBe('');
    expect(affectedDistanceLabel(1, { unitsPerCell: -5, unitLabel: 'ft' })).toBe('');
    expect(affectedDistanceLabel(1, { unitsPerCell: Number.NaN, unitLabel: 'ft' })).toBe('');
    expect(
      affectedDistanceLabel(1, { unitsPerCell: Number.POSITIVE_INFINITY, unitLabel: 'ft' }),
    ).toBe('');
  });
});
