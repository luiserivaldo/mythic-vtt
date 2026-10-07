import { canPerform, type Campaign, type Entity, type Scene } from '@mythic/shared';
import { describe, expect, it } from 'vitest';
import { createClientStore } from '../store/store.js';
import { makeCampaign, tid } from '../testing.js';
import {
  entityMoveLayerIntent,
  layerLockIntent,
  sceneActivateIntent,
  sceneBoundsIntent,
  sceneCreateIntent,
  sceneRenameIntent,
  seatAssignIntent,
  seatCreateIntent,
  seatPermissionIntent,
  seatReleaseIntent,
  seatRoleIntent,
  type IntentSpec,
} from './intent-specs.js';
import { layerRows, moveTargets, toggleHidden } from './layer-panel.js';
import { sceneRows, isValidSceneName } from './scene-list.js';
import { connectedIdentityRows, isValidIdentityId, isValidLabel, seatRows } from './seat-panel.js';
import { toolbarItems } from './toolbar-items.js';
import { canManageSeats, identitySummary, isAdminRole, viewerRole } from './viewer.js';

const S = tid(2);
const E = tid(3);
const P = tid(4);
const C = tid(5);

const entity = (layer: Entity['layer']): Entity => ({
  id: E,
  layer,
  name: 'Goblin',
  owners: [],
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
});

function world(): Campaign {
  const base = makeCampaign();
  const perms = { view: true, move: true, edit: false, delete: false };
  return {
    ...base,
    seats: {
      [P]: {
        id: P,
        label: 'Pia',
        binding: 'persistent',
        identityId: null,
        role: 'player',
        permissions: perms,
      },
      [C]: {
        id: C,
        label: 'Cleo',
        binding: 'persistent',
        identityId: tid(9),
        role: 'codm',
        permissions: perms,
      },
    },
    scenes: {
      [S]: {
        id: S,
        name: 'Cave',
        grid: {
          type: 'square',
          sizePx: 70,
          unitsPerCell: 5,
          unitLabel: 'ft',
          diagonal: 'alternating',
          snap: true,
        },
        environment: { background: '#000000' },
        layers: { props: { locked: true } },
        entities: { [E]: entity('tokens') },
      },
    },
    activeSceneId: S,
  };
}

const sceneOf = (c: Campaign): Scene => {
  const scene = c.scenes[S];
  if (!scene) throw new Error('fixture scene missing');
  return scene;
};

describe('viewerRole', () => {
  const campaign = world();
  it('derives the role from the host claim and the seat', () => {
    expect(viewerRole({ isHost: true, seatId: null, campaign })).toBe('host');
    expect(viewerRole({ isHost: false, seatId: C, campaign })).toBe('codm');
    expect(viewerRole({ isHost: false, seatId: P, campaign })).toBe('player');
    expect(viewerRole({ isHost: false, seatId: null, campaign })).toBe('observer');
    expect(viewerRole({ isHost: false, seatId: tid(20), campaign })).toBe('observer');
    expect(viewerRole({ isHost: false, seatId: P, campaign: null })).toBe('observer');
  });
  it('only admins see scene and layer panels; only the host sees seats', () => {
    expect(isAdminRole('codm')).toBe(true);
    expect(isAdminRole('player')).toBe(false);
    expect(canManageSeats('codm')).toBe(false);
    expect(toolbarItems('player')).toEqual([]);
    expect(toolbarItems('observer')).toEqual([]);
    expect(toolbarItems('codm').map((i) => i.id)).toEqual(['scenes', 'layers', 'map', 'entities']);
    expect(toolbarItems('host').map((i) => i.id)).toEqual([
      'scenes',
      'layers',
      'map',
      'entities',
      'seats',
    ]);
  });
  it('describes the current identity, role and seat', () => {
    expect(identitySummary({ displayName: 'DM', isHost: true, seatId: null, campaign })).toEqual({
      displayName: 'DM',
      roleLabel: 'DM',
      seatLabel: 'Host',
    });
    expect(identitySummary({ displayName: 'Cleo', isHost: false, seatId: C, campaign })).toEqual({
      displayName: 'Cleo',
      roleLabel: 'Co-DM',
      seatLabel: 'Cleo',
    });
    expect(identitySummary({ displayName: 'Pia', isHost: false, seatId: P, campaign })).toEqual({
      displayName: 'Pia',
      roleLabel: 'Player',
      seatLabel: 'Pia',
    });
    expect(
      identitySummary({ displayName: 'Quinn', isHost: false, seatId: null, campaign }),
    ).toEqual({
      displayName: 'Quinn',
      roleLabel: 'Spectator',
      seatLabel: 'Spectator',
    });
  });
});

describe('store host hint', () => {
  it('defaults to false and is set explicitly', () => {
    const store = createClientStore();
    expect(store.getState().isHost).toBe(false);
    store.getState().setHost(true);
    expect(store.getState().isHost).toBe(true);
  });
});

