import type { StoreApi } from 'zustand/vanilla';
import type { Entity } from '@mythic/shared';
import type { IntentResult } from '../net/intents.js';
import { describeFailure } from '../ui/submit.js';
import type { gizmoStore } from './gizmo-store.js';
import { buildTransform, sameTransform, type GizmoDraft } from './transform-gizmo.js';

type GizmoStore = StoreApi<ReturnType<typeof gizmoStore.getState>>;
export type Submit = (type: string, payload: unknown, sceneId?: string) => Promise<IntentResult>;

/**
 * Commit a transform as ONE `entity.update` intent (release or Enter). M1-35 keeps token sizing
 * in `token.sizeCells`; transform scale remains the source for every other entity. Nothing is
 * applied optimistically: on reject the preview is dropped so the entity shows the host's state
 * again (D34: server order wins).
 */
export async function commitTransform(args: {
  submit: Submit;
  store: GizmoStore;
  sceneId: string;
  entity: Entity;
  draft: GizmoDraft;
}): Promise<boolean> {
  const { submit, store, sceneId, entity, draft } = args;
  const state = store.getState();
  if (state.busy) return false;
  const transform = buildTransform(
    entity.transform,
    entity.token ? { ...draft, scale: entity.transform.scale.x } : draft,
  );
  const transformChanged = !sameTransform(transform, entity.transform);
  const tokenChanged = entity.token !== undefined && draft.scale !== entity.token.sizeCells;
  if (!transformChanged && !tokenChanged) {
    state.clear();
    return true;
  }
  const changes = {
    ...(transformChanged ? { transform } : {}),
    ...(tokenChanged && entity.token ? { token: { ...entity.token, sizeCells: draft.scale } } : {}),
  };
  state.setBusy(true);
  state.setError(null);
  try {
    const result = await submit(
      'entity.update',
      { sceneId, entityId: entity.id, changes },
      sceneId,
    );
    if (result.ok) {
      store.getState().settle();
      return true;
    }
    store.getState().clear();
    store.getState().setError(describeFailure(result));
    return false;
  } finally {
    store.getState().setBusy(false);
  }
}
