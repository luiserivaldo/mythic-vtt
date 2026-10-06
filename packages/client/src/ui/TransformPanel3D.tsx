import type { Entity, Scene } from '@mythic/shared';
import { useContext, useId, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { commitTransform } from '../tools/gizmo-commit.js';
import { gizmoStore } from '../tools/gizmo-store.js';
import { elevationFromUnits, formatUnits } from '../tools/elevation.js';
import {
  formatTyped,
  parseNumber,
  parseTypedValues,
  type TypedField,
} from '../tools/transform-gizmo.js';
import { draft3dFromEntity } from '../tools/transform-gizmo-3d.js';
import { useGizmoTarget3D } from '../tools/use-gizmo-target-3d.js';
import { SubmitContext } from './submit.js';

type Field3D = TypedField | 'y';
type Typed3D = Record<Field3D, string>;

const FIELDS: readonly { field: Field3D; label: (unit: string) => string }[] = [
  { field: 'x', label: (unit) => `X (${unit})` },
  { field: 'y', label: (unit) => `Y (${unit})` },
  { field: 'z', label: (unit) => `Z (${unit})` },
  { field: 'rotation', label: () => 'Rotation about Y (deg)' },
  { field: 'scale', label: () => 'Scale' },
];

/** ENV-03/ENV-04 (3D): numeric entry for the selected prop/token, including elevation. */
export function TransformPanel3D() {
  const target = useGizmoTarget3D();
  if (!target) return null;
  return <Fields key={target.entity.id} entity={target.entity} scene={target.scene} />;
}

function Fields({ entity, scene }: { entity: Entity; scene: Scene }) {
  const submit = useContext(SubmitContext);
  const preview = useStore(gizmoStore, (s) => s.preview);
  const error = useStore(gizmoStore, (s) => s.error);
  const busy = useStore(gizmoStore, (s) => s.busy);
  const [typed, setTyped] = useState<Typed3D | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field3D, string>>>({});
  const headingId = useId();
  const { unitsPerCell } = scene.grid;

  const draft =
    preview && preview.entityId === entity.id ? preview.draft : draft3dFromEntity(entity);
  const shown: Typed3D = typed ?? {
    ...formatTyped(draft, unitsPerCell),
    y: formatUnits(draft.y ?? entity.transform.position.y, unitsPerCell),
  };

  const apply = () => {
    const parsed = parseTypedValues(shown, unitsPerCell);
    const y = parseNumber(shown.y);
    const elevation = y === null ? null : elevationFromUnits(y, scene.grid);
    if (!parsed.ok || elevation === null) {
      setErrors({
        ...(parsed.ok ? {} : parsed.errors),
        ...(elevation === null ? { y: 'Enter an elevation within 1000 cells.' } : {}),
      });
      return;
    }
    setErrors({});
    if (!submit) return;
    // No rotation on the draft: an untouched angle keeps the stored quaternion (pitch/roll).
    const next = { ...parsed.draft, y: elevation };
    gizmoStore.getState().begin({
      sceneId: scene.id,
      entityId: entity.id,
      draft: next,
      base: entity.transform,
    });
    void commitTransform({
      submit,
      store: gizmoStore,
      sceneId: scene.id,
      entity,
      draft: next,
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

  const tokenOnly = entity.token !== undefined;
  return (
    <section aria-labelledby={headingId} className="ui-panel ui-overlay ui-transform">
      <h2 id={headingId}>Transform: {entity.name}</h2>
      {FIELDS.filter(({ field }) => !tokenOnly || field === 'y').map(({ field, label }) => (
        <label key={field} className="ui-field">
          {label(scene.grid.unitLabel)}
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
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
