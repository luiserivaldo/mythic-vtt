import { Fragment, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { canUseSceneToggle, type Actor } from '@mythic/shared';
import { isTypingTarget } from '../render/typing-target.js';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { activeToolStore } from '../tools/active-tool-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { activateMeasurement } from '../tools/measurement-tool.js';
import { rulerStore } from '../tools/ruler-store.js';
import { railToolStates, resolveActiveTool } from './tool-rail.js';
import { isReadOnlyViewer, viewerRole } from './viewer.js';

const GLYPHS: Readonly<Record<string, string>> = {
  cursor: '↖',
  hand: '✥',
  ruler: '⟷',
  pen: '✎',
  cube: '▣',
  list: '☰',
};

/** Hint shown beside the placeholder so nobody mistakes it for a working tool. */
const WIP_NOTE = 'Work in progress';

/** Tooltips that say what a tool does beyond its label. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  measure: 'Measure (R). Drag for a quick measure; click for waypoints; Esc clears',
  draw: 'Draw. Drag to draw a freehand line; Esc leaves the tool',
};

/**
 * UI-TOOL-01..07: the vertical tool rail (Select, Pan, Measure, Create Prop, Initiative).
 * A tool the viewer may not use stays on the rail, disabled, with the reason in its tooltip and
 * accessible description. Rendered inside the board's control column, so it needs no layout of
 * its own. Which tool is active is local view state; nothing here is sent to the host.
 */
export function ToolRail() {
  const store = useClientStore((state) => state.campaign);
  const viewed = useViewedCampaign();
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const requested = useStore(activeToolStore, (state) => state.tool);
  const rulerArmed = useStore(rulerStore, (state) => state.tool);
  const aoeActive = useStore(aoeToolStore, (state) => state.active);
  const measuring = rulerArmed || aoeActive;

  const role = viewerRole({ isHost, seatId, campaign: store });
  const preview = useClientStore((state) => state.viewAs.kind !== 'host');
  const readOnly = preview || isReadOnlyViewer({ isHost, seatId, campaign: store });
  const seat = seatId === null ? undefined : store?.seats[seatId];
  const permissions = seat?.permissions ?? null;
  // Enable Interaction is a per-seat switch; the host and seat-less viewers are never switched off.
  const interactionEnabled = isHost || seat === undefined || seat.interactionEnabled !== false;

  // PERM-05: each scene's own toggles still apply to seats the registry would allow.
  const sceneReasons = useMemo<Record<string, string | undefined>>(() => {
    const sceneId = viewed?.activeSceneId;
    if (!viewed || !sceneId || isHost) return {};
    const actor: Actor = seatId !== null ? { kind: 'seat', seatId } : { kind: 'seat' };
    return {
      measure: canUseSceneToggle(viewed, actor, sceneId, 'measure')
        ? undefined
        : 'Measuring is disabled in this scene',
      draw: canUseSceneToggle(viewed, actor, sceneId, 'draw')
        ? undefined
        : 'Drawing is disabled in this scene',
    };
  }, [viewed, isHost, seatId]);

  const states = useMemo(
    () =>
      railToolStates({
        role,
        permissions,
        readOnly,
        interactionEnabled,
        sceneReasons,
      }),
    [role, permissions, readOnly, interactionEnabled, sceneReasons],
  );
  const measureUsable = states.find((state) => state.id === 'measure')?.enabled === true;
  const drawUsable = states.find((state) => state.id === 'draw')?.enabled === true;
  const activeId = measuring ? 'measure' : resolveActiveTool(states, requested);

  // A tool that stops being usable (interaction switched off, seat permissions changed) must not
  // stay armed. The fallback tool is derived above, not stored, so the choice survives a brief
  // read-only moment (e.g. while the campaign is still loading).
  useEffect(() => {
    if (measuring && !measureUsable) activateMeasurement(null);
  }, [measuring, measureUsable]);

  // PERM-05: turning a scene's Draw toggle off disarms the tool for a player, mid-stroke or not.
  useEffect(() => {
    if (!drawUsable && activeToolStore.getState().tool === 'draw') {
      activeToolStore.getState().setTool(resolveActiveTool(states, 'select'));
    }
  }, [drawUsable, states]);

  const choose = (id: string) => {
    if (id === 'measure') {
      activateMeasurement(measuring ? null : 'distance');
      return;
    }
    activateMeasurement(null);
    activeToolStore.getState().setTool(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || !measureUsable) return;
      activateMeasurement(
        rulerStore.getState().tool || aoeToolStore.getState().active ? null : 'distance',
      );
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [measureUsable]);

  return (
    <>
      {states.map((tool) => {
        const pressed = activeId === tool.id;
        const hintId = `rail-reason-${tool.id}`;
        const hint = tool.reason ?? (tool.wip ? WIP_NOTE : undefined);
        const title = tool.reason ?? TOOL_TITLES[tool.id] ?? tool.label;
        return (
          <Fragment key={tool.id}>
            {tool.dividerBefore && <hr className="ui-rail-divider" />}
            <button
              type="button"
              className="ui-rail-tool"
              aria-pressed={pressed}
              aria-disabled={tool.enabled ? undefined : true}
              aria-describedby={hint ? hintId : undefined}
              data-wip={tool.wip || undefined}
              title={tool.wip && tool.enabled ? `${tool.label}: ${WIP_NOTE}` : title}
              onClick={() => {
                if (tool.enabled) choose(tool.id);
              }}
            >
              <span aria-hidden="true" className="ui-rail-glyph">
                {GLYPHS[tool.icon] ?? '•'}
              </span>
              {tool.label}
              {tool.wip && (
                <small aria-hidden="true" className="ui-rail-wip">
                  WIP
                </small>
              )}
            </button>
            {hint && (
              <span id={hintId} className="ui-visually-hidden">
                {hint}
              </span>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
