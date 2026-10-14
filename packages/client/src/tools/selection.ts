import type { Entity, Scene, Seat } from '@mythic/shared';
import { RENDER_LAYERS, renderLayer } from '../render/scene-model.js';

export interface PickHit {
  id: string;
  distance: number;
}

export type SelectionActor =
  { kind: 'host' } | { kind: 'seat'; seat: Seat } | { kind: 'spectator' };

/**
 * PERM-03: only the real host is the host actor. A seat-less client (spectator link, unseated
 * participant) has `seatId === null` too, so null must never be read as "host"; it can move the
 * camera and nothing else.
 */
export function selectionActor(
  isHost: boolean,
  seatId: string | null,
  seats: Readonly<Record<string, Seat>>,
): SelectionActor {
  if (isHost) return { kind: 'host' };
  const seat = seatId === null ? undefined : seats[seatId];
  return seat ? { kind: 'seat', seat } : { kind: 'spectator' };
}

/**
 * UX-14 + M4-02: the actor of the *rendered* view. `seatId` is what this client may act as — a DM
 * preview acts as nobody, so it stays null — but a preview draws the audience it projected, and a
 * spectator audience that follows a player seat is that seat's view. Every local re-check (token
 * labels, ownership, what a click may pick) must run as the seat whose data is on screen, or it
 * hides again what the host already sent for that seat. The real host is never overridden.
 */
export function viewActor(input: {
  isHost: boolean;
  seatId: string | null;
  /** The seat a preview is showing, or null for the host view and a seat-less audience. */
  previewSeatId: string | null;
  seats: Readonly<Record<string, Seat>>;
}): SelectionActor {
  return selectionActor(input.isHost, input.previewSeatId ?? input.seatId, input.seats);
}

/** PERM-01/02: local selection grants no authority to change game state. */
export function canSelect(entity: Entity, scene: Scene, actor: SelectionActor): boolean {
  if (scene.layers[entity.layer]?.locked) return false;
  if (actor.kind === 'host') return true;
  if (actor.kind === 'spectator') return false;
  const { seat } = actor;
  if (seat.role === 'codm') return true;
  if (entity.layer === 'dm') return false;
  if (!seat.permissions.view || entity.perms?.view === false) return false;
  if (entity.owners.includes(seat.id)) return true;
  return (
    (seat.permissions.move && entity.perms?.move === true) ||
    (seat.permissions.edit && entity.perms?.edit === true)
  );
}

/** Overlay order takes precedence over ray distance; distance breaks ties within a layer. */
export function pickEntity(
  hits: readonly PickHit[],
  scene: Scene,
  actor: SelectionActor,
): string | null {
  const eligible = hits.filter(({ id }) => {
    const entity = scene.entities[id];
    return entity && canSelect(entity, scene, actor);
  });
  eligible.sort((a, b) => {
    const aEntity = scene.entities[a.id];
    const bEntity = scene.entities[b.id];
    if (!aEntity || !bEntity) return 0;
    return (
      RENDER_LAYERS.indexOf(renderLayer(bEntity)) - RENDER_LAYERS.indexOf(renderLayer(aEntity)) ||
      a.distance - b.distance
    );
  });
  return eligible[0]?.id ?? null;
}

/** Shift/Ctrl/Meta toggles membership; a plain click replaces selection. */
export function nextSelection(
  selected: readonly string[],
  picked: string | null,
  additive: boolean,
): string[] {
  if (picked === null) return additive ? [...selected] : [];
  if (!additive) return [picked];
  return selected.includes(picked) ? selected.filter((id) => id !== picked) : [...selected, picked];
}

export function validSelection(
  selected: readonly string[],
  scene: Scene | null,
  actor: SelectionActor,
): string[] {
  if (!scene) return [];
  return selected.filter((id) => {
    const entity = scene.entities[id];
    return entity && canSelect(entity, scene, actor);
  });
}
