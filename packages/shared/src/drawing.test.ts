import { describe, expect, it } from 'vitest';
import {
  appendDrawPoint,
  canClearDrawings,
  canEraseDrawing,
  clampDrawWidth,
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  DRAW_CLEAR_CHANNEL,
  DRAW_COLORS,
  DRAW_ERASE_CHANNEL,
  DRAW_POINT_EPSILON,
  DRAW_STROKE_CHANNEL,
  DRAW_WIDTH_MAX,
  DRAW_WIDTH_MIN,
  DrawClearData,
  DrawEraseData,
  DrawStrokeData,
  drawChannelOf,
  isDrawColor,
  MAX_DRAW_POINTS,
} from './drawing.js';
import { ACTORS, IDS, makeCampaign } from './actions/testing.js';

const stroke = {
  sceneId: IDS.scene,
  strokeId: IDS.entity,
  color: DEFAULT_DRAW_COLOR,
  width: DEFAULT_DRAW_WIDTH,
  phase: 'active',
  points: [
    { x: 1, y: 0, z: 2 },
    { x: 1.5, y: 0, z: 2 },
  ],
};

const points = Array.from({ length: MAX_DRAW_POINTS }, (_, index) => ({
  x: index / 10,
  y: 0,
  z: 0,
}));

describe('drawing channels (LAY-05)', () => {
  it('maps the three drawing channels and leaves every other channel alone', () => {
    expect(drawChannelOf(DRAW_STROKE_CHANNEL)).toBe('stroke');
    expect(drawChannelOf(DRAW_ERASE_CHANNEL)).toBe('erase');
    expect(drawChannelOf(DRAW_CLEAR_CHANNEL)).toBe('clear');
    for (const other of ['cursor', 'ruler.preview', 'token.drag-preview', 'draw', ''])
      expect(drawChannelOf(other)).toBeNull();
  });

  it('names the channels the wire and the scene toggle both use', () => {
    expect(DRAW_STROKE_CHANNEL).toBe('draw.stroke');
    expect(DRAW_ERASE_CHANNEL).toBe('draw.erase');
    expect(DRAW_CLEAR_CHANNEL).toBe('draw.clear');
  });
});

describe('drawing width and colour', () => {
  it('clamps a width into the supported range and keeps the bounds exact', () => {
    expect(clampDrawWidth(DRAW_WIDTH_MIN)).toBe(DRAW_WIDTH_MIN);
    expect(clampDrawWidth(DRAW_WIDTH_MAX)).toBe(DRAW_WIDTH_MAX);
    expect(clampDrawWidth(DRAW_WIDTH_MIN / 2)).toBe(DRAW_WIDTH_MIN);
    expect(clampDrawWidth(DRAW_WIDTH_MAX * 2)).toBe(DRAW_WIDTH_MAX);
    expect(clampDrawWidth(0)).toBe(DRAW_WIDTH_MIN);
    expect(clampDrawWidth(-1)).toBe(DRAW_WIDTH_MIN);
  });

  it('falls back to the default width for a non-finite value', () => {
    expect(clampDrawWidth(Number.NaN)).toBe(DEFAULT_DRAW_WIDTH);
    expect(clampDrawWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_DRAW_WIDTH);
    expect(clampDrawWidth(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_DRAW_WIDTH);
    expect(clampDrawWidth(DEFAULT_DRAW_WIDTH)).toBe(DEFAULT_DRAW_WIDTH);
  });

  it('only accepts #rrggbb colours, and the palette and default comply', () => {
    expect(isDrawColor(DEFAULT_DRAW_COLOR)).toBe(true);
    for (const color of DRAW_COLORS) expect(isDrawColor(color)).toBe(true);
    for (const bad of ['red', '#fff', '#12345', '#1234567', ' #123456', '#12345g', ''])
      expect(isDrawColor(bad)).toBe(false);
  });
});

describe('freehand samples', () => {
  it('appends a finite point and never mutates the input', () => {
    const before = [{ x: 0, y: 0, z: 0 }];
    const after = appendDrawPoint(before, { x: 1, y: 0, z: 1 });
    expect(after).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ]);
    expect(before).toHaveLength(1);
  });

  it('drops a non-finite sample instead of poisoning the stroke', () => {
    const start = [{ x: 0, y: 0, z: 0 }];
    for (const bad of [
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
      { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
    ])
      expect(appendDrawPoint(start, bad)).toBe(start);
  });

  it('drops pointer noise within the epsilon and keeps a real move', () => {
    const start = [{ x: 1, y: 0, z: 1 }];
    expect(appendDrawPoint(start, { x: 1 + DRAW_POINT_EPSILON / 2, y: 0, z: 1 })).toBe(start);
    expect(appendDrawPoint(start, { x: 1, y: 0, z: 1 })).toBe(start);
    expect(appendDrawPoint(start, { x: 1 + DRAW_POINT_EPSILON * 5, y: 0, z: 1 })).toHaveLength(2);
  });

  it('caps a stroke at MAX_DRAW_POINTS', () => {
    expect(points).toHaveLength(MAX_DRAW_POINTS);
    expect(appendDrawPoint(points, { x: 99, y: 0, z: 99 })).toBe(points);
    const shorter = points.slice(0, MAX_DRAW_POINTS - 1);
    expect(appendDrawPoint(shorter, { x: 99, y: 0, z: 99 })).toHaveLength(MAX_DRAW_POINTS);
  });
});

