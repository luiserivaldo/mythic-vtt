import type { Campaign, LayerId, Scene } from '@mythic/shared';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { useStore } from 'zustand';
import { UploadError, uploadFailureMessage, type ImageUploader } from '../assets/image-upload.js';
import { selectionStore } from '../tools/selection-store.js';
import { useClientStore } from '../store/react.js';
import { defaultUploader } from './default-uploader.js';
import {
  capitalise,
  DEFAULT_TOKEN_COLOR,
  entityDeleteIntent,
  entityRenameIntent,
  entityShowGridOnTopIntent,
  entityRows,
  isValidColour,
  isValidEntityName,
  isValidPropSize,
  LABEL_VISIBILITIES,
  LAYER_LABELS,
  ownerOptions,
  PRIMITIVE_KINDS,
  propCreateIntent,
  tokenCreateIntent,
  TOKEN_SIZE_NAMES,
  type LabelVisibility,
  type PrimitiveKind,
  type TokenSizeName,
} from './entity-panel.js';
import { newId } from './ids.js';
import { entityMoveLayerIntent } from './intent-specs.js';
import { moveTargets } from './layer-panel.js';
import { NameForm } from './NameForm.js';
import { useSubmit, type SendIntent } from './submit.js';

/** Layers new entities can be created on: the host-only DM layer is offered to the host alone. */
function createLayers(isHost: boolean): LayerId[] {
  return isHost ? ['tokens', 'props', 'effects', 'dm'] : ['tokens', 'props', 'effects'];
}

