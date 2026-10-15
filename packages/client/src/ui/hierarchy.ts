import type { Campaign, LayerId, Scene } from '@mythic/shared';
import { focusedLayer, isOffFocus } from '../render/layer-visibility.js';
import { canSelect, type SelectionActor } from '../tools/selection.js';
import { entityRows, LAYER_LABELS } from './entity-panel.js';
import { canSeeLayer, LAYER_ROWS } from './layer-panel.js';
import type { ViewerRole } from './viewer.js';

// UI-ENT-01 (MV-245): the 3D edit-mode hierarchy, a file explorer of every object in the scene
// grouped by layer. It is a view over the DM's own snapshot: nothing here is sent or stored.

export interface HierarchyRow {
  id: string;
  name: string;
  /** "Token", "Box", "Image"… as in the Tokens tab. */
  kind: string;
  /** A prop (primitive shape): its popup also offers the collidable toggle (UI-TOKEN-05). */
  prop: boolean;
  /**
   * MV-244/MV-258: shaded like the board when its layer is off the active layer or hidden here.
   * The map layer is exempt from the active-layer shade, as on the board.
   */
  dimmed: boolean;
  /** Exactly what a click on the board could pick: not dimmed, and allowed by `canSelect`. */
  selectable: boolean;
  /** null when selectable, else why not (shown as the row's tooltip). */
  reason: string | null;
}

export interface HierarchyGroup {
  layer: LayerId;
  label: string;
  active: boolean;
  locked: boolean;
  hidden: boolean;
  rows: HierarchyRow[];
}

export interface HierarchyView {
  role: ViewerRole;
  actor: SelectionActor;
  activeLayer: LayerId;
  hiddenLayers: ReadonlySet<LayerId>;
}

function rowState(
  scene: Scene,
  id: string,
  layer: LayerId,
  view: HierarchyView,
  focus: LayerId | null,
): Pick<HierarchyRow, 'dimmed' | 'selectable' | 'reason'> {
  const hidden = view.hiddenLayers.has(layer);
  const offFocus = isOffFocus(layer, focus);
  const entity = scene.entities[id];
  const allowed = entity !== undefined && canSelect(entity, scene, view.actor);
  const reason = hidden
    ? `${LAYER_LABELS[layer]} is hidden`
    : offFocus
      ? `${LAYER_LABELS[layer]} is not the active layer`
      : !allowed
        ? scene.layers[layer]?.locked
          ? `${LAYER_LABELS[layer]} is locked`
          : 'You cannot select this'
        : null;
  return { dimmed: hidden || offFocus, selectable: reason === null, reason };
}

/**
 * One group per layer the viewer may see, top to bottom in draw order like the Layers tab
 * (UI-LAY-01), empty layers included so the tree keeps its shape. Rows inside a group run by name,
 * then id, the Tokens tab's stable order.
 */
export function hierarchyGroups(
  campaign: Campaign,
  scene: Scene,
  view: HierarchyView,
): HierarchyGroup[] {
  const focus = focusedLayer(view.actor, view.activeLayer);
  const rows = entityRows(campaign, scene);
  return LAYER_ROWS.filter((layer) => canSeeLayer(view.role, layer)).map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    active: layer === view.activeLayer,
    locked: scene.layers[layer]?.locked ?? false,
    hidden: view.hiddenLayers.has(layer),
    rows: rows
      .filter((row) => row.layer === layer)
      .map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        prop: scene.entities[row.id]?.shape !== undefined,
        ...rowState(scene, row.id, layer, view, focus),
      })),
  }));
}
