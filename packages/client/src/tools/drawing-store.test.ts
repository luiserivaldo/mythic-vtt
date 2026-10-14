import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAW_COLOR, DEFAULT_DRAW_WIDTH, DRAW_WIDTH_MAX } from '@mythic/shared';
import { MAX_SCENE_STROKES, MAX_STROKE_SCENES, type DrawStroke } from './drawing.js';
import { boundStrokes, drawingStore } from './drawing-store.js';

function stroke(at: number, sceneId = 'scene', strokeId?: string): DrawStroke {
  return {
    sceneId,
    strokeId: strokeId ?? String(at).padStart(26, '0'),
    from: 'me',
    color: DEFAULT_DRAW_COLOR,
    width: DEFAULT_DRAW_WIDTH,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    phase: 'finished',
    at,
  };
}

describe('drawing store (LAY-05)', () => {
  it('starts on the default colour and width with no drawings', () => {
    const state = drawingStore.getState();
    expect(state.color).toBe(DEFAULT_DRAW_COLOR);
    expect(state.width).toBe(DEFAULT_DRAW_WIDTH);
    expect(state.erase).toBe(false);
    expect(state.strokes).toEqual([]);
  });

  it('clamps the width and ignores a colour the wire would reject', () => {
    drawingStore.getState().setWidth(DRAW_WIDTH_MAX * 5);
    expect(drawingStore.getState().width).toBe(DRAW_WIDTH_MAX);
    drawingStore.getState().setWidth(Number.NaN);
    expect(drawingStore.getState().width).toBe(DEFAULT_DRAW_WIDTH);
    drawingStore.getState().setColor('red');
    expect(drawingStore.getState().color).toBe(DEFAULT_DRAW_COLOR);
    drawingStore.getState().setColor('#00ff00');
    expect(drawingStore.getState().color).toBe('#00ff00');
  });

  it('replaces a stroke in place while it is being drawn', () => {
    const first = stroke(1);
    drawingStore.getState().upsert(first);
    drawingStore.getState().upsert(stroke(2));
    drawingStore.getState().upsert({ ...first, points: [{ x: 5, y: 0, z: 5 }], at: 3 });
    expect(drawingStore.getState().strokes).toHaveLength(2);
    const stored = drawingStore.getState().strokes.find((s) => s.strokeId === first.strokeId);
    expect(stored?.at).toBe(3);
    expect(stored?.points).toEqual([{ x: 5, y: 0, z: 5 }]);
  });

  it('removes one drawing and clears a whole scene', () => {
    drawingStore.getState().clearScene('scene');
    drawingStore.getState().upsert(stroke(1));
    drawingStore.getState().upsert(stroke(2, 'other'));
    drawingStore.getState().upsert(stroke(3));
    drawingStore.getState().remove(stroke(3).strokeId);
    expect(drawingStore.getState().strokes.map((s) => s.at)).toEqual([1, 2]);
    drawingStore.getState().clearScene('scene');
    expect(drawingStore.getState().strokes.map((s) => s.at)).toEqual([2]);
    drawingStore.getState().clearScene('other');
    expect(drawingStore.getState().strokes).toEqual([]);
  });
});

describe('bounded local memory', () => {
  it('keeps the newest drawings of a scene and drops the oldest', () => {
    const strokes = Array.from({ length: MAX_SCENE_STROKES + 3 }, (_, index) => stroke(index));
    const bounded = boundStrokes(strokes);
    expect(bounded).toHaveLength(MAX_SCENE_STROKES);
    expect(bounded[0]?.at).toBe(3);
    expect(bounded.at(-1)?.at).toBe(MAX_SCENE_STROKES + 2);
  });

  it('never mixes scenes: each gets its own allowance', () => {
    const strokes = [
      ...Array.from({ length: MAX_SCENE_STROKES }, (_, index) => stroke(index, 'a')),
      ...Array.from({ length: MAX_SCENE_STROKES }, (_, index) => stroke(index, 'b')),
    ];
    expect(boundStrokes(strokes)).toHaveLength(MAX_SCENE_STROKES * 2);
  });

  it('forgets the scene that has not been drawn on for longest', () => {
    const strokes = [
      ...Array.from({ length: MAX_STROKE_SCENES + 1 }, (_, index) =>
        stroke(index, `scene-${String(index)}`),
      ),
      stroke(MAX_STROKE_SCENES + 5, 'scene-0'),
    ];
    const bounded = boundStrokes(strokes);
    expect(new Set(bounded.map((s) => s.sceneId)).size).toBe(MAX_STROKE_SCENES);
    // scene-0 keeps both of its own drawings: the allowance is per scene, only scenes are dropped.
    expect(bounded.filter((s) => s.sceneId === 'scene-0')).toHaveLength(2);
    // scene-1 was the oldest scene before scene-0 was drawn on again, so it goes first.
    expect(bounded.some((s) => s.sceneId === 'scene-1')).toBe(false);
  });
});
