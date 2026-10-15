import { TokenStatusPanel } from './TokenStatusPanel.js';
import { TokenRingsPanel } from './TokenRingsPanel.js';
import type { Campaign, Scene } from '@mythic/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { activeToolStore } from '../tools/active-tool-store.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { selectionStore } from '../tools/selection-store.js';
import { useGizmoTarget } from '../tools/use-gizmo-target.js';
import { useGizmoTarget3D } from '../tools/use-gizmo-target-3d.js';
import { AoEAffectedPanel } from './AoEAffectedPanel.js';
import { AoEToolPanel } from './AoEToolPanel.js';
import { toolPanelLayoutStore, type ToolPanelId } from './tool-panel-layout.js';
import { isReadOnlyViewer } from './viewer.js';
import { rulerStore } from '../tools/ruler-store.js';
import { RulerPanel } from './RulerPanel.js';
import { CreatePropPanel } from './RailPanels.js';
import { InitiativeTools } from './InitiativeTools.js';
import { seeSheet } from './sheet-panel.js';
import { DrawPanel } from './DrawPanel.js';
import { LeftPane } from './LeftPane.js';
import { leftPaneStore, panelRegion } from './left-pane.js';
import { toolPanels, type PanelRegion } from './registries.js';

const TransformPanel3D = lazy(async () => {
  const module = await import('./TransformPanel3D.js');
  return { default: module.TransformPanel3D };
});
const TransformPanel = lazy(async () => {
  const module = await import('./TransformPanel.js');
  return { default: module.TransformPanel };
});

function PanelFrame({
  id,
  label,
  collapsed,
  children,
}: {
  id: ToolPanelId;
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="ui-tool-peek"
        aria-label={`Restore ${label} panel`}
        onClick={() => {
          toolPanelLayoutStore.getState().restore(id);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="ui-tool-panel" data-tool-panel={id}>
      <header className="ui-tool-panel-head">
        <strong>{label}</strong>
        <button
          type="button"
          aria-label={`Close ${label} panel`}
          onClick={() => {
            toolPanelLayoutStore.getState().collapse(id);
          }}
        >
          Close
        </button>
      </header>
      <div className="ui-tool-panel-content">{children}</div>
    </div>
  );
}

/**
 * M1-37: one ordered stack per region prevents the tool panels overlapping. UI-SHELL-05: each
 * panel opens in the region its `toolPanels` entry names (the right dock's context slot, or the
 * left pane beside the rail).
 */
export function ToolPanelDock({
  campaign,
  scene,
  mode3d,
  container,
}: {
  campaign: Campaign | null;
  scene: Scene | null;
  mode3d: boolean;
  container: HTMLElement | null;
}) {
  const preview = useClientStore((state) => state.viewAs.kind !== 'host');
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const collapsed = useStore(toolPanelLayoutStore, (state) => state.collapsed);
  const leftContainer = useStore(leftPaneStore, (state) => state.container);
  const aoeActive = useStore(aoeToolStore, (state) => state.active);
  const rulerActive = useStore(rulerStore, (state) => state.tool);
  const activeTool = useStore(activeToolStore, (state) => state.tool);
  const selected = useStore(selectionStore, (state) => state.ids);
  const target2d = useGizmoTarget();
  const target3d = useGizmoTarget3D();
  const readOnly = preview || isReadOnlyViewer({ isHost, seatId, campaign });
  const showTransform = !aoeActive && (mode3d ? target3d !== null : target2d !== null);
  const selectedEntity =
    scene && selected.length === 1 ? scene.entities[selected[0] ?? ''] : undefined;
  // Preserve the prior panel behavior for a non-admin who may update an owned, selected AoE.
  const showAoE = scene !== null && !aoeActive && selectedEntity?.aoe !== undefined;
  const showRuler = scene !== null && (rulerActive || aoeActive);

  const showToken = campaign !== null && scene !== null && selectedEntity?.token !== undefined;
  // UI-TOOL-04/05: the rail's own panels. Measuring (the ruler or an AoE) takes the rail over.
  const measuring = rulerActive || aoeActive;
  const showCreateProp = scene !== null && !measuring && activeTool === 'create-prop';
  const showDraw = scene !== null && !measuring && activeTool === 'draw';
  const showInitiative = !measuring && activeTool === 'initiative';
  if (!container) return null;
  const panels: { id: ToolPanelId; node: ReactNode }[] = [];
  const add = (id: ToolPanelId, node: ReactNode) => {
    panels.push({ id, node });
  };
  // Read-only viewers get no editing panels, only the read-only initiative tracker.
  if (!readOnly) {
    if (showCreateProp) add('create-prop', <CreatePropPanel scene={scene} isHost={isHost} />);
    if (showDraw) add('draw', <DrawPanel scene={scene} />);
  }
  if (showInitiative) add('initiative', <InitiativeTools />);
  if (!readOnly) {
    if (showTransform)
      add(
        'transform',
        <Suspense fallback={<span role="status">Loading transform tools…</span>}>
          {mode3d ? <TransformPanel3D /> : <TransformPanel />}
        </Suspense>,
      );
    if (showAoE)
      add(
        'aoe',
        <>
          <AoEToolPanel scene={scene} unified />
          <AoEAffectedPanel scene={scene} />
        </>,
      );
    if (showToken)
      add(
        'token',
        <>
          {/* UI-SHEET-01: See Sheet also lives in the token's right-click menu (UI-TOKEN-03); the
              selected token's panel keeps the same shortcut. */}
          <button type="button" onClick={seeSheet}>
            See Sheet
          </button>
          <TokenStatusPanel
            key={`status-${selectedEntity.id}`}
            campaign={campaign}
            scene={scene}
            entity={selectedEntity}
          />
          <TokenRingsPanel
            key={`rings-${selectedEntity.id}`}
            campaign={campaign}
            scene={scene}
            entity={selectedEntity}
          />
        </>,
      );
    if (showRuler)
      add(
        'ruler',
        <>
          <RulerPanel scene={scene} />
          {/* MEAS-04: a live readout of every stored AoE, for any viewer the ruler panel is open to
              (the AoE frame above already carries it whenever an AoE is selected). */}
          {!showAoE && <AoEAffectedPanel scene={scene} />}
        </>,
      );
  }
  const frames = (region: PanelRegion) =>
    panels
      .filter((panel) => panelRegion(panel.id) === region)
      .map(({ id, node }) => (
        <PanelFrame
          key={id}
          id={id}
          label={toolPanels.get(id)?.label ?? id}
          collapsed={collapsed[id]}
        >
          {node}
        </PanelFrame>
      ));
  const right = frames('right-dock');
  const left = frames('left-pane');
  return (
    <>
      {right.length > 0 &&
        createPortal(
          <aside className="ui-tool-dock" aria-label="Tool panels">
            {right}
          </aside>,
          container,
        )}
      {left.length > 0 && leftContainer && createPortal(<LeftPane>{left}</LeftPane>, leftContainer)}
    </>
  );
}
