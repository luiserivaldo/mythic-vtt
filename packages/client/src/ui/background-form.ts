import type { Campaign } from '@mythic/shared';
import { DEFAULT_BACKGROUND, isValidColor, resolveColor } from '../render/skybox-model.js';

export interface BackgroundDraft {
  background: string;
  /** Empty string means no gradient. */
  zenith: string;
}

/** Stable per-scene values for the form; unknown scene gives defaults. */
export function backgroundDraft(campaign: Campaign, sceneId: string): BackgroundDraft {
  const env = campaign.scenes[sceneId]?.environment;
  return {
    background: resolveColor(env?.background, DEFAULT_BACKGROUND),
    zenith: env?.zenith ? resolveColor(env.zenith, '') : '',
  };
}

export const isValidBackgroundDraft = (d: BackgroundDraft): boolean =>
  isValidColor(d.background) && (d.zenith === '' || isValidColor(d.zenith));
