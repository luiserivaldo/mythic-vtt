import { describe, expect, it } from 'vitest';
import { DRAW_WIDTH_MAX, type Entity, type Scene } from '@mythic/shared';
import {
  DRAW_LIFT,
  DRAW_SEND_INTERVAL_MS,
  drawPoint3d,
  drawPointOnBoard,
  erasableStrokes,
  ribbonGeometry,
  sceneStrokes,
  shouldSendStroke,
  type DrawStroke,
} from './drawing.js';

const stroke = (over: Partial<DrawStroke> = {}): DrawStroke => ({
  sceneId: 'scene',
  strokeId: 'M'.repeat(26),
  from: 'me',
  color: '#e11d48',
  width: 0.12,
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  phase: 'finished',
  at: 1,
  ...over,
});

describe('freehand ribbon geometry (LAY-05)', () => {
  it('builds a quad per segment, offset by half the width', () => {
    const ribbon = ribbonGeometry(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      0.1,
    );
    expect(ribbon).not.toBeNull();
    expect(ribbon?.positions).toHaveLength(12);
    expect(ribbon?.indices).toEqual([0, 1, 2, 2, 1, 3]);
    // +X runs along the segment, so the ribbon widens along Z, lifted clear of the board.
    expect(ribbon?.positions).toEqual([
      0,
      DRAW_LIFT,
      0.05,
      0,
      DRAW_LIFT,
      -0.05,
      1,
      DRAW_LIFT,
      0.05,
      1,
      DRAW_LIFT,
      -0.05,
    ]);
  });

  it('clamps the width to the drawing contract and never mutates the points', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    const wide = ribbonGeometry(points, DRAW_WIDTH_MAX * 10);
    const clamped = ribbonGeometry(points, DRAW_WIDTH_MAX);
    expect(wide?.positions).toEqual(clamped?.positions);
    expect(points).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
  });

  it('widens a three-point path into one strip without gaps', () => {
    const ribbon = ribbonGeometry(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
      ],
      0.2,
    );
    expect(ribbon?.positions).toHaveLength(18);
    expect(ribbon?.indices).toHaveLength(12);
    expect(ribbon?.positions.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('returns nothing for a stroke that cannot make a strip', () => {
    expect(ribbonGeometry([], 0.1)).toBeNull();
    expect(ribbonGeometry([{ x: 0, y: 0, z: 0 }], 0.1)).toBeNull();
    expect(
      ribbonGeometry(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        Number.NaN,
      ),
    ).toBeNull();
    expect(
      ribbonGeometry(
        [
          { x: 0, y: 0, z: 0 },
          { x: Number.NaN, y: 0, z: 0 },
        ],
        0.1,
      ),
    ).toBeNull();
  });

  it('stays finite on a vertical stroke, where the horizontal normal vanishes', () => {
    const ribbon = ribbonGeometry(
      [
        { x: 2, y: 0, z: 2 },
        { x: 2, y: 1, z: 2 },
      ],
      0.1,
    );
    expect(ribbon).not.toBeNull();
    expect(ribbon?.positions.every((value) => Number.isFinite(value))).toBe(true);
    // The fallback normal is +X, so the strip is 0.1 wide around x = 2.
    expect(ribbon?.positions.slice(0, 3)).toEqual([2.05, DRAW_LIFT, 2]);
  });
});

describe('drawing send throttling', () => {
  it('always sends a forced message and the first one of a stroke', () => {
    expect(shouldSendStroke(null, 1_000, false)).toBe(true);
    expect(shouldSendStroke(1_000, 1_000, true)).toBe(true);
  });

  it('holds a stream message until the interval has passed', () => {
    expect(shouldSendStroke(1_000, 1_000 + DRAW_SEND_INTERVAL_MS - 1, false)).toBe(false);
    expect(shouldSendStroke(1_000, 1_000 + DRAW_SEND_INTERVAL_MS, false)).toBe(true);
  });
});

describe('which strokes a viewer sees and may erase', () => {
  it('keeps only the active scene and orders strokes by arrival', () => {
    const strokes = [
      stroke({ strokeId: 'B'.repeat(26), at: 2 }),
      stroke({ sceneId: 'other' }),
      stroke({ strokeId: 'A'.repeat(26), at: 1 }),
    ];
    expect(sceneStrokes(strokes, 'scene').map((s) => s.at)).toEqual([1, 2]);
    expect(sceneStrokes(strokes, 'missing')).toEqual([]);
  });

  it('lets a viewer erase their own drawings, and the DM erase any', () => {
    const mine = stroke({ strokeId: 'A'.repeat(26), from: 'me' });
    const theirs = stroke({ strokeId: 'B'.repeat(26), from: 'other' });
    const other = stroke({ sceneId: 'other' });
    const strokes = [mine, theirs, other];
    expect(erasableStrokes(strokes, 'scene', 'me', false)).toEqual([mine]);
    expect(erasableStrokes(strokes, 'scene', 'me', true)).toEqual([mine, theirs]);
    expect(erasableStrokes(strokes, 'scene', 'nobody', false)).toEqual([]);
  });

  it('never offers an erase for a stroke of another scene', () => {
    const strokes = [stroke({ sceneId: 'other', from: 'me' })];
    expect(erasableStrokes(strokes, 'scene', 'me', true)).toEqual([]);
  });
});

describe('stroke ordering', () => {
  it('breaks an arrival tie by stroke id, so every client stacks the strips the same way', () => {
    const first = stroke({ strokeId: 'A'.repeat(26), at: 7 });
    const second = stroke({ strokeId: 'B'.repeat(26), at: 7 });
    expect(sceneStrokes([second, first], 'scene').map((s) => s.strokeId)).toEqual([
      'A'.repeat(26),
      'B'.repeat(26),
    ]);
  });
});

const box: Entity = {
  id: 'B'.repeat(26),
  layer: 'props',
  name: 'Platform',
  owners: [],
  transform: {
    position: { x: 5, y: 2, z: 5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 4, y: 3, z: 4 },
  },
  shape: { kind: 'box', color: '#888888', walkable: true },
};

const token: Entity = {
  id: 'T'.repeat(26),
  layer: 'tokens',
  name: 'Scout',
  owners: [],
  transform: {
    position: { x: 8.5, y: 10, z: 8.5 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
};

const scene: Scene = {
  id: 'S'.repeat(26),
  name: 'Tower',
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'euclidean',
    // Snapping is deliberately on: a freehand sample must not be snapped like a token move.
    snap: true,
  },
  bounds: { width: 20, height: 20 },
  environment: { background: '#000000' },
  layers: {},
  entities: { [box.id]: box, [token.id]: token },
};

describe('drawing points on the board', () => {
  it('keeps a freehand sample where the pointer is, inside the canvas (D37)', () => {
    expect(drawPointOnBoard({ x: 5.3, z: 7.9 }, scene)).toEqual({ x: 5.3, y: 0, z: 7.9 });
  });

  it('clamps a sample to the canvas and refuses a non-finite one', () => {
    expect(drawPointOnBoard({ x: -3, z: 40 }, scene)).toEqual({ x: 0, y: 0, z: 20 });
    expect(drawPointOnBoard({ x: Number.NaN, z: 1 }, scene)).toBeNull();
    expect(drawPointOnBoard({ x: 1, z: Number.POSITIVE_INFINITY }, scene)).toBeNull();
  });

  it('draws on the surface under the pointer in 3D and takes a token at its own position', () => {
    expect(drawPoint3d({ x: 5, y: 5, z: 5 }, scene, box.id)).toEqual({ x: 5, y: 5, z: 5 });
    expect(drawPoint3d({ x: 8.5, y: 10.8, z: 8.5 }, scene, token.id)).toEqual(
      token.transform.position,
    );
    expect(drawPoint3d({ x: 1, y: -1, z: 1 }, scene)).toEqual({ x: 1, y: 0, z: 1 });
    expect(drawPoint3d({ x: 1, y: 0, z: 1 }, scene, box.id)).toEqual({ x: 1, y: 0, z: 1 });
  });

  it('refuses a non-finite 3D sample rather than drawing a broken strip', () => {
    expect(drawPoint3d({ x: Number.NaN, y: 0, z: 0 }, scene)).toBeNull();
  });
});
