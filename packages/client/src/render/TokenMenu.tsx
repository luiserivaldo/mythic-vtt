import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Actor, AssetRef, Campaign, Entity, Scene } from '@mythic/shared';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import { useStore } from 'zustand';
import { UploadError, uploadFailureMessage, type ImageUploader } from '../assets/image-upload.js';
import { useClientStore } from '../store/react.js';
import { nextElevation, formatUnits } from '../tools/elevation.js';
import { viewActor, type SelectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { defaultUploader } from '../ui/default-uploader.js';
import { isValidEntityName, LAYER_LABELS } from '../ui/entity-panel.js';
import { seeSheet } from '../ui/sheet-panel.js';
import { useSubmit } from '../ui/submit.js';
import { tokenMenuStore } from '../ui/token-menu-store.js';
import {
  TOKEN_CONTEXT_LABELS,
  TOKEN_MENU_LABELS,
  tokenContextMenu,
  tokenDeleteIntent,
  tokenFlyingIntent,
  tokenHeightIntent,
  tokenImageIntent,
  tokenLayerIntent,
  tokenLayerTargets,
  tokenMenuAnchor,
  tokenMenuHeight,
  tokenMenuModel,
  tokenMenuName,
  tokenRenameIntent,
  type TokenMenuField,
  type TokenMenuFieldId,
} from '../ui/token-menu.js';
import { useViewerPreferences } from '../ui/ViewerPreferencesProvider.js';
import { LABEL_BACKGROUND_COLOR, LABEL_TEXT_COLOR } from './canvas-style.js';
import type { RenderScene } from './scene-model.js';

// UI-TOKEN-02 / UI-TOKEN-03. Both menus are screen-space HTML anchored to the token (CAM-04), so
// they never scale with the zoom and work in 2D and in 3D. The right-click menu sits to the right
// of the token; the full menu clears the quick preview card, which stays visible underneath.
//
// The panel is inside the canvas container, which is also where R3F listens for presses on the
// board, so every pointer event that starts inside a menu is stopped in the capture phase — the
// same guard the preview card's gear uses. A press inside a menu must never read as a board press.

/** UI-TOKEN-02: the card is screen-space and about this tall; the full menu clears it. */
const MENU_ABOVE_CARD_PX = 112;

const panelStyle = {
  minWidth: 200,
  padding: '6px 8px',
  borderRadius: 6,
  background: LABEL_BACKGROUND_COLOR,
  color: LABEL_TEXT_COLOR,
  boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
  fontSize: 13,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  display: 'grid',
  gap: 4,
  pointerEvents: 'auto',
} as const satisfies CSSProperties;

const headStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'space-between',
} as const satisfies CSSProperties;

const listStyle = { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 2 } as const;

const rowStyle = { display: 'flex', alignItems: 'center', gap: 6 } as const satisfies CSSProperties;

const stopBoardPress = (event: SyntheticEvent) => {
  event.stopPropagation();
};

/**
 * UI-TOKEN-02 / UI-TOKEN-03: which menu is open, for the token both menus belong to. One menu at a
 * time (the store guarantees it); a menu whose token leaves the selection closes with it (PERM-01).
 */
export function TokenMenus({
  scene,
  rendered,
  mode,
  uploader = defaultUploader,
}: {
  scene: Scene | null;
  rendered: RenderScene | null;
  mode: '2d' | '3d';
  /** Injectable so tests never need a real host (same seam as the entity panel). */
  uploader?: ImageUploader;
}) {
  const campaign = useClientStore((state) => state.campaign);
  const isHost = useClientStore((state) => state.isHost);
  const seatId = useClientStore((state) => state.seatId);
  const previewSeatId = useClientStore((state) => state.previewSeatId);
  const selection = useStore(selectionStore, (state) => state.ids);
  const fullId = useStore(tokenMenuStore, (state) => state.entityId);
  const contextId = useStore(tokenMenuStore, (state) => state.contextEntityId);
  const { preferences } = useViewerPreferences();
  const invalidate = useThree((state) => state.invalidate);

  const source = (id: string | null) => (id === null ? undefined : scene?.entities[id]);
  const shown = (id: string | null) =>
    id === null ? undefined : rendered?.entities.find((entity) => entity.id === id);
  const fullEntity = source(fullId);
  const contextEntity = source(contextId);
  const fullShown = shown(fullId);
  const contextShown = shown(contextId);

  // A frame right after a menu opens gives it its z-index and keeps it in front of the labels.
  useEffect(() => {
    if (fullId !== null || contextId !== null) invalidate();
  }, [invalidate, fullId, contextId]);

  // A menu only ever belongs to a selected token: opening one for anything else closes it at once,
  // exactly as losing the selection closes it (PERM-01).
  useEffect(() => {
    tokenMenuStore.getState().reconcile(selection);
  }, [selection, fullId, contextId]);

  if (!scene || !campaign) return null;
  const actor: Actor = isHost
    ? { kind: 'host' }
    : seatId === null
      ? { kind: 'seat' }
      : { kind: 'seat', seatId };
  const viewer: SelectionActor = viewActor({
    isHost,
    seatId,
    previewSeatId,
    seats: campaign.seats,
  });

  return (
    <>
      {fullEntity && fullShown && (
        <FullTokenMenu
          key={fullEntity.id}
          campaign={campaign}
          scene={scene}
          entity={fullEntity}
          rendered={fullShown}
          mode={mode}
          actor={actor}
          viewer={viewer}
          uploader={uploader}
          confirmBeforeDeleting={preferences.confirmBeforeDeleting}
        />
      )}
      {contextEntity && contextShown && (
        <TokenContextMenu
          key={contextEntity.id}
          campaign={campaign}
          scene={scene}
          entity={contextEntity}
          rendered={contextShown}
          mode={mode}
          actor={actor}
          viewer={viewer}
        />
      )}
    </>
  );
}

