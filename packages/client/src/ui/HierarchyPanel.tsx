import type { Actor, Campaign, LayerId, Scene } from '@mythic/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { selectionActor } from '../tools/selection.js';
import { selectionStore } from '../tools/selection-store.js';
import { useClientStore } from '../store/react.js';
import { isValidEntityName, entityRenameIntent } from './entity-panel.js';
import { hierarchyGroups, type HierarchyRow } from './hierarchy.js';
import { NameForm } from './NameForm.js';
import { COLLIDABLE_LABEL, propCollidableIntent, propCollidableModel } from './prop-menu.js';
import { useSubmit, type SendIntent } from './submit.js';
import { useUiStore } from './ui-store.js';
import { viewerRole } from './viewer.js';

/**
 * UI-ENT-01 (MV-245): a small popup for one object, not a long form: its name, and for a prop the
 * collidable switch shared with the right-click menu (MV-243). Moving stays on the board's gizmo.
 */
function ObjectPopup({
  campaign,
  scene,
  entityId,
  actor,
  send,
  onClose,
}: {
  campaign: Campaign;
  scene: Scene;
  entityId: string;
  actor: Actor;
  send: SendIntent;
  onClose: () => void;
}) {
  const entity = scene.entities[entityId];
  if (!entity) return null;
  const shape = entity.shape;
  const collidable = propCollidableModel(campaign, scene.id, entity, actor);
  return (
    <div
      role="dialog"
      aria-label={`Edit ${entity.name}`}
      className="ui-hierarchy-popup"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <NameForm
        key={`${entityId}:${entity.name}`}
        label={`Name of ${entity.name}`}
        submitLabel="Rename"
        initial={entity.name}
        validate={(t) => isValidEntityName(t) && t.trim() !== entity.name}
        onSubmit={(t) => send(entityRenameIntent(scene.id, entityId, t))}
      />
      {collidable && shape && (
        <label title={collidable.reason ?? undefined}>
          <input
            type="checkbox"
            checked={collidable.checked}
            disabled={!collidable.enabled}
            onChange={(e) => {
              void send(propCollidableIntent(scene.id, entityId, shape, e.target.checked));
            }}
          />{' '}
          {COLLIDABLE_LABEL}
        </label>
      )}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function RowView({
  scene,
  row,
  editing,
  onEdit,
}: {
  scene: Scene;
  row: HierarchyRow;
  editing: boolean;
  onEdit: () => void;
}) {
  const selected = useStore(
    selectionStore,
    (s) => s.sceneId === scene.id && s.ids.includes(row.id),
  );
  const ref = useRef<HTMLLIElement>(null);
  // Two-way: a pick on the board brings its row into view.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <li
      ref={ref}
      className="ui-hierarchy-row"
      data-entity-id={row.id}
      data-selected={selected}
      data-dimmed={row.dimmed}
    >
      <button
        type="button"
        className="ui-entity-name"
        aria-pressed={selected}
        disabled={!row.selectable}
        title={row.reason ?? undefined}
        onClick={(e) => {
          selectionStore.getState().pick(scene.id, row.id, e.shiftKey || e.ctrlKey || e.metaKey);
        }}
      >
        {row.name}
      </button>
      <span className="ui-badge">{row.kind}</span>
      <button
        type="button"
        className="ui-icon-button"
        aria-label={`Edit ${row.name}`}
        aria-expanded={editing}
        title={row.reason ?? 'Edit'}
        disabled={!row.selectable}
        onClick={onEdit}
      >
        ✎
      </button>
    </li>
  );
}

/**
 * UI-ENT-01 / C16 (MV-245): the DM's Unity-style hierarchy in 3D edit mode, a right-dock tab. Rows
 * select on the board and board picks highlight rows (one local selection store, never an action).
 * MV-244/MV-258: rows off the active layer are shaded and cannot be picked, as on the board.
 */
export function HierarchyPanel({ campaign }: { campaign: Campaign }) {
  const isHost = useClientStore((s) => s.isHost);
  const seatId = useClientStore((s) => s.seatId);
  const activeLayer = useUiStore((s) => s.activeLayer);
  const hiddenLayers = useUiStore((s) => s.hiddenLayers);
  const { send, error } = useSubmit();
  const [collapsed, setCollapsed] = useState<ReadonlySet<LayerId>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const scene = campaign.activeSceneId ? campaign.scenes[campaign.activeSceneId] : undefined;
  // The popup belongs to a selected object: picking something else on the board closes it.
  const editingSelected = useStore(
    selectionStore,
    (s) => editing !== null && s.sceneId === scene?.id && s.ids.includes(editing),
  );
  const groups = useMemo(() => {
    if (!scene) return [];
    const actor = selectionActor(isHost, seatId, campaign.seats);
    const role = viewerRole({ isHost, seatId, campaign });
    return hierarchyGroups(campaign, scene, { role, actor, activeLayer, hiddenLayers });
  }, [campaign, scene, isHost, seatId, activeLayer, hiddenLayers]);

  if (!scene) {
    return (
      <section aria-labelledby="ui-hierarchy-h" className="ui-panel">
        <h2 id="ui-hierarchy-h">Hierarchy</h2>
        <p>No active scene. Create and activate a scene first.</p>
      </section>
    );
  }
  const actor: Actor = isHost
    ? { kind: 'host' }
    : seatId === null
      ? { kind: 'seat' }
      : { kind: 'seat', seatId };
  const editingRow = groups.flatMap((g) => g.rows).find((r) => r.id === editing);

  return (
    <section aria-labelledby="ui-hierarchy-h" className="ui-panel ui-hierarchy">
      <h2 id="ui-hierarchy-h">Hierarchy</h2>
      <ul className="ui-list" aria-label={`Objects in ${scene.name}`}>
        {groups.map((group) => {
          const open = !collapsed.has(group.layer);
          return (
            <li key={group.layer} className="ui-hierarchy-group" data-layer={group.layer}>
              <button
                type="button"
                className="ui-hierarchy-head"
                aria-expanded={open}
                onClick={() => {
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(group.layer)) next.add(group.layer);
                    return next;
                  });
                }}
              >
                <span aria-hidden="true">{open ? '−' : '+'}</span> {group.label}{' '}
                <span className="ui-entity-count">({group.rows.length})</span>
                {group.active && <span className="ui-badge">Active</span>}
                {group.locked && <span className="ui-badge">Locked</span>}
                {group.hidden && <span className="ui-badge">Hidden</span>}
              </button>
              {open && group.rows.length > 0 && (
                <ul className="ui-list" aria-label={`${group.label} layer`}>
                  {group.rows.map((row) => (
                    <RowView
                      key={row.id}
                      scene={scene}
                      row={row}
                      editing={editing === row.id}
                      onEdit={() => {
                        selectionStore.getState().pick(scene.id, row.id, false);
                        setEditing(editing === row.id ? null : row.id);
                      }}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {editingSelected && editingRow?.selectable && (
        <ObjectPopup
          campaign={campaign}
          scene={scene}
          entityId={editingRow.id}
          actor={actor}
          send={send}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