function LayerSelect({
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

function TokenForm({
  campaign,
  scene,
  isHost,
  uploader,
  send,
  onError,
}: {
  campaign: Campaign;
  scene: Scene;
  isHost: boolean;
  send: SendIntent;
  uploader: ImageUploader;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [size, setSize] = useState<TokenSizeName>('medium');
  const [layer, setLayer] = useState<LayerId>('tokens');
  const [labels, setLabels] = useState<LabelVisibility>('all');
  const [owner, setOwner] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [color, setColor] = useState(DEFAULT_TOKEN_COLOR);
  const [busy, setBusy] = useState(false);
  const owners = useMemo(() => ownerOptions(campaign), [campaign]);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const uploaded = file ? await uploader(file) : null;
      const ok = await send(
        tokenCreateIntent(scene, {
          sceneId: scene.id,
          entityId: newId(),
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
      className="ui-row"
      aria-label="Create token"
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <label>
        Token name{' '}
        <input
          type="text"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
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
      <LayerSelect value={layer} layers={createLayers(isHost)} onChange={setLayer} />
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
      <label>
        Image (optional){' '}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
          }}
        />
      </label>
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
      <button type="submit" disabled={busy || !isValidEntityName(name)}>
        Create token
      </button>
    </form>
  );
}

function PropForm({
  scene,
  isHost,
  send,
  onError,
}: {
  scene: Scene;
  isHost: boolean;
  send: SendIntent;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PrimitiveKind>('box');
  const [color, setColor] = useState('#8a6d3b');
  const [sx, setSx] = useState('1');
  const [sy, setSy] = useState('1');
  const [sz, setSz] = useState('1');
  const [walkable, setWalkable] = useState(false);
  const [layer, setLayer] = useState<LayerId>('props');
  const [busy, setBusy] = useState(false);
  const size = { x: Number(sx), y: Number(sy), z: Number(sz) };
  const valid =
    isValidEntityName(name) &&
    isValidColour(color) &&
    isValidPropSize(size.x) &&
    isValidPropSize(size.y) &&
    isValidPropSize(size.z);

  const dim = (label: string, value: string, set: (v: string) => void) => (
    <label>
      {label}{' '}
      <input
        type="number"
        min="0.1"
        step="any"
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
      />
    </label>
  );

  return (
    <form
      className="ui-row"
      aria-label="Create prop"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        onError(null);
        void send(
          propCreateIntent(scene, {
            sceneId: scene.id,
            entityId: newId(),
            name,
            kind,
            color,
            size,
            walkable,
            layer,
          }),
        )
          .then((ok) => {
            if (ok) setName('');
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <label>
        Prop name{' '}
        <input
          type="text"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <label>
        Shape{' '}
        <select
          value={kind}
          onChange={(e) => {
            const next = PRIMITIVE_KINDS.find((k) => k === e.target.value);
            if (next) setKind(next);
          }}
        >
          {PRIMITIVE_KINDS.map((k) => (
            <option key={k} value={k}>
              {capitalise(k)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prop colour{' '}
        <input
          type="color"
          value={isValidColour(color) ? color : '#000000'}
          onChange={(e) => {
            setColor(e.target.value);
          }}
        />
      </label>
      {dim('Width (cells)', sx, setSx)}
      {dim('Height (cells)', sy, setSy)}
      {dim('Depth (cells)', sz, setSz)}
      <label>
        <input
          type="checkbox"
          checked={walkable}
          onChange={(e) => {
            setWalkable(e.target.checked);
          }}
        />{' '}
        Walkable
      </label>
      <LayerSelect value={layer} layers={createLayers(isHost)} onChange={setLayer} />
      <button type="submit" disabled={busy || !valid}>
        Create prop
      </button>
    </form>
  );
}

function EntityRowView({
  campaign,
  scene,
  entityId,
  send,
}: {
  campaign: Campaign;
  scene: Scene;
  entityId: string;
  send: SendIntent;
}) {
  const selected = useStore(
    selectionStore,
    (s) => s.sceneId === scene.id && s.ids.includes(entityId),
  );
  const [confirming, setConfirming] = useState(false);
  const entity = scene.entities[entityId];
  const row = useMemo(
    () => entityRows(campaign, scene).find((r) => r.id === entityId),
    [campaign, scene, entityId],
  );
  if (!entity || !row) return null;
  const targets = moveTargets(scene, entity);

  return (
    <li className="ui-entity" data-selected={selected}>
      <div className="ui-row">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => {
            selectionStore.getState().pick(scene.id, entityId, false);
          }}
        >
          {row.name}
        </button>
        <span className="ui-badge">{row.kind}</span>
        <span className="ui-badge">{row.layerLabel}</span>
        {row.owners && <span className="ui-badge">Owner: {row.owners}</span>}
      </div>
      {selected && (
        <div className="ui-row">
          <NameForm
            key={`${entityId}:${entity.name}`}
            label={`Rename ${entity.name}`}
            submitLabel="Rename"
            initial={entity.name}
            validate={(t) => isValidEntityName(t) && t.trim() !== entity.name}
            onSubmit={(t) => send(entityRenameIntent(scene.id, entityId, t))}
          />
          <label>
            Move {entity.name} to{' '}
            <select
              value=""
              onChange={(e) => {
                const target = targets.find((t) => t.layer === e.target.value);
                if (target) void send(entityMoveLayerIntent(scene.id, entityId, target.layer));
              }}
            >
              <option value="">Choose a layer</option>
              {targets.map((t) => (
                <option key={t.layer} value={t.layer} disabled={t.disabledReason !== null}>
                  {t.label}
                  {t.disabledReason ? ` (${t.disabledReason})` : ''}
                </option>
              ))}
            </select>
          </label>
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
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void send(entityDeleteIntent(scene.id, entityId)).then((ok) => {
                    if (ok) selectionStore.getState().clear();
                    setConfirming(false);
                  });
                }}
              >
                Confirm delete {entity.name}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete {entity.name}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** TOK-01, ENV-02: DM creates tokens and props, then selects, renames, re-layers or deletes them. */
export function EntityPanel({
  campaign,
  uploader = defaultUploader,
}: {
  campaign: Campaign;
  uploader?: ImageUploader;
}) {
  const isHost = useClientStore((s) => s.isHost);
  const [error, setError] = useState<string | null>(null);
  const { send, error: submitError } = useSubmit();
  const scene = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  const rows = useMemo(() => (scene ? entityRows(campaign, scene) : []), [campaign, scene]);

  if (!scene) {
    return (
      <section aria-labelledby="ui-entities-h" className="ui-panel">
        <h2 id="ui-entities-h">Entities</h2>
        <p>No active scene. Create and activate a scene first.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="ui-entities-h" className="ui-panel">
      <h2 id="ui-entities-h">Entities</h2>
      <TokenForm
        campaign={campaign}
        scene={scene}
        isHost={isHost}
        uploader={uploader}
        send={send}
        onError={setError}
      />
      <PropForm scene={scene} isHost={isHost} send={send} onError={setError} />
      <h3>In {scene.name}</h3>
      {rows.length === 0 && <p>Nothing here yet.</p>}
      <ul className="ui-list" aria-label="Entities in this scene">
        {rows.map((row) => (
          <EntityRowView
            key={row.id}
            campaign={campaign}
            scene={scene}
            entityId={row.id}
            send={send}
          />
        ))}
      </ul>
      {(error ?? submitError) && <p role="alert">{error ?? submitError}</p>}
    </section>
  );
}
