import { LayerId, type Entity, type Scene } from '@mythic/shared';

export const LAYER_ORDER: readonly LayerId[] = LayerId.options;

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
  locked: boolean;
  hidden: boolean;
}

/** `hidden` is a local view setting, not game state, so it never becomes an action. */
export function layerRows(scene: Scene, hidden: ReadonlySet<LayerId>): LayerRow[] {
  return LAYER_ORDER.map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    locked: scene.layers[layer]?.locked ?? false,
    hidden: hidden.has(layer),
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
