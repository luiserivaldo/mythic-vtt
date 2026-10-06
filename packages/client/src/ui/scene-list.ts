import type { Campaign } from '@mythic/shared';

export interface SceneRow {
  id: string;
  name: string;
  active: boolean;
}

export function sceneRows(campaign: Campaign): SceneRow[] {
  return Object.values(campaign.scenes)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((scene) => ({
      id: scene.id,
      name: scene.name,
      active: scene.id === campaign.activeSceneId,
    }));
}

/** Names are required, trimmed and at most 120 characters (scene.create / scene.rename). */
export const isValidSceneName = (text: string): boolean => {
  const t = text.trim();
  return t.length >= 1 && t.length <= 120;
};
