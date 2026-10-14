import { describe, expect, it } from 'vitest';
import { Entity, Scene, Seat } from '@mythic/shared';
import { tid } from '../testing.js';
import {
  canSelect,
  nextSelection,
  pickEntity,
  selectionActor,
  validSelection,
  viewActor,
  type SelectionActor,
} from './selection.js';

const owner = Seat.parse({
  id: tid(1),
  label: 'Owner',
  binding: 'persistent',
  identityId: null,
  role: 'player',
  permissions: { view: true, move: true, edit: false, delete: false },
});
const player: SelectionActor = { kind: 'seat', seat: owner };
const host: SelectionActor = { kind: 'host' };
const entity = (
  id: number,
  layer: Entity['layer'],
  owners: string[] = [],
  perms?: Entity['perms'],
) =>
  Entity.parse({
    id: tid(id),
    layer,
    name: 'Fixture',
    owners,
    perms,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
const map = entity(2, 'map');
const prop = entity(3, 'props');
const token = entity(4, 'tokens', [owner.id]);
const effect = entity(5, 'effects', [], { move: true });
const secret = entity(9, 'dm', [owner.id]);
const scene = Scene.parse({
  id: tid(6),
  name: 'Scene',
  grid: {
    type: 'square',
    sizePx: 70,
    unitsPerCell: 5,
    unitLabel: 'ft',
    diagonal: 'chebyshev',
    snap: true,
  },
  environment: { background: '#101923' },
  layers: {},
  entities: { [map.id]: map, [prop.id]: prop, [token.id]: token, [effect.id]: effect },
});

describe('raycast picking', () => {
  it('chooses the highest eligible layer before nearest ray distance', () => {
    const hits = [
      { id: map.id, distance: 1 },
      { id: token.id, distance: 8 },
      { id: prop.id, distance: 2 },
      { id: effect.id, distance: 10 },
    ];
    expect(pickEntity(hits, scene, host)).toBe(effect.id);
    expect(pickEntity(hits, scene, player)).toBe(effect.id);
    expect(
      pickEntity(
        [
          { id: prop.id, distance: 1 },
          { id: token.id, distance: 9 },
        ],
        scene,
        player,
      ),
    ).toBe(token.id);
  });

  it('breaks same-layer ties by nearest hit and skips unknown IDs', () => {
    const second = entity(7, 'tokens', [owner.id]);
    const withSecond = { ...scene, entities: { ...scene.entities, [second.id]: second } };
    expect(
      pickEntity(
        [
          { id: 'missing', distance: 0 },
          { id: token.id, distance: 3 },
          { id: second.id, distance: 1 },
        ],
        withSecond,
        player,
      ),
    ).toBe(second.id);
    const dmToken = Entity.parse({
      ...entity(10, 'dm'),
      token: {
        sizeCells: 1,
        heightCells: 1,
        labelVisibility: 'dm',
      },
    });
    const withDmToken = { ...scene, entities: { ...scene.entities, [dmToken.id]: dmToken } };
    expect(
      pickEntity(
        [
          { id: dmToken.id, distance: 2 },
          { id: token.id, distance: 1 },
        ],
        withDmToken,
        host,
      ),
    ).toBe(token.id);
  });

  it('picks a token authored on the map layer over an overlapping prop', () => {
    const mapToken = Entity.parse({
      ...entity(11, 'map'),
      token: { sizeCells: 3, heightCells: 1, labelVisibility: 'all' },
    });
    const overlaid = { ...scene, entities: { ...scene.entities, [mapToken.id]: mapToken } };
    expect(
      pickEntity(
        [
          { id: prop.id, distance: 1 },
          { id: mapToken.id, distance: 3 },
        ],
        overlaid,
        host,
      ),
    ).toBe(mapToken.id);
  });

  it('skips locked layers and enforces owner or explicit entity permission', () => {
    const locked = { ...scene, layers: { tokens: { locked: true }, effects: { locked: true } } };
    expect(
      pickEntity(
        [
          { id: token.id, distance: 1 },
          { id: effect.id, distance: 2 },
        ],
        locked,
        player,
      ),
    ).toBeNull();
    expect(
      pickEntity(
        [
          { id: token.id, distance: 1 },
          { id: effect.id, distance: 2 },
        ],
        locked,
        host,
      ),
    ).toBeNull();
    expect(canSelect(prop, scene, player)).toBe(false);
    expect(canSelect(token, scene, player)).toBe(true);
    expect(canSelect(effect, scene, player)).toBe(true);
    expect(canSelect(effect, scene, { kind: 'spectator' })).toBe(false);
    expect(canSelect(secret, scene, player)).toBe(false);
    expect(canSelect(secret, scene, { kind: 'seat', seat: { ...owner, role: 'codm' } })).toBe(true);
  });

  it('applies seat view and entity view denial, then prunes stale selection', () => {
    const hidden = entity(8, 'tokens', [owner.id], { view: false });
    const withHidden = { ...scene, entities: { ...scene.entities, [hidden.id]: hidden } };
    expect(canSelect(hidden, withHidden, player)).toBe(false);
    expect(canSelect(hidden, withHidden, host)).toBe(true);
    expect(
      canSelect(token, scene, {
        kind: 'seat',
        seat: { ...owner, permissions: { ...owner.permissions, view: false } },
      }),
    ).toBe(false);
    expect(validSelection([token.id, hidden.id, 'gone'], withHidden, player)).toEqual([token.id]);
    expect(validSelection([token.id], null, player)).toEqual([]);
  });
});

describe('multi-select', () => {
  it('replaces, toggles, and clears predictably', () => {
    expect(nextSelection([map.id], token.id, false)).toEqual([token.id]);
    expect(nextSelection([map.id], token.id, true)).toEqual([map.id, token.id]);
    expect(nextSelection([map.id, token.id], map.id, true)).toEqual([token.id]);
    expect(nextSelection([map.id], null, false)).toEqual([]);
    expect(nextSelection([map.id], null, true)).toEqual([map.id]);
  });
});

describe('selectionActor (PERM-03)', () => {
  const seats = { [owner.id]: owner };

  it('maps only the real host to the host actor', () => {
    expect(selectionActor(true, null, seats)).toEqual({ kind: 'host' });
  });

  it('treats a seat-less client as a spectator, never as the host', () => {
    const actor = selectionActor(false, null, seats);
    expect(actor).toEqual({ kind: 'spectator' });
    expect(canSelect(entity(3, 'tokens'), scene, actor)).toBe(false);
  });

  it('treats a seat that no longer exists as a spectator', () => {
    expect(selectionActor(false, tid(77), seats)).toEqual({ kind: 'spectator' });
  });

  it('keeps a real seat as a seat actor', () => {
    expect(selectionActor(false, owner.id, seats)).toEqual({ kind: 'seat', seat: owner });
  });
});

describe('viewActor (UX-14 previews)', () => {
  const seats = { [owner.id]: owner };
  const base = { isHost: false, seatId: null, previewSeatId: null, seats };

  it('leaves a view with no preview alone: host, seat and spectator are unchanged', () => {
    expect(viewActor({ ...base, isHost: true })).toEqual({ kind: 'host' });
    expect(viewActor({ ...base, seatId: owner.id })).toEqual({ kind: 'seat', seat: owner });
    expect(viewActor(base)).toEqual({ kind: 'spectator' });
  });

  it('renders a preview as the seat it is showing, even when the client holds no seat', () => {
    // A spectator audience that follows a player seat is that seat's view (M4-02), so the labels and
    // ownership a local re-check sees must be that seat's - the campaign was projected for it.
    expect(viewActor({ ...base, previewSeatId: owner.id })).toEqual({ kind: 'seat', seat: owner });
    // The real host stays the host: a preview never outranks it (PERM-03).
    expect(viewActor({ ...base, isHost: true, previewSeatId: owner.id })).toEqual({ kind: 'host' });
    // A seat the campaign no longer holds, or no previewed seat at all, is a spectator view.
    expect(viewActor({ ...base, previewSeatId: tid(77) })).toEqual({ kind: 'spectator' });
    expect(viewActor({ ...base, previewSeatId: null })).toEqual({ kind: 'spectator' });
  });
});
