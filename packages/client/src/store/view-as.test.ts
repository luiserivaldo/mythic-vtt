import { Campaign, visibleTo, type Audience } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import { createClientStore } from './store.js';

const sceneId = tid(2),
  seatId = tid(3),
  otherId = tid(4),
  coDmId = tid(5);
const privateId = tid(6),
  ownerId = tid(7),
  hiddenId = tid(8);
function world() {
  const seat = {
    label: 'Player',
    binding: 'persistent',
    identityId: null,
    role: 'player',
    permissions: { view: true, move: true, edit: false, delete: false },
  };
  const entity = {
    name: 'Private name',
    layer: 'tokens',
    owners: [seatId],
    transform: {
      position: { x: 10, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    token: {
      sizeCells: 1,
      heightCells: 1,
      labelVisibility: 'owner',
      quickFields: { hp: { value: 9, visibility: 'owner' }, ac: { value: 17, visibility: 'dm' } },
      statusMarkers: [{ kind: 'text', text: 'Private marker' }],
    },
  };
  const scene = {
    id: sceneId,
    name: 'Public scene',
    grid: {
      type: 'square',
      sizePx: 70,
      unitsPerCell: 5,
      unitLabel: 'ft',
      diagonal: 'alternating',
      snap: true,
    },
    environment: { background: '#000000' },
    layers: {},
    entities: {
      [privateId]: { ...entity, id: privateId, layer: 'dm', name: 'DM secret' },
      [ownerId]: { ...entity, id: ownerId },
      [hiddenId]: { ...entity, id: hiddenId, perms: { view: false } },
    },
  };
  return Campaign.parse({
    ...makeCampaign(),
    activeSceneId: sceneId,
    seats: {
      [seatId]: { ...seat, id: seatId },
      [otherId]: { ...seat, id: otherId },
      [coDmId]: { ...seat, id: coDmId, role: 'codm' },
    },
    scenes: {
      [sceneId]: scene,
      [tid(10)]: { ...scene, id: tid(10), name: 'Inactive scene' },
      [tid(11)]: { ...scene, id: tid(11), dmOnly: true, name: 'Secret scene' },
    },
  });
}
function setup() {
  const store = createClientStore();
  store.getState().setHost(true);
  store.getState().applyServerMessage({ t: 'snapshot', seq: 1, seatId: null, state: world() });
  return store;
}

describe('UX-14 audience projection', () => {
  it.each<Audience>([
    { kind: 'seat', seatId },
    { kind: 'seat', seatId: otherId },
    { kind: 'seat', seatId: coDmId },
    { kind: 'spectators' },
  ])('matches visibleTo for %j and restores DM data', (audience) => {
    const store = setup();
    const source = store.getState().campaign;
    store.getState().setViewAs(audience);
    expect(store.getState().campaign).toEqual(visibleTo(audience, world()));
    expect(store.getState().sourceCampaign).toBe(source);
    expect(store.getState().isHost).toBe(false);
    expect(store.getState().realIsHost).toBe(true);
    store.getState().setViewAs({ kind: 'host' });
    expect(store.getState().campaign).toBe(source);
    expect(store.getState().isHost).toBe(true);
  });

  it('applies hidden patches to the source, recomputes visibility and restores the latest state', () => {
    const store = setup();
    store.getState().setViewAs({ kind: 'seat', seatId: otherId });
    expect(JSON.stringify(store.getState().campaign)).not.toContain('DM secret');
    expect(
      store.getState().applyServerMessage({
        t: 'patch',
        seq: 2,
        patches: [
          {
            op: 'replace',
            path: ['scenes', sceneId, 'entities', privateId, 'name'],
            value: 'Updated secret',
          },
          {
            op: 'replace',
            path: ['scenes', sceneId, 'entities', ownerId, 'owners'],
            value: [otherId],
          },
        ],
      }),
    ).toBe('ok');
    const source = store.getState().sourceCampaign as Campaign;
    expect(store.getState().campaign).toEqual(visibleTo({ kind: 'seat', seatId: otherId }, source));
    expect(JSON.stringify(store.getState().campaign)).not.toContain('Updated secret');
    expect(store.getState().campaign?.scenes[sceneId]?.entities[ownerId]?.name).toBe(
      'Private name',
    );
    store.getState().setViewAs({ kind: 'host' });
    expect(JSON.stringify(store.getState().campaign)).toContain('Updated secret');
  });

  it('keeps preview across reconnect snapshots and follows role and view-permission changes', () => {
    const store = setup();
    store.getState().setViewAs({ kind: 'seat', seatId });
    store.getState().setConnection('waiting');
    const changed = world();
    const seat = changed.seats[seatId];
    if (!seat) throw new Error('missing fixture seat');
    seat.role = 'codm';
    store.getState().applyServerMessage({ t: 'snapshot', seq: 5, seatId: null, state: changed });
    expect(store.getState().campaign).toEqual(visibleTo({ kind: 'seat', seatId }, changed));
    store.getState().applyServerMessage({
      t: 'patch',
      seq: 6,
      patches: [{ op: 'replace', path: ['seats', seatId, 'permissions', 'view'], value: false }],
    });
    expect(store.getState().campaign?.scenes[sceneId]?.entities).toEqual({});
    store.getState().applyServerMessage({
      t: 'patch',
      seq: 7,
      patches: [{ op: 'remove', path: ['seats', seatId] }],
    });
    expect(store.getState().viewAs).toEqual({ kind: 'spectators' });
    expect(store.getState().isHost).toBe(false);
  });

  it('resolves the spectator source to that seat, and never to a co-DM', () => {
    const store = setup();
    store.getState().setSpectatorSource(seatId);
    store.getState().setViewAs({ kind: 'spectators' });
    expect(store.getState().campaign).toEqual(visibleTo({ kind: 'seat', seatId }, world()));
    // The local actor is the audience this preview is filtered for. A spectator following a player
    // seat is sent that seat's filtered view and stamped with the same seat id, so the preview
    // must read it the same way — otherwise a label the audience may read is hidden again by a
    // second, seat-less check (TOK-04/D35) and the preview stops matching what spectators see.
    expect(store.getState().seatId).toBe(seatId);
    // A co-DM source is not a spectator's view at all: it filters as a plain spectator and borrows
    // no co-DM seat.
    store.getState().setSpectatorSource(coDmId);
    expect(store.getState().campaign).toEqual(visibleTo({ kind: 'spectators' }, world()));
    expect(store.getState().seatId).toBeNull();
  });

  it('does not allow non-hosts to preview and waits for pending DM actions before switching', () => {
    const store = setup();
    store.getState().setPendingIntents(1);
    store.getState().setViewAs({ kind: 'spectators' });
    expect(store.getState().viewAs.kind).toBe('host');
    store.getState().setPendingIntents(0);
    store.getState().setHost(false);
    store.getState().setViewAs({ kind: 'seat', seatId });
    expect(store.getState().viewAs.kind).toBe('host');
  });
});