describe('drawing payloads', () => {
  it('parses a well-formed stroke', () => {
    expect(DrawStrokeData.safeParse(stroke).success).toBe(true);
    expect(DrawStrokeData.safeParse({ ...stroke, phase: 'finished' }).success).toBe(true);
    expect(DrawStrokeData.safeParse({ ...stroke, points: points }).success).toBe(true);
  });

  it('rejects an unknown key, a bad colour, a bad phase and a non-ULID id', () => {
    expect(DrawStrokeData.safeParse({ ...stroke, op: 'stroke' }).success).toBe(false);
    expect(DrawStrokeData.safeParse({ ...stroke, color: 'red' }).success).toBe(false);
    expect(DrawStrokeData.safeParse({ ...stroke, phase: 'cancelled' }).success).toBe(false);
    expect(DrawStrokeData.safeParse({ ...stroke, strokeId: 'nope' }).success).toBe(false);
  });

  it('rejects widths, point counts and coordinates outside the contract', () => {
    for (const width of [DRAW_WIDTH_MIN / 2, DRAW_WIDTH_MAX * 2, 0, -1, Number.NaN])
      expect(DrawStrokeData.safeParse({ ...stroke, width }).success).toBe(false);
    expect(DrawStrokeData.safeParse({ ...stroke, points: [] }).success).toBe(false);
    expect(
      DrawStrokeData.safeParse({ ...stroke, points: [...points, { x: 9, y: 0, z: 9 }] }).success,
    ).toBe(false);
    for (const point of [
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
      { x: 0, y: 0 },
      { x: '0', y: 0, z: 0 },
    ])
      expect(DrawStrokeData.safeParse({ ...stroke, points: [point] }).success).toBe(false);
  });

  it('accepts the width the clamp produces for every raw input', () => {
    for (const raw of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, 0.5, 10])
      expect(DrawStrokeData.safeParse({ ...stroke, width: clampDrawWidth(raw) }).success).toBe(
        true,
      );
  });

  it('keeps erase and clear strictly shaped', () => {
    expect(DrawEraseData.safeParse({ sceneId: IDS.scene, strokeId: IDS.entity }).success).toBe(
      true,
    );
    expect(DrawClearData.safeParse({ sceneId: IDS.scene }).success).toBe(true);
    expect(DrawEraseData.safeParse({ sceneId: IDS.scene }).success).toBe(false);
    expect(DrawClearData.safeParse({ sceneId: IDS.scene, strokeId: IDS.entity }).success).toBe(
      false,
    );
    expect(DrawClearData.safeParse({ sceneId: 'nope' }).success).toBe(false);
  });
});

describe('drawing permissions (LAY-05)', () => {
  it('lets the author erase their own drawing and nobody else', () => {
    const state = makeCampaign();
    const author = { kind: 'seat', seatId: IDS.owner, identityId: IDS.identity } as const;
    expect(canEraseDrawing(state, author, IDS.identity)).toBe(true);
    expect(canEraseDrawing(state, ACTORS.owner, IDS.identity)).toBe(false);
    expect(canEraseDrawing(state, ACTORS.otherSeat, IDS.identity)).toBe(false);
    expect(canEraseDrawing(state, ACTORS.spectator, IDS.identity)).toBe(false);
    expect(canEraseDrawing(state, ACTORS.mod, IDS.identity)).toBe(false);
  });

  it('lets the DM and a co-DM erase any drawing, but nothing erases an unknown owner', () => {
    const state = makeCampaign();
    expect(canEraseDrawing(state, ACTORS.host, IDS.identity)).toBe(true);
    expect(canEraseDrawing(state, ACTORS.coDm, IDS.identity)).toBe(true);
    expect(canEraseDrawing(state, ACTORS.host, undefined)).toBe(true);
    expect(canEraseDrawing(state, ACTORS.owner, undefined)).toBe(false);
  });

  it('lets only the DM or a co-DM clear every drawing', () => {
    const state = makeCampaign();
    expect(canClearDrawings(state, ACTORS.host)).toBe(true);
    expect(canClearDrawings(state, ACTORS.coDm)).toBe(true);
    expect(canClearDrawings(state, ACTORS.owner)).toBe(false);
    expect(canClearDrawings(state, ACTORS.otherSeat)).toBe(false);
    expect(canClearDrawings(state, ACTORS.spectator)).toBe(false);
    expect(canClearDrawings(state, ACTORS.mod)).toBe(false);
  });
});
