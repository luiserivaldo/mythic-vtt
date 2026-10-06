import {
  DEFAULT_SCENE_HEIGHT,
  DEFAULT_SCENE_WIDTH,
  MAX_SCENE_CELLS,
  resolveSceneBounds,
  type Campaign,
  type SceneBounds,
} from '@mythic/shared';

export interface BoundsDraft {
  width: string;
  height: string;
}

/** Defaults shown in the create form (D37). */
export const DEFAULT_BOUNDS_DRAFT: BoundsDraft = {
  width: String(DEFAULT_SCENE_WIDTH),
  height: String(DEFAULT_SCENE_HEIGHT),
};

/** Stable per-scene draft; an unknown scene gives the defaults. */
export function boundsDraft(campaign: Campaign, sceneId: string): BoundsDraft {
  const scene = campaign.scenes[sceneId];
  if (!scene) return DEFAULT_BOUNDS_DRAFT;
  const b = resolveSceneBounds(scene);
  return { width: String(b.width), height: String(b.height) };
}

const parseCells = (text: string): number | null => {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_SCENE_CELLS ? n : null;
};

export const isValidCells = (text: string): boolean => parseCells(text) !== null;

/** Whole cells 1..200 on both axes, or null when either field is invalid. */
export function parseBoundsDraft(d: BoundsDraft): SceneBounds | null {
  const width = parseCells(d.width);
  const height = parseCells(d.height);
  return width === null || height === null ? null : { width, height };
}
