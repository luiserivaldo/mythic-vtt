import { Fragment, useEffect } from 'react';
import { isTypingTarget } from '../render/typing-target.js';
import { activeToolStore } from '../tools/active-tool-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { activateMeasurement } from '../tools/measurement-tool.js';
import { rulerStore } from '../tools/ruler-store.js';
import { dockStore } from './dock-store.js';
import { leftPaneStore, panelRegion } from './left-pane.js';
import { railTools } from './registries.js';
import { toolPanelLayoutStore } from './tool-panel-layout.js';
import { resolveActiveTool } from './tool-rail.js';
import { useRailTools } from './use-rail-tools.js';

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

/** UI-MEAS-01: arming Measure opens its panel beside the button, even if it was tucked away. */
function revealMeasurePanel(): void {
  toolPanelLayoutStore.getState().restore('ruler');
}

/**
 * UI-TOOL-01..07: the vertical tool rail (Select, Pan, Measure, Create Prop, Initiative).
 * A tool the viewer may not use stays on the rail, disabled, with the reason in its tooltip and
 * accessible description. Rendered inside the board's control column, so it needs no layout of
 * its own. Which tool is active is local view state; nothing here is sent to the host.
 */
export function ToolRail() {
  const { states, activeId, measuring } = useRailTools();
  const measureUsable = states.find((state) => state.id === 'measure')?.enabled === true;
  const drawUsable = states.find((state) => state.id === 'draw')?.enabled === true;

  // A tool that stops being usable (interaction switched off, seat permissions changed) must not
  // stay armed. The fallback tool is derived above, not stored, so the choice survives a brief
  // read-only moment (e.g. while the campaign is still loading).
  useEffect(() => {
    if (measuring && !measureUsable) activateMeasurement(null);
  }, [measuring, measureUsable]);

  // UI-SEAT-02: turning a seat's Draw tool off disarms the tool for a player, mid-stroke or not.
  useEffect(() => {
    if (!drawUsable && activeToolStore.getState().tool === 'draw') {
      activeToolStore.getState().setTool(resolveActiveTool(states, 'select'));
    }
  }, [drawUsable, states]);

  const choose = (id: string) => {
    if (id === 'measure') {
      if (!measuring) revealMeasurePanel();
      activateMeasurement(measuring ? null : 'distance');
      return;
    }
    activateMeasurement(null);
    if (id === 'initiative') toolPanelLayoutStore.getState().restore('initiative');
    // UI-SHELL-05: choosing a tool reveals the region its panel opens in, even if collapsed.
    const panel = railTools.get(id)?.panel;
    if (panel && panelRegion(panel) === 'left-pane') leftPaneStore.getState().expand();
    else if (id === 'initiative' && dockStore.getState().collapsed)
      dockStore.getState().toggleCollapsed();
    activeToolStore.getState().setTool(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || !measureUsable) return;
      const armed = rulerStore.getState().tool || aoeToolStore.getState().active;
      if (!armed) revealMeasurePanel();
      activateMeasurement(armed ? null : 'distance');
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
              id={`rail-tool-${tool.id}`}
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
