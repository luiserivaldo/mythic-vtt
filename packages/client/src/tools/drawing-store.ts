import {
  clampDrawWidth,
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  isDrawColor,
} from '@mythic/shared';
import { createStore } from 'zustand/vanilla';
import { MAX_SCENE_STROKES, MAX_STROKE_SCENES, type DrawStroke } from './drawing.js';

// LAY-05: render-local drawing state. Drawings are ephemeral, so this store is the only place
// they exist on a client: nothing here is persisted, and nothing here is ever sent as an action.

/**
 * Keeps the newest drawings of every scene, with one allowance per scene, so a long session
 * cannot grow the local list without bound. What is dropped is only local: the relaid drawings
 * come back to anyone who still has them, and the host's own table is bounded the same way.
 */
export function boundStrokes(strokes: readonly DrawStroke[]): DrawStroke[] {
  const perScene = new Map<string, number>();
  const kept: DrawStroke[] = [];
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index];
    if (!stroke) continue;
    const used = perScene.get(stroke.sceneId) ?? 0;
    if (used >= MAX_SCENE_STROKES) continue;
    perScene.set(stroke.sceneId, used + 1);
    kept.push(stroke);
  }
  kept.reverse();
  if (perScene.size <= MAX_STROKE_SCENES) return kept;
  const newest = new Map<string, number>();
  for (const stroke of kept) {
    newest.set(stroke.sceneId, Math.max(newest.get(stroke.sceneId) ?? 0, stroke.at));
  }
  const forgotten = [...newest.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, newest.size - MAX_STROKE_SCENES)
    .map(([sceneId]) => sceneId);
  const drop = new Set(forgotten);
  return kept.filter((stroke) => !drop.has(stroke.sceneId));
}

interface DrawingState {
  /** Drawer preferences: the colour and the scene-unit width of the next stroke. */
  color: string;
  width: number;
  /** The eraser is armed, so the next click on an erasable drawing removes it. */
  erase: boolean;
  /** Every drawing this client holds, mine and other clients'. */
  strokes: readonly DrawStroke[];
  setColor(color: string): void;
  setWidth(width: number): void;
  setErase(erase: boolean): void;
  /** Adds a drawing, or replaces the one with the same id while it is still being drawn. */
  upsert(stroke: DrawStroke): void;
  remove(strokeId: string): void;
  /** Drops one scene's drawings, e.g. when the DM clears the board. */
  clearScene(sceneId: string): void;
}

export const drawingStore = createStore<DrawingState>()((set) => ({
  color: DEFAULT_DRAW_COLOR,
  width: DEFAULT_DRAW_WIDTH,
  erase: false,
  strokes: [],
  setColor: (color) => {
    if (isDrawColor(color)) set({ color });
  },
  setWidth: (width) => {
    set({ width: clampDrawWidth(width) });
  },
  setErase: (erase) => {
    set({ erase });
  },
  upsert: (stroke) => {
    set((state) => ({
      strokes: boundStrokes([
        ...state.strokes.filter((current) => current.strokeId !== stroke.strokeId),
        stroke,
      ]),
    }));
  },
  remove: (strokeId) => {
    set((state) => ({
      strokes: state.strokes.filter((stroke) => stroke.strokeId !== strokeId),
    }));
  },
  clearScene: (sceneId) => {
    set((state) => ({
      strokes: state.strokes.filter((stroke) => stroke.sceneId !== sceneId),
    }));
  },
}));
