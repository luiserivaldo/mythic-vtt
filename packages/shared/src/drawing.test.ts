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
  DRAW_COORD_LIMIT,
  DRAW_ERASE_CHANNEL,
  DRAW_POINT_DECIMALS,
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
  MAX_STROKE_SAMPLES,
  normaliseDrawPoint,
  simplifyDrawPoints,
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

  it('names the channels the wire and the seat-tool gate both use', () => {
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

  it('quantises a sample to the wire precision, so a raw pointer hit cannot inflate the frame', () => {
    expect(DRAW_POINT_DECIMALS).toBe(3);
    expect(normaliseDrawPoint({ x: 1.23456, y: 0, z: -2.99999 })).toEqual({
      x: 1.235,
      y: 0,
      z: -3,
    });
    // Rounding towards zero must not leave a negative zero behind.
    expect(normaliseDrawPoint({ x: -0.0001, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(appendDrawPoint([], { x: 5.300000000000001, y: 0, z: 7.7777 })).toEqual([
      { x: 5.3, y: 0, z: 7.778 },
    ]);
  });

  it('clamps a sample to the drawing domain and refuses a non-finite one', () => {
    expect(DRAW_COORD_LIMIT).toBeGreaterThan(200);
    expect(normaliseDrawPoint({ x: DRAW_COORD_LIMIT * 3, y: -DRAW_COORD_LIMIT * 3, z: 0 })).toEqual(
      { x: DRAW_COORD_LIMIT, y: -DRAW_COORD_LIMIT, z: 0 },
    );
    for (const bad of [
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
      { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
    ])
      expect(normaliseDrawPoint(bad)).toBeNull();
  });

  it('caps one local gesture at MAX_STROKE_SAMPLES, ready to be simplified for the wire', () => {
    expect(MAX_STROKE_SAMPLES).toBeGreaterThan(MAX_DRAW_POINTS);
    const raw = Array.from({ length: MAX_STROKE_SAMPLES }, (_, index) => ({
      x: index / 10,
      y: 0,
      z: 0,
    }));
    expect(raw).toHaveLength(MAX_STROKE_SAMPLES);
    expect(appendDrawPoint(raw, { x: 99, y: 0, z: 99 })).toBe(raw);
    expect(appendDrawPoint(raw.slice(0, -1), { x: 99, y: 0, z: 99 })).toHaveLength(
      MAX_STROKE_SAMPLES,
    );
  });

  it('always hands the wire a stroke its own schema accepts', () => {
    let raw: readonly { x: number; y: number; z: number }[] = [];
    for (let index = 0; index < MAX_STROKE_SAMPLES * 2; index += 1)
      raw = appendDrawPoint(raw, { x: (index % 50) + 0.123456, y: -0.5, z: index * 0.05 });
    expect(raw).toHaveLength(MAX_STROKE_SAMPLES);
    const wire = simplifyDrawPoints(raw, MAX_DRAW_POINTS);
    expect(wire.length).toBeLessThanOrEqual(MAX_DRAW_POINTS);
    expect(DrawStrokeData.safeParse({ ...stroke, points: wire }).success).toBe(true);
  });
});

describe('simplifying a long gesture for the wire (LAY-05)', () => {
  const diagonal = Array.from({ length: 200 }, (_, index) => ({
    x: index / 100,
    y: 0,
    z: index / 100,
  }));

  it('keeps the gesture untouched while it is already within the budget', () => {
    const raw = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    expect(simplifyDrawPoints(raw, 8)).toEqual(raw);
    expect(simplifyDrawPoints(raw, raw.length)).toEqual(raw);
  });

  it('drops the straight runs and keeps the corner of an L-shaped gesture', () => {
    const raw = [
      ...Array.from({ length: 41 }, (_, index) => ({ x: index / 10, y: 0, z: 0 })),
      ...Array.from({ length: 40 }, (_, index) => ({ x: 4, y: 0, z: (index + 1) / 10 })),
    ];
    const simplified = simplifyDrawPoints(raw, 3);
    expect(simplified).toHaveLength(3);
    expect(simplified[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(simplified[1]).toEqual({ x: 4, y: 0, z: 0 });
    expect(simplified[2]).toEqual({ x: 4, y: 0, z: 4 });
  });

  it('never exceeds the budget and always keeps the first and the last sample', () => {
    const zigzag = Array.from({ length: 500 }, (_, index) => ({
      x: index / 10,
      y: 0,
      z: index % 2 === 0 ? 0 : 0.5,
    }));
    const simplified = simplifyDrawPoints(zigzag, MAX_DRAW_POINTS);
    expect(simplified.length).toBe(MAX_DRAW_POINTS);
    expect(simplified[0]).toEqual(zigzag[0]);
    expect(simplified.at(-1)).toEqual(zigzag.at(-1));
    // A budget of two keeps only the ends: a straight gesture needs nothing else.
    expect(simplifyDrawPoints(diagonal, 2)).toEqual([diagonal[0], diagonal.at(-1)]);
  });

  it('handles an empty gesture and a degenerate budget', () => {
    const raw = diagonal.slice(0, 10);
    expect(simplifyDrawPoints([], 8)).toEqual([]);
    expect(simplifyDrawPoints(raw, 0)).toEqual([]);
    expect(simplifyDrawPoints(raw, -5)).toEqual([]);
    expect(simplifyDrawPoints(raw, 1)).toEqual([raw[0]]);
    expect(simplifyDrawPoints(raw, 1.7)).toEqual([raw[0]]);
  });

  it('never mutates the gesture it simplifies', () => {
    const raw = diagonal.slice(0, 20);
    const before = raw.map((point) => ({ ...point }));
    simplifyDrawPoints(raw, 3);
    expect(raw).toEqual(before);
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

  it('rejects a sample outside the drawing domain the client clamps to', () => {
    for (const bad of [
      { x: DRAW_COORD_LIMIT + 1, y: 0, z: 0 },
      { x: 0, y: -DRAW_COORD_LIMIT - 1, z: 0 },
      { x: 0, y: 0, z: DRAW_COORD_LIMIT + 1 },
    ])
      expect(DrawStrokeData.safeParse({ ...stroke, points: [bad] }).success).toBe(false);
    expect(
      DrawStrokeData.safeParse({
        ...stroke,
        points: [{ x: DRAW_COORD_LIMIT, y: -DRAW_COORD_LIMIT, z: 0 }],
      }).success,
    ).toBe(true);
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
