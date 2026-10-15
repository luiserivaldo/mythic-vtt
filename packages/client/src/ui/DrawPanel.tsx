import {
  DRAW_CLEAR_CHANNEL,
  DRAW_COLORS,
  DRAW_WIDTH_MAX,
  DRAW_WIDTH_MIN,
  type Scene,
} from '@mythic/shared';
import { useContext } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { undoOwnStroke } from '../tools/draw-undo.js';
import { drawingStore } from '../tools/drawing-store.js';
import { EphemeralContext } from './ephemeral-context.js';
import { isAdminRole, viewerRole } from './viewer.js';

/**
 * LAY-05: the Draw tool's settings. Colour and width apply to the next stroke and nothing else is
 * remembered. Erasing is offered for what the viewer may erase at all, and clearing the scene is
 * the DM's; both are re-checked by the host, which is where the authority lives.
 */
export function DrawPanel({ scene }: { scene: Scene }) {
  const color = useStore(drawingStore, (s) => s.color);
  const width = useStore(drawingStore, (s) => s.width);
  const erase = useStore(drawingStore, (s) => s.erase);
  const ephemeral = useContext(EphemeralContext);
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const isDm = isAdminRole(viewerRole({ isHost, seatId, campaign }));

  return (
    <section aria-label="Draw tool">
      <label>
        Colour{' '}
        <input
          type="color"
          value={color}
          onChange={(e) => {
            drawingStore.getState().setColor(e.target.value);
          }}
        />
      </label>
      <div role="group" aria-label="Drawing colours">
        {DRAW_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Draw in ${option}`}
            aria-pressed={color === option}
            onClick={() => {
              drawingStore.getState().setColor(option);
            }}
          >
            {option}
          </button>
        ))}
      </div>
      <label>
        Width{' '}
        <input
          type="range"
          aria-label="Stroke width"
          min={DRAW_WIDTH_MIN}
          max={DRAW_WIDTH_MAX}
          step={0.01}
          value={width}
          onChange={(e) => {
            drawingStore.getState().setWidth(e.target.valueAsNumber);
          }}
        />
      </label>
      <button
        type="button"
        title="Take back your newest drawing (Ctrl+Z while drawing)"
        onClick={() => {
          undoOwnStroke(ephemeral, scene.id);
        }}
      >
        Undo drawing
      </button>
      <button
        type="button"
        aria-pressed={erase}
        onClick={() => {
          drawingStore.getState().setErase(!erase);
        }}
      >
        Eraser
      </button>
      <p>
        {erase
          ? isDm
            ? 'Click any drawing to erase it.'
            : 'Click one of your own drawings to erase it.'
          : 'Drag on the board to draw a freehand line, in 2D or in 3D.'}
      </p>
      {isDm && (
        <button
          type="button"
          onClick={() => {
            // The host relays the clear to everyone; the DM's own board is cleared here.
            drawingStore.getState().clearScene(scene.id);
            ephemeral?.send(DRAW_CLEAR_CHANNEL, { sceneId: scene.id });
          }}
        >
          Clear all drawings
        </button>
      )}
    </section>
  );
}
