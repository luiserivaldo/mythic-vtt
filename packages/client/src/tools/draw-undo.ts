import { DRAW_ERASE_CHANNEL } from '@mythic/shared';
import type { EphemeralApi } from '../ui/ephemeral-context.js';
import { drawingStore } from './drawing-store.js';
import { lastOwnStroke } from './drawing.js';

/**
 * UX-40 (playtest F20): takes back the viewer's own newest finished drawing on the scene — locally,
 * then for everyone through the same erase message the eraser sends (drawings are ephemeral, so
 * this is not an action). Returns whether anything was undone, so a caller can fall through to the
 * ordinary history undo when the viewer has no drawing left.
 */
export function undoOwnStroke(
  ephemeral: Pick<EphemeralApi, 'identityId' | 'send'> | null,
  sceneId: string | null,
): boolean {
  if (!ephemeral || sceneId === null) return false;
  const target = lastOwnStroke(drawingStore.getState().strokes, sceneId, ephemeral.identityId);
  if (!target) return false;
  drawingStore.getState().remove(target.strokeId);
  ephemeral.send(DRAW_ERASE_CHANNEL, { sceneId, strokeId: target.strokeId });
  return true;
}
