import { AoEEntity, canPerform, type Actor, type Scene } from '@mythic/shared';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useClientStore } from '../store/react.js';
import {
  aoePlacePayload,
  aoeUpdatePayload,
  draftFromAoE,
  validAoEDraft,
  type AoEKind,
} from '../tools/aoe-placement.js';
import { aoeToolStore } from '../tools/aoe-tool-store.js';
import { rulerStore } from '../tools/ruler-store.js';
import { selectionStore } from '../tools/selection-store.js';
import { useJoinEnv } from './join-context.js';
import { useSubmit } from './submit.js';

const KINDS: AoEKind[] = ['sphere', 'cylinder', 'cone', 'cube', 'line'];
/** All controls are DOM labels. The tool draft and preview are local to this browser. */
export function AoEToolPanel({
  scene,
  unified = false,
}: {
  scene: Scene | null;
  unified?: boolean;
}) {
  const join = useJoinEnv();
  const snap = useStore(rulerStore, (s) => s.snap);
  const measuredScene = scene
    ? { ...scene, grid: { ...scene.grid, snap: snap && scene.grid.snap } }
    : null;
  const campaign = useClientStore((s) => s.campaign);
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const selected = useStore(selectionStore, (s) => s.ids);
  const active = useStore(aoeToolStore, (s) => s.active);
  const draft = useStore(aoeToolStore, (s) => s.draft);
  const busy = useStore(aoeToolStore, (s) => s.busy);
  const error = useStore(aoeToolStore, (s) => s.error);
  const { send, error: submitError } = useSubmit();
  const actor: Actor | null = isHost
    ? { kind: 'host', identityId: join?.identityId }
    : seatId
      ? { kind: 'seat', seatId, identityId: join?.identityId }
      : null;
  const entity = useMemo(() => {
    if (!scene || selected.length !== 1) return null;
    const candidate = scene.entities[selected[0] ?? ''];
    const parsed = AoEEntity.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }, [scene, selected]);
  const canPlace =
    !!campaign &&
    !!scene &&
    !!actor &&
    !!join &&
    canPerform(
      campaign,
      actor,
      'aoe.place',
      aoePlacePayload(scene.id, join.identityId, draft, measuredScene ?? scene),
    );
  const canUpdate =
    !!campaign &&
    !!scene &&
    !!actor &&
    !!entity &&
    canPerform(
      campaign,
      actor,
      'aoe.update',
      aoeUpdatePayload(scene.id, entity, draft, measuredScene ?? scene),
    );
  const canRemove =
    !!campaign &&
    !!scene &&
    !!actor &&
    !!entity &&
    canPerform(campaign, actor, 'aoe.remove', { sceneId: scene.id, entityId: entity.id });
  if (!scene || (!canPlace && !entity)) return null;
  const unit = scene.grid.unitLabel;
  const perCell = scene.grid.unitsPerCell;
  const update = (field: 'size' | 'degrees' | 'elevation' | 'x' | 'z', value: string) => {
    if (field === 'elevation' && value === '') {
      aoeToolStore.getState().setDraft({ elevation: null });
      return;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    aoeToolStore.getState().setDraft({ [field]: field === 'degrees' ? number : number / perCell });
  };
  const apply = async () => {
    if (!entity || !canUpdate || !validAoEDraft(draft, scene.grid)) return;
    aoeToolStore.getState().setBusy(true);
    try {
      const ok = await send({
        type: 'aoe.update',
        payload: aoeUpdatePayload(scene.id, entity, draft, measuredScene ?? scene),
        sceneId: scene.id,
      });
      if (ok) aoeToolStore.getState().setError(null);
    } finally {
      aoeToolStore.getState().setBusy(false);
    }
  };
  return (
    <section className="ui-panel ui-overlay ui-aoe-tool" aria-label="AoE tool">
      {!unified && (
        <button
          type="button"
          aria-pressed={active}
          disabled={!canPlace}
          onClick={() => {
            aoeToolStore.getState().setActive(!active);
          }}
        >
          AoE placement
        </button>
      )}
      {active && (
        <>
          {!unified && (
            <label>
              Shape{' '}
              <select
                aria-label="AoE shape"
                value={draft.kind}
                onChange={(e) => {
                  aoeToolStore.getState().setDraft({ kind: e.target.value as AoEKind });
                }}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Size ({unit}){' '}
            <input
              aria-label="AoE size"
              type="number"
              min="0.01"
              step="any"
              value={draft.size * perCell}
              onChange={(e) => {
                update('size', e.target.value);
              }}
            />
          </label>
          <label>
            Rotation (deg){' '}
            <input
              aria-label="AoE rotation"
              type="number"
              step="1"
              value={draft.degrees}
              onChange={(e) => {
                update('degrees', e.target.value);
              }}
            />
          </label>
          <label>
            Elevation ({unit}){' '}
            <input
              aria-label="AoE elevation"
              type="number"
              step="any"
              placeholder="Surface"
              value={draft.elevation === null ? '' : draft.elevation * perCell}
              onChange={(e) => {
                update('elevation', e.target.value);
              }}
            />
          </label>
          <p>
            Click to place; drag to aim. Right-click your AoE to remove it. Elevation defaults to
            the surface below.
          </p>
        </>
      )}
      {entity && (
        <div role="group" aria-label="Selected AoE">
          <strong>{entity.name}</strong>
          <button
            type="button"
            onClick={() => {
              aoeToolStore.getState().setDraft(draftFromAoE(entity));
              aoeToolStore.getState().setEditingEntityId(entity.id);
            }}
          >
            Edit selected AoE
          </button>
          {!active && (
            <>
              <label>
                X ({unit}){' '}
                <input
                  aria-label="Selected AoE X"
                  type="number"
                  step="any"
                  value={draft.x * perCell}
                  onChange={(e) => {
                    update('x', e.target.value);
                  }}
                />
              </label>
              <label>
                Z ({unit}){' '}
                <input
                  aria-label="Selected AoE Z"
                  type="number"
                  step="any"
                  value={draft.z * perCell}
                  onChange={(e) => {
                    update('z', e.target.value);
                  }}
                />
              </label>
              <label>
                Size ({unit}){' '}
                <input
                  aria-label="Selected AoE size"
                  type="number"
                  min="0.01"
                  step="any"
                  value={draft.size * perCell}
                  onChange={(e) => {
                    update('size', e.target.value);
                  }}
                />
              </label>
              <label>
                Rotation (deg){' '}
                <input
                  aria-label="Selected AoE rotation"
                  type="number"
                  value={draft.degrees}
                  onChange={(e) => {
                    update('degrees', e.target.value);
                  }}
                />
              </label>
              <label>
                Elevation ({unit}){' '}
                <input
                  aria-label="Selected AoE elevation"
                  type="number"
                  value={draft.elevation === null ? '' : draft.elevation * perCell}
                  onChange={(e) => {
                    update('elevation', e.target.value);
                  }}
                />
              </label>
              <button type="button" disabled={!canUpdate || busy} onClick={() => void apply()}>
                Apply AoE
              </button>
              <button
                type="button"
                disabled={!canRemove || busy}
                onClick={() => {
                  if (canRemove)
                    void send({
                      type: 'aoe.remove',
                      payload: { sceneId: scene.id, entityId: entity.id },
                      sceneId: scene.id,
                    });
                }}
              >
                Remove AoE
              </button>
            </>
          )}
        </div>
      )}
      {(error || submitError) && <p role="alert">{error || submitError}</p>}
    </section>
  );
}
