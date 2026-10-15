import type { AssetRef, Campaign, Scene } from '@mythic/shared';

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

export interface SceneFolderGroup {
  /** null = scenes that are not in any folder. */
  folder: string | null;
  rows: SceneRow[];
}

/** UI-SCN-01: scenes grouped by folder, unfiled first, then folders alphabetically. */
export function sceneFolders(campaign: Campaign): SceneFolderGroup[] {
  const groups = new Map<string | null, SceneRow[]>();
  for (const row of sceneRows(campaign)) {
    const folder = campaign.scenes[row.id]?.folder ?? null;
    groups.set(folder, [...(groups.get(folder) ?? []), row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([folder, rows]) => ({ folder, rows }));
}

/** Every folder name in use, for the folder field's suggestions. */
export const folderNames = (campaign: Campaign): string[] =>
  sceneFolders(campaign).flatMap((g) => (g.folder === null ? [] : [g.folder]));

/** UI-SCN-01: the card preview is the scene's first battlemap image, if it has one. */
export function scenePreviewAsset(scene: Scene): AssetRef | null {
  const maps = Object.values(scene.entities)
    .filter((e) => e.layer === 'map' && e.image)
    .sort((a, b) => a.id.localeCompare(b.id));
  return maps[0]?.image?.asset ?? null;
}

/** Names are required, trimmed and at most 120 characters (scene.create / scene.rename). */
export const isValidSceneName = (text: string): boolean => {
  const t = text.trim();
  return t.length >= 1 && t.length <= 120;
};

/** Folder names are optional; when given, trimmed and at most 64 characters (SceneFolder). */
export const isValidFolder = (text: string): boolean => text.trim().length <= 64;
