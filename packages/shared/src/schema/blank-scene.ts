import { DEFAULT_SCENE_BACKGROUND, type Scene } from './scene.js';

/** Deterministic bootstrap/migration ID, scoped by the campaign's scenes dictionary. */
export function blankScene(campaignId: string): Scene {
  return {
    id: campaignId,
    name: 'Blank scene',
    dmOnly: false,
    grid: {
      type: 'square',
      sizePx: 70,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'alternating',
      snap: true,
    },
    environment: { background: DEFAULT_SCENE_BACKGROUND },
    layers: {},
    entities: {},
  };
}