describe('view models', () => {
  it('lists layers with lock and local hidden state', () => {
    const rows = layerRows(sceneOf(world()), new Set(['dm'] as const));
    expect(rows.map((r) => r.layer)).toEqual(['map', 'props', 'tokens', 'dm', 'effects']);
    expect(rows.find((r) => r.layer === 'props')?.locked).toBe(true);
    expect(rows.find((r) => r.layer === 'dm')?.hidden).toBe(true);
    expect(rows.find((r) => r.layer === 'map')).toMatchObject({ locked: false, hidden: false });
  });
  it('toggles hidden without mutating the input', () => {
    const a = new Set(['dm'] as const);
    expect([...toggleHidden(a, 'map')].sort()).toEqual(['dm', 'map']);
    expect([...toggleHidden(a, 'dm')]).toEqual([]);
    expect([...a]).toEqual(['dm']);
  });
  it('disables move targets the host would refuse', () => {
    const scene = sceneOf(world());
    const targets = moveTargets(scene, entity('tokens'));
    expect(targets.map((t) => t.layer)).not.toContain('tokens');
    expect(targets.find((t) => t.layer === 'props')?.disabledReason).toMatch(/locked/);
    expect(targets.find((t) => t.layer === 'map')?.disabledReason).toBeNull();
    const fromLocked = moveTargets(scene, entity('props'));
    expect(fromLocked.every((t) => t.disabledReason !== null)).toBe(true);
  });
  it('lists scenes with the active one marked', () => {
    expect(sceneRows(world())).toEqual([{ id: S, name: 'Cave', active: true }]);
    expect(isValidSceneName('  ')).toBe(false);
    expect(isValidSceneName(' Cave ')).toBe(true);
    expect(isValidSceneName('x'.repeat(121))).toBe(false);
  });
  it('lists seats with occupancy, presence and Co-DM wording', () => {
    const rows = seatRows(world(), [{ seatId: C, connected: true }]);
    expect(rows.map((r) => [r.label, r.roleLabel, r.occupied, r.connected])).toEqual([
      ['Cleo', 'Co-DM', true, true],
      ['Pia', 'Player', false, false],
    ]);
    expect(seatRows(world(), null).every((r) => !r.connected)).toBe(true);
  });
  it('joins the host-only roster to seat labels and includes unseated spectators', () => {
    expect(
      connectedIdentityRows(
        world(),
        [
          { seatId: C, connected: true, displayName: 'Cleo Client' },
          { seatId: P, connected: false, displayName: 'Pia Client' },
        ],
        [{ identityId: tid(10), displayName: 'Quinn' }],
      ),
    ).toEqual([
      {
        key: `seat-${C}`,
        displayName: 'Cleo Client',
        seatLabel: 'Cleo',
        roleLabel: 'Co-DM',
      },
      {
        key: `identity-${tid(10)}`,
        displayName: 'Quinn',
        seatLabel: 'Unseated',
        roleLabel: 'Spectator',
      },
    ]);
  });
  it('validates typed input', () => {
    expect(isValidLabel('')).toBe(false);
    expect(isValidLabel('Pia')).toBe(true);
    expect(isValidIdentityId('nope')).toBe(false);
    expect(isValidIdentityId(` ${tid(9)} `)).toBe(true);
  });
});

describe('intent specs are accepted by the shared actions', () => {
  const state = world();
  const host = { kind: 'host' } as const;
  const specs: IntentSpec[] = [
    sceneCreateIntent(tid(11), '  Inn  '),
    sceneRenameIntent(S, ' Deep cave '),
    sceneActivateIntent(S),
    layerLockIntent(S, 'map', true),
    entityMoveLayerIntent(S, E, 'map'),
    seatCreateIntent(tid(12), ' Dax ', 'player'),
    seatAssignIntent(P, ` ${tid(13)} `),
    seatReleaseIntent(C),
    seatRoleIntent(P, 'codm'),
    seatPermissionIntent(P, 'edit', true),
  ];
  it.each(specs.map((s) => [s.type, s] as const))('%s', (_type, spec) => {
    expect(canPerform(state, host, spec.type, spec.payload)).toBe(true);
  });
  it('trims names and ids in the payload', () => {
    expect(sceneCreateIntent(tid(11), '  Inn  ').payload).toEqual({
      sceneId: tid(11),
      name: 'Inn',
    });
    expect(seatAssignIntent(P, ` ${tid(13)} `).payload).toEqual({ seatId: P, identityId: tid(13) });
  });
  it('a co-DM may manage scenes and layers but not seats', () => {
    const coDm = { kind: 'seat', seatId: C } as const;
    expect(canPerform(state, coDm, 'layer.lock', layerLockIntent(S, 'map', true).payload)).toBe(
      true,
    );
    expect(canPerform(state, coDm, 'scene.activate', sceneActivateIntent(S).payload)).toBe(true);
    expect(canPerform(state, coDm, 'seat.update', seatRoleIntent(P, 'codm').payload)).toBe(false);
  });
});

describe('scene bounds intents (D37)', () => {
  it('sceneCreateIntent carries bounds only when given', () => {
    expect(sceneCreateIntent(tid(11), 'Inn').payload).toEqual({ sceneId: tid(11), name: 'Inn' });
    expect(sceneCreateIntent(tid(11), 'Inn', { width: 20, height: 10 }).payload).toEqual({
      sceneId: tid(11),
      name: 'Inn',
      bounds: { width: 20, height: 10 },
    });
  });
  it('sceneBoundsIntent is a scene.update', () => {
    expect(sceneBoundsIntent(S, { width: 9, height: 8 })).toEqual({
      type: 'scene.update',
      payload: { sceneId: S, bounds: { width: 9, height: 8 } },
      sceneId: S,
    });
  });
});
