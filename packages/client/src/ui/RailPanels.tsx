import { useState, type ReactNode } from 'react';
import type { LayerId, Scene } from '@mythic/shared';
import { readViewCentre } from '../render/view-centre-store.js';
import { selectionStore } from '../tools/selection-store.js';
import {
  capitalise,
  entityCreateLayers,
  isValidColour,
  isValidEntityName,
  isValidPropSize,
  nextPropName,
  PRIMITIVE_KINDS,
  PROP_FORM_DEFAULTS,
  propCreateIntent,
  propViewPosition,
  type PrimitiveKind,
} from './entity-panel.js';
import { LayerSelect } from './EntityPanel.js';
import { newId } from './ids.js';
import { useSubmit } from './submit.js';

/** Line drawings of each primitive, sized for the shape picker. */
const SHAPE_ICONS: Readonly<Record<PrimitiveKind, ReactNode>> = {
  box: <path d="M10 2l7 4v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8" />,
  cylinder: (
    <>
      <ellipse cx="10" cy="5" rx="6" ry="2.5" />
      <path d="M4 5v10a6 2.5 0 0 0 12 0V5" />
    </>
  ),
  cone: (
    <>
      <path d="M10 2L4 15M10 2l6 13" />
      <ellipse cx="10" cy="15" rx="6" ry="2.5" />
    </>
  ),
  pyramid: <path d="M10 2L3 14l7 4 7-4zM10 2v16" />,
  sphere: (
    <>
      <circle cx="10" cy="10" r="7" />
      <ellipse cx="10" cy="10" rx="7" ry="2.5" />
    </>
  ),
  plane: <path d="M2 14l5-6h11l-5 6z" />,
  wedge: <path d="M3 16h10L3 8zM3 8l4-3M13 16l4-3M7 5l10 8" />,
};

/**
 * UI-TOOL-04 (MV-246): Create Prop's quick settings, opened in the left pane beside the rail.
 * Clicking a shape icon creates that prop at once (MV-266), with the fields as they stand: by
 * default a grey collidable 1x1x1 prop on the Props layer named "Prop N". It lands on the cell
 * centre in the middle of the view (the map centre if the view is off the map); heavy editing
 * (textures included) stays in the entity panel.
 */
export function CreatePropPanel({ scene, isHost }: { scene: Scene; isHost: boolean }) {
  const { send, error } = useSubmit();
  // null follows the sequential default, so it advances after each create.
  const [name, setName] = useState<string | null>(null);
  const [color, setColor] = useState<string>(PROP_FORM_DEFAULTS.color);
  const [sx, setSx] = useState(String(PROP_FORM_DEFAULTS.size.x));
  const [sy, setSy] = useState(String(PROP_FORM_DEFAULTS.size.y));
  const [sz, setSz] = useState(String(PROP_FORM_DEFAULTS.size.z));
  const [walkable, setWalkable] = useState<boolean>(PROP_FORM_DEFAULTS.walkable);
  const [layer, setLayer] = useState<LayerId>(PROP_FORM_DEFAULTS.layer);
  const [busy, setBusy] = useState(false);
  const shownName = name ?? nextPropName(scene);
  const size = { x: Number(sx), y: Number(sy), z: Number(sz) };
  const valid =
    isValidEntityName(shownName) &&
    isValidColour(color) &&
    isValidPropSize(size.x) &&
    isValidPropSize(size.y) &&
    isValidPropSize(size.z);

  async function create(kind: PrimitiveKind) {
    setBusy(true);
    try {
      const entityId = newId();
      const ok = await send(
        propCreateIntent(scene, {
          sceneId: scene.id,
          entityId,
          name: shownName,
          kind,
          color,
          size,
          walkable,
          layer,
          position: propViewPosition(scene, readViewCentre()),
        }),
      );
      if (ok) {
        setName(null);
        selectionStore.getState().pick(scene.id, entityId, false);
      }
    } finally {
      setBusy(false);
    }
  }

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
    <>
      <form
        className="ui-row ui-create-form ui-create-prop"
        aria-label="Create prop"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="ui-shape-picker" role="group" aria-label="Shape">
          {PRIMITIVE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-label={capitalise(k)}
              title={`Create a ${k}`}
              disabled={busy || !valid}
              onClick={() => {
                void create(k);
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {SHAPE_ICONS[k]}
              </svg>
            </button>
          ))}
        </div>
        <label>
          Prop name{' '}
          <input
            type="text"
            value={shownName}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        {dim('Width (cells)', sx, setSx)}
        {dim('Height (cells)', sy, setSy)}
        {dim('Depth (cells)', sz, setSz)}
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
        <label>
          <input
            type="checkbox"
            checked={walkable}
            onChange={(e) => {
              setWalkable(e.target.checked);
            }}
          />{' '}
          Collidable (walkable)
        </label>
        <LayerSelect value={layer} layers={entityCreateLayers(isHost)} onChange={setLayer} />
      </form>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
