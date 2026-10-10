import { tokenDragStore } from '../tools/token-drag-store.js';
import { gizmoStore } from '../tools/gizmo-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import { selectionStore } from '../tools/selection-store.js';
import { pointerClaims } from './pointer-claims.js';
import { isTypingTarget } from './typing-target.js';

/** Called by BoardCanvas before the tool-level window key listeners run. */
export function handleBoardEscape(event: Pick<KeyboardEvent, 'key' | 'target'>): void {
  if (event.key !== 'Escape' || isTypingTarget(event.target)) return;

  const owner = pointerClaims.owner();
  if (
    owner === 'token drag' ||
    owner === '2D gizmo' ||
    owner === '3D gizmo' ||
    owner === 'ruler' ||
    tokenDragStore.getState().local?.settling === false ||
    rulerStore.getState().phase !== 'idle' ||
    gizmoStore.getState().preview?.settling === false
  )
    return;

  // The tool's window listener cancels the interaction after this handler. In particular,
  // RulerTool must clear its own state so it can publish the cancelled preview.
  selectionStore.getState().clear();
}
