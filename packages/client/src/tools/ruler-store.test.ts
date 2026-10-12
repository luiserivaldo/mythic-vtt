import { beforeEach, describe, expect, it } from 'vitest';
import type { Grid } from '@mythic/shared';
import { rulerStore } from './ruler-store.js';
import { MAX_RULER_POINTS, measureRuler, withCursor } from './ruler.js';

const point = (x: number) => ({ x, y: 0, z: 0 });

const grid: Grid = {
  type: 'square',
  sizePx: 70,
  unitsPerCell: 5,
  unitLabel: 'ft',
  diagonal: 'alternating',
  snap: true,
};

const at = (x: number, z: number) => ({ x, y: 0, z });

beforeEach(() => {
  const state = rulerStore.getState();
  state.setTool(false);
  state.setPersistent(false);
  for (const sender of Object.keys(state.remote)) state.setRemote(sender, null);
});

describe('ruler interaction state (M1-41)', () => {
  it('keeps the Persistent preference when a ruler is cleared or the tool is disarmed', () => {
    const state = rulerStore.getState();
    state.setPersistent(true);
    state.setTool(true);
    state.begin('scene', point(1));
    state.setPoints([point(1), point(2)]);
    state.finish();
    state.clear();

    expect(rulerStore.getState()).toMatchObject({ persistent: true, phase: 'idle', points: [] });

    rulerStore.getState().setTool(false);
    expect(rulerStore.getState().persistent).toBe(true);
  });

  it("replaces one sender's ruler without removing another sender's ruler", () => {
    const first = {
      sceneId: 'scene',
      points: [point(1), point(2)],
      phase: 'finished' as const,
      at: 1,
    };
    const replacement = {
      sceneId: 'scene',
      points: [point(3), point(4)],
      phase: 'active' as const,
      at: 2,
    };
    const other = {
      sceneId: 'scene',
      points: [point(5), point(6)],
      phase: 'finished' as const,
      at: 1,
    };

    rulerStore.getState().setRemote('aria', first);
    rulerStore.getState().setRemote('borin', other);
    rulerStore.getState().setRemote('aria', replacement);

    expect(rulerStore.getState().remote).toEqual({ borin: other, aria: replacement });
  });
});

describe('ruler waypoint state (M1-45, MEAS-08)', () => {
  beforeEach(() => {
    const state = rulerStore.getState();
    state.setTool(false);
    state.clear();
  });

  it('keeps measuring cumulatively from the committed waypoint', () => {
    const state = rulerStore.getState();
    state.setTool(true);
    state.begin('scene', at(0.5, 0.5));
    state.addWaypoint(at(6.5, 0.5));
    state.setCursor(at(6.5, 6.5));

    const live = rulerStore.getState();
    expect(live).toMatchObject({ phase: 'active', cursor: at(6.5, 6.5) });
    expect(live.points).toEqual([at(0.5, 0.5), at(6.5, 0.5)]);

    const measured = measureRuler(withCursor(live.points, live.cursor), grid);
    expect(measured.segments.map((segment) => segment.cells)).toEqual([6, 6]);
    expect(measured.totalLabel).toBe('60 ft');
    // The straight start→cursor line would be 45 ft, so the waypoint really bent the path.
    expect(measureRuler([at(0.5, 0.5), at(6.5, 6.5)], grid).totalCells).toBe(9);
  });

  it('ignores a repeated or non-finite waypoint and leaves the cursor on the last waypoint', () => {
    const state = rulerStore.getState();
    state.setTool(true);
    state.begin('scene', at(0, 0));
    state.addWaypoint(at(3, 0));
    state.addWaypoint(at(3, 0));

    expect(rulerStore.getState().points).toEqual([at(0, 0), at(3, 0)]);
    expect(rulerStore.getState().cursor).toEqual(at(3, 0));

    state.addWaypoint({ x: Number.NaN, y: 0, z: 0 });
    state.addWaypoint({ x: 0, y: 0, z: Number.POSITIVE_INFINITY });
    state.addWaypoint({ x: Number.NEGATIVE_INFINITY, y: 0, z: 3 });

    const live = rulerStore.getState();
    expect(live.points).toEqual([at(0, 0), at(3, 0)]);
    expect(live.cursor).toEqual(at(3, 0));
    expect(measureRuler(withCursor(live.points, live.cursor), grid).totalLabel).toBe('15 ft');
  });

  it('refuses a waypoint when the tool is idle or the path is already finished', () => {
    const state = rulerStore.getState();
    state.addWaypoint(at(3, 0));
    expect(rulerStore.getState()).toMatchObject({ phase: 'idle', points: [], cursor: null });

    state.setTool(true);
    state.begin('scene', at(0, 0));
    state.addWaypoint(at(3, 0));
    state.finish();
    state.addWaypoint(at(6, 0));

    expect(rulerStore.getState()).toMatchObject({
      phase: 'finished',
      points: [at(0, 0), at(3, 0)],
      cursor: null,
    });
  });

  it('caps the waypoint path at MAX_RULER_POINTS however often the right button is clicked', () => {
    const state = rulerStore.getState();
    state.setTool(true);
    state.begin('scene', at(0, 0));
    for (let x = 1; x < MAX_RULER_POINTS + 10; x += 1) state.addWaypoint(at(x, 0));

    const live = rulerStore.getState();
    expect(live.points).toHaveLength(MAX_RULER_POINTS);
    expect(live.points[MAX_RULER_POINTS - 1]).toEqual(at(MAX_RULER_POINTS - 1, 0));
    expect(live.cursor).toEqual(at(MAX_RULER_POINTS + 9, 0));
  });
});
