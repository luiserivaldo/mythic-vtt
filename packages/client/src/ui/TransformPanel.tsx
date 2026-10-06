import type { Entity, Scene } from '@mythic/shared';
import { useContext, useId, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { commitTransform } from '../tools/gizmo-commit.js';
import { elevationFromUnits, formatUnits, nextElevation } from '../tools/elevation.js';
import { gizmoStore } from '../tools/gizmo-store.js';
import {
  draftFromEntity,
  formatTyped,
  parseNumber,
  parseTypedValues,
  type TypedField,
  type TypedInput,
} from '../tools/transform-gizmo.js';
import { useGizmoTarget } from '../tools/use-gizmo-target.js';
import { describeFailure, SubmitContext } from './submit.js';

/** ENV-03: numeric entry for the selected entity. Numbers live in HTML, never in the scene. */
export function TransformPanel() {
  const target = useGizmoTarget();
  if (!target) return null;
  return <TransformFields key={target.entity.id} entity={target.entity} scene={target.scene} />;
}

const FIELDS: readonly { field: TypedField; label: (unit: string) => string }[] = [
  { field: 'x', label: (unit) => `X (${unit})` },
  { field: 'z', label: (unit) => `Z (${unit})` },
  { field: 'rotation', label: () => 'Rotation (deg)' },
  { field: 'scale', label: () => 'Scale' },
];

function TransformFields({ entity, scene }: { entity: Entity; scene: Scene }) {
  const submit = useContext(SubmitContext);
  const preview = useStore(gizmoStore, (s) => s.preview);
  const error = useStore(gizmoStore, (s) => s.error);
  const busy = useStore(gizmoStore, (s) => s.busy);
  const [typed, setTyped] = useState<TypedInput | null>(null);
  const [errors, setErrors] = useState<Partial<Record<TypedField, string>>>({});
  const headingId = useId();
  const { unitsPerCell, unitLabel } = scene.grid;

  // While nothing is being typed the fields mirror the live drag preview, then the stored state.
  const shown =
    typed ??
    formatTyped(
      preview && preview.entityId === entity.id ? preview.draft : draftFromEntity(entity),
      unitsPerCell,
    );

  const apply = () => {
    const parsed = parseTypedValues(shown, unitsPerCell);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    if (!submit) return;
    gizmoStore.getState().begin({
      sceneId: scene.id,
      entityId: entity.id,
      draft: parsed.draft,
      base: entity.transform,
    });
    void commitTransform({
      submit,
      store: gizmoStore,
      sceneId: scene.id,
      entity,
      draft: parsed.draft,
    }).then((ok) => {
      if (ok) setTyped(null);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setTyped(null);
      setErrors({});
    }
  };

  return (
    <section aria-labelledby={headingId} className="ui-panel ui-overlay ui-transform">
      <h2 id={headingId}>Transform: {entity.name}</h2>
      {FIELDS.map(({ field, label }) => (
        <label key={field} className="ui-field">
          {label(unitLabel)}
          <input
            type="text"
            inputMode="decimal"
            value={shown[field]}
            aria-invalid={errors[field] !== undefined}
            aria-describedby={errors[field] ? `${headingId}-${field}` : undefined}
            onChange={(e) => {
              setTyped({ ...shown, [field]: e.target.value });
            }}
            onKeyDown={onKeyDown}
          />
          {errors[field] && (
            <span id={`${headingId}-${field}`} role="alert">
              {errors[field]}
            </span>
          )}
        </label>
      ))}
      <button type="button" disabled={busy} onClick={apply}>
        Apply
      </button>
      <ElevationControls entity={entity} scene={scene} />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** TOK-03 / D25: +/- (Shift = 5 cells) and a numeric field, each one `token.setElevation`. */
function ElevationControls({ entity, scene }: { entity: Entity; scene: Scene }) {
  const submit = useContext(SubmitContext);
  const { grid } = scene;
  const cells = entity.transform.position.y;
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  if (!entity.token) return null;

  const send = async (elevation: number) => {
    if (!submit || busy) return;
    setBusy(true);
    try {
      const result = await submit(
        'token.setElevation',
        { sceneId: scene.id, entityId: entity.id, elevation },
        scene.id,
      );
      setError(result.ok ? null : describeFailure(result));
      if (result.ok) setTyped(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const value = typed === null ? null : parseNumber(typed);
    const elevation = value === null ? null : elevationFromUnits(value, grid);
    if (elevation === null) {
      setError('Enter an elevation within 1000 cells.');
      return;
    }
    void send(elevation);
  };

  return (
    <div role="group" aria-label="Elevation" className="ui-elevation">
      <button
        type="button"
        aria-label="Lower elevation"
        disabled={busy}
        onClick={(e) => void send(nextElevation(cells, grid, -1, e.shiftKey))}
      >
        -
      </button>
      <label className="ui-field" htmlFor={fieldId}>
        Elevation ({grid.unitLabel})
        <input
          id={fieldId}
          type="text"
          inputMode="decimal"
          value={typed ?? formatUnits(cells, grid.unitsPerCell)}
          onChange={(e) => {
            setTyped(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
      <button
        type="button"
        aria-label="Raise elevation"
        disabled={busy}
        onClick={(e) => void send(nextElevation(cells, grid, 1, e.shiftKey))}
      >
        +
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