interface MenuProps {
  campaign: Campaign;
  scene: Scene;
  entity: Entity;
  rendered: RenderScene['entities'][number];
  mode: '2d' | '3d';
  actor: Actor;
  viewer: SelectionActor;
}

/** UI-TOKEN-02: the full menu. Fields the viewer cannot edit are shown disabled, with a reason. */
function FullTokenMenu({
  campaign,
  scene,
  entity,
  rendered,
  mode,
  actor,
  viewer,
  uploader,
  confirmBeforeDeleting,
}: MenuProps & { uploader: ImageUploader; confirmBeforeDeleting: boolean }) {
  const { send, error } = useSubmit();
  const grid = scene.grid;
  const cells = entity.transform.position.y;
  const model = useMemo(
    () => tokenMenuModel({ campaign, scene, entity, actor, viewer }),
    [campaign, scene, entity, actor, viewer],
  );
  const [name, setName] = useState(() => tokenMenuName(entity, viewer));
  const [typedHeight, setTypedHeight] = useState<string | null>(null);
  const [heightError, setHeightError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const imageId = useId();
  const heightId = useId();
  const anchor = tokenMenuAnchor(mode, rendered.position, rendered.sizeCells);

  const field = (id: TokenMenuFieldId): TokenMenuField =>
    model.fields.find((entry) => entry.id === id) ?? {
      id,
      label: TOKEN_MENU_LABELS[id],
      enabled: false,
      disabledReason: null,
    };

  const sendIntent = async (spec: Parameters<typeof send>[0]): Promise<boolean> => {
    setBusy(true);
    try {
      return await send(spec);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    tokenMenuStore.getState().close();
  };

  /** TOK-01: rename commits on Enter or on the button; the name is trimmed like the panel's. */
  const rename = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!isValidEntityName(name) || name.trim() === entity.name) return;
    void sendIntent(tokenRenameIntent(scene.id, entity.id, name));
  };

  /** TOK-03 / D25: the typed height is in scene units; the field keeps it until the host accepts. */
  const applyHeight = () => {
    const parsed = tokenMenuHeight(typedHeight ?? formatUnits(cells, grid.unitsPerCell), grid);
    if (!parsed.ok) {
      setHeightError(parsed.reason);
      return;
    }
    setHeightError(null);
    void sendIntent(tokenHeightIntent(scene.id, entity.id, parsed.cells)).then((ok) => {
      if (ok) setTypedHeight(null);
    });
  };

  /** ENV-01 / TOK-01: upload first, then send the whole viewer-visible token back with its image. */
  const changeImage = async (chosen: File) => {
    if (!entity.token) return;
    setBusy(true);
    setUploadError(null);
    try {
      const uploaded = await uploader(chosen);
      const image: AssetRef = {
        source: 'local',
        hash: uploaded.hash,
        kind: 'image',
        name: chosen.name,
      };
      await send(tokenImageIntent(scene.id, entity.id, entity.token, image));
    } catch (e) {
      setUploadError(
        e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed unexpectedly.',
      );
    } finally {
      setBusy(false);
    }
  };

  /** PERM-02: delete is confirmed unless this viewer turned that off in Settings. */
  const remove = async () => {
    const ok = await sendIntent(tokenDeleteIntent(scene.id, entity.id));
    if (ok) {
      selectionStore.getState().clear();
      close();
    }
    setConfirming(false);
  };

  const nameField = field('name');
  const imageField = field('image');
  const heightField = field('height');
  const flyingField = field('flying');
  const layerField = field('layer');
  const deleteField = field('delete');
  const reason = (entry: TokenMenuField) => entry.disabledReason ?? undefined;

  return (
    <Html
      center={false}
      position={[...anchor]}
      zIndexRange={[10, 0]}
      style={{
        transform: `translate(-50%, calc(-100% - ${String(MENU_ABOVE_CARD_PX)}px))`,
        pointerEvents: 'none',
      }}
    >
      <section
        data-testid="token-menu"
        role="menu"
        aria-label="Token options"
        style={panelStyle}
        onPointerDownCapture={stopBoardPress}
        onPointerUpCapture={stopBoardPress}
        // Bubble, not capture: a menu is full of buttons and fields, and a capture handler on the
        // panel would stop the event before the control's own handler ran. Stopping it here still
        // keeps the press from reaching the board's listener on the canvas container.
        onClick={stopBoardPress}
        onDoubleClickCapture={stopBoardPress}
        onContextMenuCapture={stopBoardPress}
      >
        <header style={headStyle}>
          <strong data-testid="token-menu-name">{model.name}</strong>
          <button type="button" aria-label="Close token menu" onClick={close}>
            ✕
          </button>
        </header>

        <form style={rowStyle} onSubmit={rename}>
          <label>
            {TOKEN_MENU_LABELS.name}{' '}
            <input
              type="text"
              value={name}
              maxLength={120}
              disabled={!nameField.enabled || busy}
              title={reason(nameField)}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <button
            type="submit"
            disabled={
              !nameField.enabled || busy || !isValidEntityName(name) || name.trim() === entity.name
            }
          >
            Rename
          </button>
        </form>

        <div style={rowStyle} role="group" aria-label={TOKEN_MENU_LABELS.image}>
          <input
            id={imageId}
            className="ui-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!imageField.enabled || busy}
            title={reason(imageField)}
            aria-labelledby={`${imageId}-button`}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen) void changeImage(chosen);
            }}
          />
          <label id={`${imageId}-button`} className="ui-file-button" htmlFor={imageId}>
            {TOKEN_MENU_LABELS.image}: Choose file
          </label>
        </div>

        <div style={rowStyle} role="group" aria-label={TOKEN_MENU_LABELS.height}>
          <button
            type="button"
            aria-label="Lower height"
            disabled={!heightField.enabled || busy}
            onClick={(event) => {
              void sendIntent(
                tokenHeightIntent(
                  scene.id,
                  entity.id,
                  nextElevation(cells, grid, -1, event.shiftKey),
                ),
              );
            }}
          >
            −
          </button>
          <label className="ui-field" htmlFor={heightId}>
            {TOKEN_MENU_LABELS.height} ({grid.unitLabel})
            <input
              id={heightId}
              type="text"
              inputMode="decimal"
              disabled={!heightField.enabled || busy}
              title={reason(heightField)}
              value={typedHeight ?? formatUnits(cells, grid.unitsPerCell)}
              onChange={(event) => {
                setTypedHeight(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyHeight();
                }
              }}
            />
          </label>
          <button
            type="button"
            aria-label="Raise height"
            disabled={!heightField.enabled || busy}
            onClick={(event) => {
              void sendIntent(
                tokenHeightIntent(
                  scene.id,
                  entity.id,
                  nextElevation(cells, grid, 1, event.shiftKey),
                ),
              );
            }}
          >
            +
          </button>
          <label>
            <input
              type="checkbox"
              aria-label={TOKEN_MENU_LABELS.flying}
              checked={entity.token?.flying === true}
              disabled={!flyingField.enabled || busy}
              title={reason(flyingField)}
              onChange={(event) => {
                void sendIntent(tokenFlyingIntent(scene.id, entity.id, event.target.checked));
              }}
            />{' '}
            {TOKEN_MENU_LABELS.flying}
          </label>
        </div>

        <label>
          {TOKEN_MENU_LABELS.layer}{' '}
          <select
            value={entity.layer}
            disabled={!layerField.enabled || busy}
            title={reason(layerField)}
            onChange={(event) => {
              const target = model.layers.find((entry) => entry.layer === event.target.value);
              if (target) void sendIntent(tokenLayerIntent(scene.id, entity.id, target.layer));
            }}
          >
            <option value={entity.layer}>{LAYER_LABELS[entity.layer]}</option>
            {model.layers.map((target) => (
              <option key={target.layer} value={target.layer} disabled={!target.enabled}>
                {target.label}
                {target.reason ? ` (${target.reason})` : ''}
              </option>
            ))}
          </select>
        </label>

        {confirming ? (
          <div style={rowStyle}>
            <button
              type="button"
              aria-label={`Confirm delete ${model.name}`}
              disabled={busy}
              onClick={() => {
                void remove();
              }}
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!deleteField.enabled || busy}
            title={reason(deleteField)}
            onClick={() => {
              if (confirmBeforeDeleting) setConfirming(true);
              else void remove();
            }}
          >
            {TOKEN_MENU_LABELS.delete}
          </button>
        )}

        {(heightError ?? uploadError ?? error) && (
          <p role="alert">{heightError ?? uploadError ?? error}</p>
        )}
        {typedHeight !== null && heightError === null && (
          <button type="button" disabled={busy} onClick={applyHeight}>
            Set height
          </button>
        )}
      </section>
    </Html>
  );
}

