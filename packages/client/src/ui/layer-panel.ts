import { LayerId, type Entity, type Scene } from '@mythic/shared';
import { RENDER_LAYERS, layerRenderBand } from '../render/scene-model.js';
import { isAdminRole, type ViewerRole } from './viewer.js';

export const LAYER_ORDER: readonly LayerId[] = LayerId.options;

/** UI-LAY-01: one active layer per viewer; new tokens and props start there. */
export const DEFAULT_ACTIVE_LAYER: LayerId = 'tokens';

/**
 * UI-LAY-01: rows run top to bottom by draw order — the top row draws above the rows beneath it.
 * Bands come from the renderer (§6.4), so the tab cannot drift from what is actually drawn; a tie
 * inside one band keeps the canonical layer order.
 */
export const LAYER_ROWS: readonly LayerId[] = [...LAYER_ORDER].sort(
  (a, b) =>
    RENDER_LAYERS.indexOf(layerRenderBand(b)) - RENDER_LAYERS.indexOf(layerRenderBand(a)) ||
    LAYER_ORDER.indexOf(a) - LAYER_ORDER.indexOf(b),
);

const LAYER_LABELS: Record<LayerId, string> = {
  map: 'Map',
  props: 'Props',
  tokens: 'Tokens',
  dm: 'DM only',
  effects: 'Effects',
};

export interface LayerRow {
  layer: LayerId;
  label: string;
  description?: string;
  locked: boolean;
  hidden: boolean;
  active: boolean;
  /** null when this viewer may lock the layer, else why not. */
  lockDisabledReason: string | null;
}

/** The viewer-local parts of the panel: the role comes from the host, the active layer never does. */
export interface LayerView {
  role: ViewerRole;
  activeLayer: LayerId;
}

/** LAY-04: the DM layer exists for the host and co-DM seats only. */
export function canSeeLayer(role: ViewerRole, layer: LayerId): boolean {
  return layer !== 'dm' || isAdminRole(role);
}

/**
 * LAY-06 / D32: locking is admin-only, and host-only on the DM layer (shared `isAdminOn`). A viewer
 * who may not lock is shown the control disabled with a reason, never without it.
 */
export function lockDisabledReason(role: ViewerRole, layer: LayerId): string | null {
  if (role === 'host') return null;
  if (role === 'codm') return layer === 'dm' ? 'Only the game host can lock this layer.' : null;
  return 'Only a DM can lock layers.';
}

/** `hidden` and `active` are local view settings, not game state, so they never become actions. */
export function layerRows(scene: Scene, hidden: ReadonlySet<LayerId>, view: LayerView): LayerRow[] {
  return LAYER_ROWS.filter((layer) => canSeeLayer(view.role, layer)).map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    ...(layer === 'map'
      ? { description: 'Battlemap images, ground, terrain and fixed objects' }
      : {}),
    locked: scene.layers[layer]?.locked ?? false,
    hidden: hidden.has(layer),
    active: layer === view.activeLayer,
    lockDisabledReason: lockDisabledReason(view.role, layer),
  }));
}

export interface MoveTarget {
  layer: LayerId;
  label: string;
  /** Why the host would refuse it (entity.setLayer rejects when either layer is locked). */
  disabledReason: string | null;
}

export function moveTargets(scene: Scene, entity: Entity): MoveTarget[] {
  const sourceLocked = scene.layers[entity.layer]?.locked ?? false;
  return LAYER_ORDER.filter((layer) => layer !== entity.layer).map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    disabledReason: sourceLocked
      ? `${LAYER_LABELS[entity.layer]} is locked`
      : scene.layers[layer]?.locked
        ? `${LAYER_LABELS[layer]} is locked`
        : null,
  }));
}

export function toggleHidden(hidden: ReadonlySet<LayerId>, layer: LayerId): Set<LayerId> {
  const next = new Set(hidden);
  if (!next.delete(layer)) next.add(layer);
  return next;
}
