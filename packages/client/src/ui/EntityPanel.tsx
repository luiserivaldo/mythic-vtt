import type { Campaign, Entity, LayerId, Scene } from '@mythic/shared';
import { useViewerPreferences } from './ViewerPreferencesProvider.js';
import { useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useStore } from 'zustand';
import { UploadError, uploadFailureMessage, type ImageUploader } from '../assets/image-upload.js';
import { focusStore } from '../render/focus-store.js';
import { canSelect, selectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { useClientStore } from '../store/react.js';
import { defaultUploader } from './default-uploader.js';
import {
  bulkDeleteIntents,
  bulkMoveIntents,
  capitalise,
  DEFAULT_TOKEN_COLOR,
  entityCreateLayers,
  entityFocusPoint,
  entityRenameIntent,
  entityShowGridOnTopIntent,
  entityTextureIntent,
  entityRows,
  isValidColour,
  isValidEntityName,
  LABEL_VISIBILITIES,
  LAYER_LABELS,
  layerForCreate,
  localImageAsset,
  ownerOptions,
  selectAllState,
  TOKEN_FORM_DEFAULTS,
  tokenCreateIntent,
  TOKEN_SIZE_NAMES,
  type LabelVisibility,
  type TokenSizeName,
} from './entity-panel.js';
import { newId } from './ids.js';
import type { IntentSpec } from './intent-specs.js';
import { LAYER_ORDER } from './layer-panel.js';
import { NameForm } from './NameForm.js';
import { useSubmit, type SendIntent } from './submit.js';
import { tokenMenuStore } from './token-menu-store.js';
import { useUiStore } from './ui-store.js';

export function LayerSelect({
  value,
  layers,
  onChange,
}: {
  value: LayerId;
  layers: LayerId[];
  onChange: (layer: LayerId) => void;
}) {
  return (
    <label>
      Layer{' '}
      <select
        value={value}
        onChange={(e) => {
          const next = layers.find((l) => l === e.target.value);
          if (next) onChange(next);
        }}
      >
        {layers.map((l) => (
          <option key={l} value={l}>
            {LAYER_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * UI-ENT-01 / UI-LAY-01: Add Token defaults to the viewer's active layer, and follow it
 * when it changes while the form stays mounted; the picker still overrides it per entity.
 */
function useCreateLayer(
  activeLayer: LayerId,
  isHost: boolean,
  fallback: LayerId,
): [LayerId, (layer: LayerId) => void] {
  const pick = (active: LayerId) => layerForCreate(active, entityCreateLayers(isHost), fallback);
  const [layer, setLayer] = useState<LayerId>(() => pick(activeLayer));
  const [followed, setFollowed] = useState(activeLayer);
  if (followed !== activeLayer) {
    setFollowed(activeLayer);
    setLayer(pick(activeLayer));
  }
  return [layer, setLayer];
}

function TokenForm({
  campaign,
  scene,
  isHost,
  activeLayer,
  uploader,
  send,
  onError,
}: {
  campaign: Campaign;
  scene: Scene;
  isHost: boolean;
  activeLayer: LayerId;
  send: SendIntent;
  uploader: ImageUploader;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState<string>(TOKEN_FORM_DEFAULTS.name);
  const [size, setSize] = useState<TokenSizeName>(TOKEN_FORM_DEFAULTS.size);
  const [layer, setLayer] = useCreateLayer(activeLayer, isHost, TOKEN_FORM_DEFAULTS.layer);
  const [labels, setLabels] = useState<LabelVisibility>(TOKEN_FORM_DEFAULTS.labelVisibility);
  const [owner, setOwner] = useState<string>(TOKEN_FORM_DEFAULTS.ownerId);
  const [file, setFile] = useState<File | null>(null);
  const [color, setColor] = useState<string>(TOKEN_FORM_DEFAULTS.color);
  const [busy, setBusy] = useState(false);
  const imageInputId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const owners = useMemo(() => ownerOptions(campaign), [campaign]);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const entityId = newId();
      const uploaded = file ? await uploader(file) : null;
      const ok = await send(
        tokenCreateIntent(scene, {
          sceneId: scene.id,
          entityId,
          name,
          size,
          layer,
          labelVisibility: labels,
          ownerId: owner || null,
          imageHash: uploaded?.hash ?? null,
          // The colour is only a placeholder for tokens without an image (D38).
          ...(file ? { imageName: name.trim() } : { color }),
        }),
      );
      if (ok) {
        setName('');
        setFile(null);
        selectionStore.getState().pick(scene.id, entityId, false);
        nameInputRef.current?.focus();
      }
    } catch (e) {
      onError(
        e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed unexpectedly.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="ui-row ui-create-form"
      aria-label="Create token"
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <label>
        Token name{' '}
        <input
          ref={nameInputRef}
          type="text"
          value={name}
          required
          maxLength={120}
          aria-describedby={!isValidEntityName(name) ? 'token-name-requirement' : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      {!isValidEntityName(name) && (
        <span id="token-name-requirement" className="ui-validation">
          Enter a token name.
        </span>
      )}
      <label>
        Size{' '}
        <select
          value={size}
          onChange={(e) => {
            const next = TOKEN_SIZE_NAMES.find((s) => s === e.target.value);
            if (next) setSize(next);
          }}
        >
          {TOKEN_SIZE_NAMES.map((s) => (
            <option key={s} value={s}>
              {capitalise(s)}
            </option>
          ))}
        </select>
      </label>
      <LayerSelect value={layer} layers={entityCreateLayers(isHost)} onChange={setLayer} />
      <label>
        Label shown to{' '}
        <select
          value={labels}
          onChange={(e) => {
            const next = LABEL_VISIBILITIES.find((v) => v.value === e.target.value);
            if (next) setLabels(next.value);
          }}
        >
          {LABEL_VISIBILITIES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Owner{' '}
        <select
          value={owner}
          onChange={(e) => {
            setOwner(e.target.value);
          }}
        >
          <option value="">No owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="ui-file-field" role="group" aria-labelledby={`${imageInputId}-title`}>
        <span id={`${imageInputId}-title`}>Image (optional)</span>
        <input
          id={imageInputId}
          className="ui-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-labelledby={`${imageInputId}-title ${imageInputId}-button`}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        <label id={`${imageInputId}-button`} className="ui-file-button" htmlFor={imageInputId}>
          Choose file
        </label>
        <span className="ui-file-name">{file?.name ?? 'No file chosen'}</span>
      </div>
      <label>
        Colour (no image){' '}
        <input
          type="color"
          value={isValidColour(color) ? color : DEFAULT_TOKEN_COLOR}
          disabled={file !== null}
          onChange={(e) => {
            setColor(e.target.value);
          }}
        />
      </label>
      <button
        className="ui-primary-action"
        type="submit"
        disabled={busy || !isValidEntityName(name)}
      >
        Create token
      </button>
    </form>
  );
}

const NO_IDS: readonly string[] = [];

function EntityRowView({
  campaign,
  scene,
  entityId,
  selectable,
  editing,
  send,
  uploader,
  onError,
  onDelete,
}: {
  campaign: Campaign;
  scene: Scene;
  entityId: string;
  /** PERM-01/02: the board would drop it from the selection (a locked layer), so no row actions. */
  selectable: boolean;
  /** Only the sole selected row expands its editor; a bulk selection stays one line per row. */
  editing: boolean;
  send: SendIntent;
  uploader: ImageUploader;
  onError: (message: string | null) => void;
  onDelete: (ids: string[]) => void;
}) {
  const selected = useStore(
    selectionStore,
    (s) => s.sceneId === scene.id && s.ids.includes(entityId),
  );
  const [textureBusy, setTextureBusy] = useState(false);
  const textureInputId = useId();
  const entity = scene.entities[entityId];
  const row = useMemo(
    () => entityRows(campaign, scene).find((r) => r.id === entityId),
    [campaign, scene, entityId],
  );
  if (!entity || !row) return null;
  const shape = entity.shape;
  const entityName = entity.name;
  const blocked = selectable ? undefined : `${row.layerLabel} is locked`;

  /** ENV-05: upload an image and store it as the prop's texture (entity.update replaces the shape). */
  async function setTexture(current: NonNullable<Entity['shape']>, file: File) {
    setTextureBusy(true);
    onError(null);
    try {
      const uploaded = await uploader(file);
      const ok = await send(
        entityTextureIntent(
          scene.id,
          entityId,
          current,
          localImageAsset(uploaded.hash, entityName),
        ),
      );
      if (!ok) onError('The texture was not applied.');
    } catch (e) {
      onError(
        e instanceof UploadError ? uploadFailureMessage(e) : 'The upload failed unexpectedly.',
      );
    } finally {
      setTextureBusy(false);
    }
  }

  /** UI-ENT-02 / CAM-06: a local camera move, never an action and never sent. */
  const centre = () => {
    const at = entityFocusPoint(entity);
    focusStore.getState().request(at.x, at.y, at.z);
  };

  /** UI-ENT-02: a token opens its full menu (UI-TOKEN-02); anything else opens the row editor. */
  const openMenu = () => {
    selectionStore.getState().pick(scene.id, entityId, false);
    if (entity.token) tokenMenuStore.getState().open(entityId);
  };

  return (
    <li className="ui-entity" data-selected={selected}>
      <div className="ui-entity-row">
        <input
          type="checkbox"
          aria-label={`Select ${row.name}`}
          title={blocked}
          checked={selected}
          disabled={!selectable}
          onChange={() => {
            selectionStore.getState().pick(scene.id, entityId, true);
          }}
        />
        <button
          type="button"
          className="ui-entity-name"
          aria-pressed={selected}
          title="Double-click to centre the view"
          onClick={() => {
            selectionStore.getState().pick(scene.id, entityId, false);
          }}
          onDoubleClick={centre}
        >
          {row.name}
        </button>
        <span className="ui-entity-actions">
          <button
            type="button"
            className="ui-icon-button"
            aria-label={`Open menu for ${row.name}`}
            title={blocked ?? (entity.token ? 'Token menu' : 'Edit')}
            disabled={!selectable}
            onClick={openMenu}
          >
            ⋯
          </button>
          <button
            type="button"
            className="ui-icon-button"
            aria-label={`Centre view on ${row.name}`}
            title="Centre view"
            onClick={centre}
          >
            ⌖
          </button>
          <button
            type="button"
            className="ui-icon-button ui-danger-button"
            aria-label={`Delete ${row.name}`}
            title={blocked ?? 'Delete'}
            disabled={!selectable}
            onClick={() => {
              onDelete([entityId]);
            }}
          >
            🗑
          </button>
        </span>
        <span className="ui-entity-badges">
          <span className="ui-badge">{row.kind}</span>
          <span className="ui-badge">{row.layerLabel}</span>
          {row.owners && <span className="ui-badge">Owner: {row.owners}</span>}
        </span>
      </div>
      {selected && editing && (
        <div className="ui-row">
          <NameForm
            key={`${entityId}:${entity.name}`}
            label={`Rename ${entity.name}`}
            submitLabel="Rename"
            initial={entity.name}
            validate={(t) => isValidEntityName(t) && t.trim() !== entity.name}
            onSubmit={(t) => send(entityRenameIntent(scene.id, entityId, t))}
          />
          {entity.shape?.walkable && (
            <label>
              <input
                type="checkbox"
                checked={entity.shape.showGridOnTop === true}
                onChange={(e) => {
                  if (entity.shape)
                    void send(
                      entityShowGridOnTopIntent(scene.id, entityId, entity.shape, e.target.checked),
                    );
                }}
              />{' '}
              Show grid on top of {entity.name}
            </label>
          )}
          {shape && (
            <div className="ui-file-field" role="group" aria-labelledby={`${textureInputId}-title`}>
              <span id={`${textureInputId}-title`}>
                Texture for {entityName} (tiles once per cell)
              </span>
              <input
                id={textureInputId}
                className="ui-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={textureBusy}
                aria-labelledby={`${textureInputId}-title ${textureInputId}-button`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void setTexture(shape, file);
                }}
              />
              <label
                id={`${textureInputId}-button`}
                className="ui-file-button"
                htmlFor={textureInputId}
              >
                {shape.texture ? 'Replace texture' : 'Set texture'}
              </label>
              {shape.texture && (
                <button
                  type="button"
                  onClick={() => {
                    void send(entityTextureIntent(scene.id, entityId, shape, null));
                  }}
                >
                  Remove texture from {entityName}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * UI-ENT-03 / DESIGN §12.5: the delete confirmation. Keep takes focus so Enter never deletes by
 * accident; Escape keeps too.
 */
function DeleteConfirm({
  label,
  busy,
  onConfirm,
  onKeep,
}: {
  label: string;
  busy: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
  }, [label]);
  return (
    <section
      className="ui-confirm"
      role="alertdialog"
      aria-labelledby="ui-entity-delete-h"
      aria-describedby="ui-entity-delete-d"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onKeep();
      }}
    >
      <h3 id="ui-entity-delete-h">Delete {label}?</h3>
      <p id="ui-entity-delete-d">
        Everyone at the table loses it. You can turn this prompt off in Settings.
      </p>
      <div className="ui-row">
        <button type="button" className="ui-danger-button" disabled={busy} onClick={onConfirm}>
          Confirm delete {label}
        </button>
        <button ref={keepRef} type="button" onClick={onKeep}>
          Keep
        </button>
      </div>
    </section>
  );
}

/**
 * TOK-01, ENV-02, UI-ENT-01..03: the DM creates tokens and props on the active layer, and selects,
 * re-layers or deletes them in bulk. Bulk changes are one action per entity through the pipeline.
 */
export function EntityPanel({
  campaign,
  uploader = defaultUploader,
}: {
  campaign: Campaign;
  uploader?: ImageUploader;
}) {
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const activeLayer = useUiStore((s) => s.activeLayer);
  const { preferences } = useViewerPreferences();
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { send, error: submitError } = useSubmit();
  const scene = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  const rows = useMemo(() => (scene ? entityRows(campaign, scene) : []), [campaign, scene]);
  // PERM-01/02: exactly the rows the board would keep selected (validSelection uses canSelect).
  const selectableIds = useMemo(() => {
    if (!scene) return [];
    const actor = selectionActor(isHost, seatId, campaign.seats);
    return rows
      .filter((r) => {
        const entity = scene.entities[r.id];
        return entity !== undefined && canSelect(entity, scene, actor);
      })
      .map((r) => r.id);
  }, [rows, scene, isHost, seatId, campaign.seats]);
  const selectedIds = useStore(selectionStore, (s) =>
    scene && s.sceneId === scene.id ? s.ids : NO_IDS,
  );
  const selected = selectableIds.filter((id) => selectedIds.includes(id));
  const allState = selectAllState(selectableIds, selectedIds);
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = allState === 'some';
  }, [allState]);

  if (!scene) {
    return (
      <section aria-labelledby="ui-entities-h" className="ui-panel">
        <h2 id="ui-entities-h">Entities</h2>
        <p>No active scene. Create and activate a scene first.</p>
      </section>
    );
  }
  const sceneId = scene.id;

  /** Sends each intent in turn; one refusal does not stop the rest. */
  async function sendAll(specs: readonly IntentSpec[]): Promise<void> {
    setBusy(true);
    setError(null);
    let failed = 0;
    try {
      for (const spec of specs) if (!(await send(spec))) failed += 1;
    } finally {
      setBusy(false);
    }
    if (failed > 0 && specs.length > 1)
      setError(`The host did not accept ${String(failed)} of ${String(specs.length)} changes.`);
  }

  const deleteNow = (ids: string[]) => {
    void sendAll(bulkDeleteIntents(sceneId, ids)).then(() => {
      setPendingDelete(null);
    });
  };
  /** UI-ENT-03: confirm first unless this viewer turned "Confirm before deleting" off. */
  const requestDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    if (preferences.confirmBeforeDeleting) setPendingDelete(ids);
    else deleteNow(ids);
  };
  const pendingLabel =
    pendingDelete?.length === 1
      ? (scene.entities[pendingDelete[0] ?? '']?.name ?? '1 entity')
      : `${String(pendingDelete?.length ?? 0)} entities`;
  const moveLayers = LAYER_ORDER.filter((l) => entityCreateLayers(isHost).includes(l));

  return (
    <section aria-labelledby="ui-entities-h" className="ui-panel">
      <h2 id="ui-entities-h">Entities</h2>
      <TokenForm
        campaign={campaign}
        scene={scene}
        isHost={isHost}
        activeLayer={activeLayer}
        uploader={uploader}
        send={send}
        onError={setError}
      />
      <h3>In {scene.name}</h3>
      {rows.length === 0 ? (
        <p>Nothing here yet.</p>
      ) : (
        <div className="ui-entity-bulk" role="toolbar" aria-label="Selected entities">
          <label>
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allState === 'all'}
              disabled={selectableIds.length === 0}
              onChange={() => {
                selectionStore
                  .getState()
                  .reconcile(sceneId, allState === 'all' ? [] : selectableIds);
              }}
            />{' '}
            Select all
          </label>
          <span className="ui-entity-count" aria-live="polite">
            {selected.length} selected
          </span>
          <select
            aria-label="Move selected to layer"
            value=""
            disabled={busy || selected.length === 0}
            onChange={(e) => {
              const layer = moveLayers.find((l) => l === e.target.value);
              if (layer) void sendAll(bulkMoveIntents(scene, selected, layer));
            }}
          >
            <option value="">Move to layer…</option>
            {moveLayers.map((l) => (
              <option key={l} value={l} disabled={scene.layers[l]?.locked === true}>
                {LAYER_LABELS[l]}
                {scene.layers[l]?.locked ? ' (locked)' : ''}
              </option>
            ))}
          </select>
          {/* UI-ENT-01: the state has no per-entity lock yet (only layer locks), so this is an
              honest WIP placeholder (UIUX §1.7) until that contract exists. */}
          <button type="button" disabled title="Locking single entities is not available yet">
            Lock <span className="ui-badge">WIP</span>
          </button>
          <button
            type="button"
            className="ui-danger-button"
            disabled={busy || selected.length === 0}
            onClick={() => {
              requestDelete(selected);
            }}
          >
            Delete selected
          </button>
        </div>
      )}
      {pendingDelete && (
        <DeleteConfirm
          label={pendingLabel}
          busy={busy}
          onConfirm={() => {
            deleteNow(pendingDelete);
          }}
          onKeep={() => {
            setPendingDelete(null);
          }}
        />
      )}
      <ul className="ui-list" aria-label="Entities in this scene">
        {rows.map((row) => (
          <EntityRowView
            key={row.id}
            campaign={campaign}
            scene={scene}
            entityId={row.id}
            selectable={selectableIds.includes(row.id)}
            editing={selected.length === 1}
            send={send}
            uploader={uploader}
            onError={setError}
            onDelete={requestDelete}
          />
        ))}
      </ul>
      {(error ?? submitError) && <p role="alert">{error ?? submitError}</p>}
    </section>
  );
}
