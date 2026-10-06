import type { Entity, Scene } from '@mythic/shared';
import { useContext, useId, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { commitTransform } from '../tools/gizmo-commit.js';
import { gizmoStore } from '../tools/gizmo-store.js';
import {
  draftFromEntity,
  formatTyped,
  parseTypedValues,
  type TypedField,
  type TypedInput,
} from '../tools/transform-gizmo.js';
import { useGizmoTarget } from '../tools/use-gizmo-target.js';
import { SubmitContext } from './submit.js';

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
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
