import { z } from 'zod';
import { createStore } from 'zustand/vanilla';
import type { KeyValueStore } from '../net/identity.js';

export const ViewerPreferences = z.strictObject({
  showHeightLabels: z.boolean(),
  confirmBeforeDeleting: z.boolean(),
});
export type ViewerPreferences = z.infer<typeof ViewerPreferences>;
export const DEFAULT_VIEWER_PREFERENCES: ViewerPreferences = {
  showHeightLabels: true,
  confirmBeforeDeleting: true,
};
export const viewerPreferencesKey = (viewerId: string): string =>
  `mythic.viewer-settings.v1:${encodeURIComponent(viewerId)}`;

export function loadViewerPreferences(storage: KeyValueStore, viewerId: string): ViewerPreferences {
  try {
    const parsed = ViewerPreferences.safeParse(
      JSON.parse(storage.getItem(viewerPreferencesKey(viewerId)) ?? 'null'),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Browser storage is optional; malformed or unavailable settings keep safe defaults.
  }
  return { ...DEFAULT_VIEWER_PREFERENCES };
}

export function createViewerPreferencesStore(storage: KeyValueStore, viewerId: string) {
  return createStore<{
    preferences: ViewerPreferences;
    update: (patch: Partial<ViewerPreferences>) => void;
  }>()((set, get) => ({
    preferences: loadViewerPreferences(storage, viewerId),
    update: (patch) => {
      const preferences = ViewerPreferences.parse({ ...get().preferences, ...patch });
      set({ preferences });
      try {
        storage.setItem(viewerPreferencesKey(viewerId), JSON.stringify(preferences));
      } catch {
        // The current viewer can still change preferences when persistence is unavailable.
      }
    },
  }));
}
