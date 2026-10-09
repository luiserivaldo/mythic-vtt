import { beforeEach, describe, expect, it } from 'vitest';
import { rulerStore } from './ruler-store.js';

const point = (x: number) => ({ x, y: 0, z: 0 });

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
