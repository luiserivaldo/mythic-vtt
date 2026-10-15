import { lazy, Suspense, useId, type Ref } from 'react';
import { useClientStore } from '../store/react.js';
import { useViewedCampaign } from '../store/viewed-campaign.js';
import { ChatPanel } from './ChatPanel.js';
import { SheetPanel } from './SheetPanel.js';
import { seatColorsOf } from './chat-panel.js';
import { DOCK_ICONS, resolveActiveTab, visibleDockTabs } from './dock-tabs.js';
import { HelpPanel } from './HelpPanel.js';
import { SettingsPanel } from './SettingsPanel.js';
import { HistoryTools } from './HistoryTools.js';
import { IdentityTransfer } from './IdentityTransfer.js';
import { joinUrlsFromNotices } from './share-panel.js';
import { useDockState } from './dock-store.js';
import { viewerRole } from './viewer.js';

const ScenesView = lazy(async () => ({ default: (await import('./ScenesView.js')).ScenesView }));
const LayerPanel = lazy(async () => ({ default: (await import('./LayerPanel.js')).LayerPanel }));
const MapPanel = lazy(async () => ({ default: (await import('./MapPanel.js')).MapPanel }));
const SeatPanel = lazy(async () => ({ default: (await import('./SeatPanel.js')).SeatPanel }));
const SharePanel = lazy(async () => ({ default: (await import('./SharePanel.js')).SharePanel }));
const PrefabPanel = lazy(async () => ({ default: (await import('./PrefabPanel.js')).PrefabPanel }));
const EntityPanel = lazy(async () => ({ default: (await import('./EntityPanel.js')).EntityPanel }));

export type DockTheme = 'dark' | 'light';

interface Props {
  theme: DockTheme;
  onThemeChange: (theme: DockTheme) => void;
  /** Where the board's selection-driven tool panels (Transform, AoE, Token, Ruler) portal in. */
  contextPanelRef: Ref<HTMLDivElement>;
}

/**
 * UI-DOCK-01: an icon tab strip with a collapse button. Collapsed, the strip becomes an icon
 * column and the board widens. Only the active tab's content is mounted, and a tab the viewer
 * may not use is never offered or rendered (registry predicate; the host re-checks every intent).
 */
export function RightDock({ theme, onThemeChange, contextPanelRef }: Props) {
  const preview = useClientStore((s) => s.viewAs.kind !== 'host');
  const campaign = useClientStore((s) => s.campaign);
  const viewed = useViewedCampaign();
  const ready = useClientStore((s) => s.ready);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const presence = useClientStore((s) => s.presence);
  const notices = useClientStore((s) => s.notices);
  const { collapsed, requested, open, toggleCollapsed } = useDockState();
  const idBase = useId();

  const role = viewerRole({ isHost, seatId, campaign });
  const permissions = (seatId === null ? undefined : campaign?.seats[seatId]?.permissions) ?? null;
  const tabs = visibleDockTabs(role, permissions);
  const active = resolveActiveTab(role, permissions, requested);
  const activeLabel = tabs.find((tab) => tab.id === active)?.label ?? 'Chat';
  const tabId = (id: string) => `${idBase}-tab-${id}`;
  const panelId = `${idBase}-panel`;
  const board = viewed ?? campaign;
  const joinUrls = joinUrlsFromNotices(notices);

  const content = () => {
    switch (active) {
      case 'chat':
        return <ChatPanel entries={[]} seatColors={seatColorsOf(presence?.seats)} />;
      case 'sheet':
        return <SheetPanel />;
      case 'help':
        return <HelpPanel />;
      case 'settings':
        return (
          <>
            <SettingsPanel theme={theme} onThemeChange={onThemeChange} />
            {ready && <IdentityTransfer />}
            <HistoryTools />
          </>
        );
      default:
        break;
    }
    if (!campaign || !board) return null;
    switch (active) {
      // UI-SCN-01: the Scenes tab holds the scene list, create, and the battlemap upload with
      // 2-point calibration (moved out of its own Map tab).
      case 'scenes':
        return (
          <>
            <ScenesView campaign={campaign} />
            <MapPanel campaign={board} />
          </>
        );
      case 'layers':
        return <LayerPanel campaign={board} role={role} />;
      case 'entities':
        return <EntityPanel campaign={board} />;
      case 'prefabs':
        return <PrefabPanel key={board.activeSceneId} campaign={board} />;
      case 'seats':
        return (
          <SeatPanel
            campaign={campaign}
            presence={presence?.seats ?? null}
            unseated={presence?.unseated}
            joinUrls={joinUrls}
          />
        );
      case 'share':
        return <SharePanel joinUrls={joinUrls} />;
      default:
        return null;
    }
  };

  return (
    <aside className="ui-right-dock" data-collapsed={collapsed} aria-label="Right dock">
      <div className="ui-right-dock-head">
        <button
          type="button"
          aria-label={collapsed ? 'Expand dock' : 'Collapse dock'}
          aria-expanded={!collapsed}
          onClick={() => {
            toggleCollapsed();
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
        {!collapsed && <strong>{activeLabel}</strong>}
      </div>
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Dock tabs"
        className="ui-dock-tabs"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            title={tab.label}
            aria-label={tab.label}
            aria-selected={active === tab.id}
            aria-controls={panelId}
            onClick={() => {
              open(tab.id);
            }}
          >
            <span aria-hidden="true">{DOCK_ICONS[tab.icon]}</span>
          </button>
        ))}
      </div>
      <div className="ui-right-dock-content" hidden={collapsed} aria-busy={!ready}>
        {!collapsed && (
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId(active)}
            className="ui-dock-tab-body"
          >
            <fieldset className="ui-preview-content" disabled={preview}>
              <Suspense fallback={<p role="status">Loading panel…</p>}>{content()}</Suspense>
            </fieldset>
          </div>
        )}
        <div className="ui-context-panel-slot" ref={contextPanelRef} />
      </div>
    </aside>
  );
}