/** UI-TOKEN-03: the short curated list, to the right of the token. */
function TokenContextMenu({ campaign, scene, entity, rendered, mode, actor, viewer }: MenuProps) {
  const { send } = useSubmit();
  const [layersOpen, setLayersOpen] = useState(false);
  const items = useMemo(
    () => tokenContextMenu({ campaign, scene, entity, actor, viewer }),
    [campaign, scene, entity, actor, viewer],
  );
  const targets = useMemo(
    () => tokenLayerTargets({ campaign, scene, entity, actor, viewer }),
    [campaign, scene, entity, actor, viewer],
  );
  const anchor = tokenMenuAnchor(mode, rendered.position, rendered.sizeCells);
  if (items.length === 0) return null;

  /**
   * Every curated item, handled exhaustively: a WIP placeholder has no behaviour (UIUX §1.7) and
   * Change Layer is the submenu below, so neither is wired to a plain command.
   */
  const body = (id: (typeof items)[number]['id']) => {
    switch (id) {
      case 'see-sheet':
        return (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // UI-SHEET-01: jumps the dock to the Sheet tab (the sheet itself is WIP until M7).
              tokenMenuStore.getState().close();
              seeSheet();
            }}
          >
            {TOKEN_CONTEXT_LABELS['see-sheet']}
          </button>
        );
      case 'add-condition':
        return (
          <button type="button" role="menuitem" disabled aria-disabled="true">
            {TOKEN_CONTEXT_LABELS['add-condition']}
            <span className="ui-badge"> WIP</span>
          </button>
        );
      case 'change-layer':
        return (
          <>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={layersOpen}
              disabled={!items.find((item) => item.id === id)?.enabled}
              onClick={() => {
                setLayersOpen((open) => !open);
              }}
            >
              {TOKEN_CONTEXT_LABELS['change-layer']}
            </button>
            {layersOpen && (
              <ul role="menu" aria-label={TOKEN_CONTEXT_LABELS['change-layer']} style={listStyle}>
                {targets.map((target) => (
                  <li key={target.layer} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!target.enabled}
                      title={target.reason ?? undefined}
                      onClick={() => {
                        tokenMenuStore.getState().close();
                        void send(tokenLayerIntent(scene.id, entity.id, target.layer));
                      }}
                    >
                      {target.label}
                      {target.reason ? ` (${target.reason})` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      case 'token-options':
        return (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              // UI-TOKEN-02: the full menu, which replaces this one (one menu at a time).
              tokenMenuStore.getState().open(entity.id);
            }}
          >
            {TOKEN_CONTEXT_LABELS['token-options']}
          </button>
        );
    }
  };

  return (
    <Html
      center={false}
      position={[...anchor]}
      zIndexRange={[10, 0]}
      style={{ transform: 'translate(6px, -50%)', pointerEvents: 'none' }}
    >
      <ul
        data-testid="token-context-menu"
        role="menu"
        aria-label="Token actions"
        style={panelStyle}
        onPointerDownCapture={stopBoardPress}
        onPointerUpCapture={stopBoardPress}
        onClick={stopBoardPress}
        onDoubleClickCapture={stopBoardPress}
        onContextMenuCapture={stopBoardPress}
      >
        {items.map((item) => (
          <li key={item.id} role="none" title={item.reason ?? undefined}>
            {body(item.id)}
          </li>
        ))}
      </ul>
    </Html>
  );
}
