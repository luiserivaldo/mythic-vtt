import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { Scene } from '@mythic/shared';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { placeDraft } from '../tools/aoe-placement.js';
import { selectionStore } from '../tools/selection-store.js';
import { useUiStore } from '../ui/ui-store.js';
import {
  deriveAoEHighlights,
  type AoEHighlightOverride,
  type AoEHighlightResult,
} from './aoe-highlight.js';

const EMPTY_RESULT: AoEHighlightResult = { cells: [], tokenIds: [], tokenNames: [], aoeCount: 0 };

/** Shares the same derivation between the WebGL overlay and the compact HTML list. */
export function useAoEHighlights(scene: Scene | null): AoEHighlightResult {
  const active = useStore(aoeToolStore, (state) => state.active);
  const editingEntityId = useStore(aoeToolStore, (state) => state.editingEntityId);
  const draft = useStore(aoeToolStore, (state) => state.draft);
  const preview = useStore(aoeToolStore, (state) => state.preview);
  const selected = useStore(selectionStore, (state) => state.ids);
  const hiddenLayers = useUiStore((state) => state.hiddenLayers);

  return useMemo(() => {
    if (!scene) return EMPTY_RESULT;
    let override: AoEHighlightOverride | null = null;
    if (active) {
      // Pointer motion owns position/yaw while the form owns shape/size, so either input updates live.
      const effective = preview
        ? { ...draft, x: preview.x, z: preview.z, degrees: preview.degrees }
        : draft;
      const { shape, transform } = placeDraft(effective, scene);
      override = { aoe: { ...shape, position: transform.position, rotation: transform.rotation } };
    } else if (
      editingEntityId !== null &&
      selected.includes(editingEntityId) &&
      scene.entities[editingEntityId]?.aoe
    ) {
      const { shape, transform } = placeDraft(draft, scene);
      override = {
        entityId: editingEntityId,
        aoe: { ...shape, position: transform.position, rotation: transform.rotation },
      };
    }
    return deriveAoEHighlights(scene, { hiddenLayers, override });
  }, [scene, active, editingEntityId, draft, preview, selected, hiddenLayers]);
}
