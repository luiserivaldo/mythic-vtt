import { useContext, useEffect } from 'react';
import { isTypingTarget } from '../render/typing-target.js';
import { useClientStore } from '../store/react.js';
import { SubmitContext } from './submit.js';
import { isReadOnlyViewer } from './viewer.js';

/**
 * HIST-04: Ctrl/Cmd+Z undoes the viewer's own last action, for players and the DM alike. The host
 * works out which action that is and refuses anything the viewer may not revert, so this only
 * sends the request. Editing fields keep their own undo; Shift+Z (redo) is left alone.
 */
export function UndoHotkey() {
  const submit = useContext(SubmitContext);
  const campaign = useClientStore((state) => state.campaign);
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const readOnly = isReadOnlyViewer({ isHost, seatId, campaign });
  useEffect(() => {
    if (!submit || readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'z' ||
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.altKey ||
        event.repeat ||
        isTypingTarget(event.target)
      )
        return;
      event.preventDefault();
      void submit('history.undo', {});
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [submit, readOnly]);
  return null;
}
