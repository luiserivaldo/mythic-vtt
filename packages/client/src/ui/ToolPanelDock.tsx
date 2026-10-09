import type { Campaign, Scene } from '@mythic/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { selectionStore } from '../tools/selection-store.js';
import { useGizmoTarget } from '../tools/use-gizmo-target.js';
import { useGizmoTarget3D } from '../tools/use-gizmo-target-3d.js';
import { AoEAffectedPanel } from './AoEAffectedPanel.js';
import { AoEToolPanel } from './AoEToolPanel.js';
import { toolPanelLayoutStore, type ToolPanelId } from './tool-panel-layout.js';
import { isReadOnlyViewer, viewerRole } from './viewer.js';

const EntityPanel = lazy(async () => {
  const module = await import('./EntityPanel.js');
  return { default: module.EntityPanel };
});
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
}: {
  campaign: Campaign | null;
  scene: Scene | null;
  mode3d: boolean;
}) {
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const entities = useStore(toolPanelLayoutStore, (state) => state.entities);
  const collapsed = useStore(toolPanelLayoutStore, (state) => state.collapsed);
  const aoeActive = useStore(aoeToolStore, (state) => state.active);
  const selected = useStore(selectionStore, (state) => state.ids);
  const target2d = useGizmoTarget();
  const target3d = useGizmoTarget3D();
  const readOnly = isReadOnlyViewer({ isHost, seatId, campaign });
  const role = campaign ? viewerRole({ isHost, seatId, campaign }) : 'observer';
  const canAdmin = role === 'host' || role === 'codm';
  const showEntities = canAdmin && campaign !== null && entities !== 'hidden';
  const showTransform = !aoeActive && (mode3d ? target3d !== null : target2d !== null);
  const selectedEntity =
    scene && selected.length === 1 ? scene.entities[selected[0] ?? ''] : undefined;
  // Preserve the prior panel behavior for a non-admin who may update an owned, selected AoE.
  const showAoE = scene !== null && (canAdmin || selectedEntity?.aoe !== undefined);

  if (readOnly || (!showEntities && !showTransform && !showAoE)) return null;
  return (
    <aside className="ui-tool-dock" aria-label="Tool panels">
      {showEntities && (
        <PanelFrame id="entities" label="Entities" collapsed={entities === 'collapsed'}>
          <Suspense fallback={<p role="status">Loading panel…</p>}>
            <EntityPanel campaign={campaign} />
          </Suspense>
        </PanelFrame>
      )}
      {showTransform && (
        <PanelFrame id="transform" label="Transform" collapsed={collapsed.transform}>
          <Suspense fallback={<span role="status">Loading transform tools…</span>}>
            {mode3d ? <TransformPanel3D /> : <TransformPanel />}
          </Suspense>
        </PanelFrame>
      )}
      {showAoE && (
        <PanelFrame id="aoe" label="AoE" collapsed={collapsed.aoe}>
          <AoEToolPanel scene={scene} />
          <AoEAffectedPanel scene={scene} />
        </PanelFrame>
      )}
    </aside>
  );
}
