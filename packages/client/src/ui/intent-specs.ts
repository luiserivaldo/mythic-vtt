import type { LayerId, Seat } from '@mythic/shared';

/** One intent to submit through the client queue; the UI never builds state itself. */
export interface IntentSpec {
  type: string;
  payload: unknown;
  sceneId?: string;
}

export const sceneCreateIntent = (
  sceneId: string,
  name: string,
  bounds?: { width: number; height: number },
): IntentSpec => ({
  type: 'scene.create',
  payload: bounds ? { sceneId, name: name.trim(), bounds } : { sceneId, name: name.trim() },
});

/** D37: resize the scene canvas (whole cells). */
export const sceneBoundsIntent = (
  sceneId: string,
  bounds: { width: number; height: number },
): IntentSpec => ({
  type: 'scene.update',
  payload: { sceneId, bounds },
  sceneId,
});

export const sceneRenameIntent = (sceneId: string, name: string): IntentSpec => ({
  type: 'scene.rename',
  payload: { sceneId, name: name.trim() },
});

export const sceneActivateIntent = (sceneId: string): IntentSpec => ({
  type: 'scene.activate',
  payload: { sceneId },
});

export const layerLockIntent = (sceneId: string, layer: LayerId, locked: boolean): IntentSpec => ({
  type: 'layer.lock',
  payload: { sceneId, layer, locked },
  sceneId,
});

export const entityMoveLayerIntent = (
  sceneId: string,
  entityId: string,
  layer: LayerId,
): IntentSpec => ({
  type: 'entity.setLayer',
  payload: { sceneId, entityId, layer },
  sceneId,
});

export const seatCreateIntent = (
  seatId: string,
  label: string,
  role: 'player' | 'codm',
  permissions?: Seat['permissions'],
): IntentSpec => ({
  type: 'seat.create',
  payload: {
    seatId,
    label: label.trim(),
    role,
    ...(permissions ? { permissions } : {}),
  },
});

export const seatAssignIntent = (seatId: string, identityId: string): IntentSpec => ({
  type: 'seat.assign',
  payload: { seatId, identityId: identityId.trim() },
});

export const seatReleaseIntent = (seatId: string): IntentSpec => ({
  type: 'seat.release',
  payload: { seatId },
});

export const seatRoleIntent = (seatId: string, role: 'player' | 'codm'): IntentSpec => ({
  type: 'seat.update',
  payload: { seatId, role },
});

export const seatPermissionIntent = (
  seatId: string,
  permission: 'view' | 'move' | 'edit' | 'delete',
  allowed: boolean,
): IntentSpec => ({
  type: 'permission.update',
  payload: { target: 'seat', seatId, permissions: { [permission]: allowed } },
});

/** ENV-07: horizon/plain colour plus optional gradient top (null clears it). */
export const sceneBackgroundIntent = (
  sceneId: string,
  background: string,
  zenith: string | null,
): IntentSpec => ({
  type: 'scene.update',
  payload: { sceneId, background, zenith },
  sceneId,
});
