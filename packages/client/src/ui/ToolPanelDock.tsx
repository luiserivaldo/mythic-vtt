import { TokenStatusPanel } from './TokenStatusPanel.js';
import { TokenRingsPanel } from './TokenRingsPanel.js';
import type { Campaign, Scene } from '@mythic/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
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
import { seeSheet } from './sheet-panel.js';

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

/** M1-37: one ordered dock prevents the Entity, Transform and AoE tools overlapping. */
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
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const collapsed = useStore(toolPanelLayoutStore, (state) => state.collapsed);
  const aoeActive = useStore(aoeToolStore, (state) => state.active);
  const rulerActive = useStore(rulerStore, (state) => state.tool);
  const selected = useStore(selectionStore, (state) => state.ids);
  const target2d = useGizmoTarget();
  const target3d = useGizmoTarget3D();
  const readOnly = isReadOnlyViewer({ isHost, seatId, campaign });
  const showTransform = !aoeActive && (mode3d ? target3d !== null : target2d !== null);
  const selectedEntity =
    scene && selected.length === 1 ? scene.entities[selected[0] ?? ''] : undefined;
  // Preserve the prior panel behavior for a non-admin who may update an owned, selected AoE.
  const showAoE = scene !== null && !aoeActive && selectedEntity?.aoe !== undefined;
  const showRuler = scene !== null && (rulerActive || aoeActive);

  const showToken = campaign !== null && scene !== null && selectedEntity?.token !== undefined;
  if (!container || readOnly || (!showTransform && !showAoE && !showToken && !showRuler))
    return null;
  return createPortal(
    <aside className="ui-tool-dock" aria-label="Tool panels">
      {showTransform && (
        <PanelFrame id="transform" label="Transform" collapsed={collapsed.transform}>
          <Suspense fallback={<span role="status">Loading transform tools…</span>}>
            {mode3d ? <TransformPanel3D /> : <TransformPanel />}
          </Suspense>
        </PanelFrame>
      )}
      {showAoE && (
        <PanelFrame id="aoe" label="AoE" collapsed={collapsed.aoe}>
          <AoEToolPanel scene={scene} unified />
          <AoEAffectedPanel scene={scene} />
        </PanelFrame>
      )}
      {showToken && (
        <PanelFrame id="token" label="Token" collapsed={collapsed.token}>
          {/* UI-SHEET-01: the token's right-click menu has not landed yet, so See Sheet lives on
              the selected token's panel and jumps the dock to the Sheet tab. */}
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
        </PanelFrame>
      )}
      {showRuler && (
        <PanelFrame id="ruler" label="Ruler" collapsed={collapsed.ruler}>
          <RulerPanel scene={scene} />
          {/* MEAS-04: a live readout of every stored AoE, for any viewer the ruler panel is open to
              (the AoE frame above already carries it whenever an AoE is selected). */}
          {!showAoE && <AoEAffectedPanel scene={scene} />}
        </PanelFrame>
      )}
    </aside>,
    container,
  );
}
