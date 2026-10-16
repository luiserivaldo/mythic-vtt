import { useState, type ReactNode } from 'react';
import type { Campaign, Scene } from '@mythic/shared';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import { sceneBrowseStore, useViewedCampaign } from '../store/viewed-campaign.js';
import { assetUrl } from '../assets/asset-url.js';
import { BackgroundForm } from './BackgroundForm.js';
import { backgroundDraft } from './background-form.js';
import { newId } from './ids.js';
import { sceneActivateIntent, sceneCreateIntent } from './intent-specs.js';
import { folderNames, sceneFolders, scenePreviewAsset, type SceneRow } from './scene-list.js';
import { SceneCreateForm } from './SceneCreateForm.js';
import { SceneSettingsForm } from './SceneSettingsForm.js';
import { useSubmit } from './submit.js';

/**
 * UI-SCN-01 (MV-247): scenes as cards with a preview, grouped by folder. Clicking a card views
 * that scene locally (UX-04, nothing is sent); its options menu sets it active, which moves the
 * party, or opens its settings. DM-only scenes keep their existing behaviour (C18 is still open):
 * flagged on the card and never activatable.
 */
export function ScenesView({ campaign }: { campaign: Campaign }) {
  const isHost = useClientStore((s) => s.isHost);
  const { send, error } = useSubmit();
  const viewedId = useViewedCampaign()?.activeSceneId ?? null;
  const browsing = useStore(sceneBrowseStore, (s) => s.sceneId);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [dmOnly, setDmOnly] = useState(false);
  const folders = folderNames(campaign);
  const total = Object.keys(campaign.scenes).length;
  const active = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  const viewingOther = browsing !== null && viewedId !== null && viewedId !== active?.id;
  const settingsScene = settingsFor ? campaign.scenes[settingsFor] : undefined;

  const card = (row: SceneRow) => {
    const scene = campaign.scenes[row.id];
    if (!scene) return null;
    const viewing = row.id === viewedId;
    const menuOpen = menuFor === row.id;
    const preview = assetUrl('', scenePreviewAsset(scene) ?? undefined);
    return (
      <li key={row.id} className="ui-scene-card" data-active={row.active} data-viewing={viewing}>
        <button
          type="button"
          className="ui-scene-card-view"
          aria-label={`View ${row.name}`}
          aria-pressed={viewing}
          onClick={() => {
            sceneBrowseStore.getState().browse(row.id);
          }}
        >
          {preview ? (
            <img className="ui-scene-card-preview" src={preview} alt="" />
          ) : (
            <span
              className="ui-scene-card-preview"
              style={{ background: scene.environment.background }}
            />
          )}
          <strong className="ui-scene-card-name">{row.name}</strong>
        </button>
        <div className="ui-scene-card-badges">
          {row.active && <span className="ui-badge">Active</span>}
          {scene.dmOnly && <span className="ui-badge">DM-only</span>}
          {viewing && !row.active && <span className="ui-badge">Viewing</span>}
          <button
            type="button"
            aria-label={`Options for ${row.name}`}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuFor(menuOpen ? null : row.id);
            }}
          >
            ⋯
          </button>
        </div>
        {menuOpen && (
          <div role="group" aria-label={`${row.name} options`} className="ui-scene-card-menu">
            {!row.active && (
              <button
                type="button"
                disabled={!isHost || scene.dmOnly === true}
                onClick={() => {
                  setMenuFor(null);
                  void send(sceneActivateIntent(row.id));
                }}
              >
                Set active
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                setSettingsFor(row.id);
              }}
            >
              Settings
            </button>
            <button
              type="button"
              disabled={!isHost || total <= 1}
              onClick={() => {
                setMenuFor(null);
                void send({ type: 'scene.delete', payload: { sceneId: row.id } });
              }}
            >
              Delete
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    // Named apart from the dock's Scenes tab panel, which hosts this view too.
    <section aria-label="Scene cards" className="ui-panel ui-scenes-view">
      <h2>Scenes</h2>
      {viewingOther && (
        <p className="ui-row">
          <span>
            Viewing {campaign.scenes[viewedId]?.name ?? ''}. Players are in{' '}
            {active?.name ?? 'no scene'}.
          </span>
          <button
            type="button"
            onClick={() => {
              sceneBrowseStore.getState().reset();
            }}
          >
            Back to active scene
          </button>
        </p>
      )}
      {total === 0 && <p>No scenes yet. Create the first one.</p>}
      {sceneFolders(campaign).map((group) => (
        <section
          key={group.folder ?? ''}
          className="ui-scene-folder"
          aria-label={group.folder === null ? 'Scenes without a folder' : `Folder ${group.folder}`}
        >
          {group.folder !== null && <h3>{group.folder}</h3>}
          <ul className="ui-scene-cards">{group.rows.map(card)}</ul>
        </section>
      ))}
      {settingsScene && (
        <SceneSettings scene={settingsScene} campaign={campaign} folders={folders} send={send}>
          <button
            type="button"
            onClick={() => {
              setSettingsFor(null);
            }}
          >
            Close settings
          </button>
        </SceneSettings>
      )}
      <h3>New scene</h3>
      <label>
        <input
          type="checkbox"
          checked={dmOnly}
          onChange={(e) => {
            setDmOnly(e.target.checked);
          }}
        />{' '}
        DM-only scene
      </label>
      <SceneCreateForm
        folders={folders}
        onSubmit={async (name, bounds, folder) => {
          const id = newId();
          const intent = sceneCreateIntent(id, name, bounds);
          const ok = await send({
            ...intent,
            payload: {
              sceneId: id,
              name: name.trim(),
              bounds,
              dmOnly,
              ...(folder ? { folder } : {}),
            },
          });
          if (ok) {
            sceneBrowseStore.getState().browse(id);
            setSettingsFor(id);
          }
          return ok;
        }}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function SceneSettings({
  scene,
  campaign,
  folders,
  send,
  children,
}: {
  scene: Scene;
  campaign: Campaign;
  folders: string[];
  send: ReturnType<typeof useSubmit>['send'];
  children: ReactNode;
}) {
  const stored = JSON.stringify([scene.name, scene.folder, scene.bounds, scene.grid.sizePx]);
  return (
    <section className="ui-scene-settings-panel" aria-label={`${scene.name} settings`}>
      <div className="ui-row">
        <h3>Settings: {scene.name}</h3>
        {children}
      </div>
      <SceneSettingsForm key={stored} scene={scene} folders={folders} send={send} />
      <h4>Background</h4>
      <BackgroundForm
        key={JSON.stringify(backgroundDraft(campaign, scene.id))}
        sceneId={scene.id}
        initial={backgroundDraft(campaign, scene.id)}
        skybox={scene.environment.skybox}
        send={send}
      />
    </section>
  );
}
