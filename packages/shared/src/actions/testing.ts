import type { Campaign } from '../schema/index.js';
import type { Actor } from './envelope.js';
import { canPerform } from './run.js';

const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Deterministic test id: `testId(1)` -> a valid ULID string. */
export function testId(n: number): string {
  return (ULID_CHARS[n % 32] ?? '0').repeat(26);
}

export const IDS = {
  campaign: testId(1),
  scene: testId(2),
  owner: testId(3),
  other: testId(4),
  coDm: testId(5),
  session: testId(6),
  entity: testId(7),
  action: testId(8),
  identity: testId(9),
  otherIdentity: testId(10),
} as const;

const perms = { view: true, move: true, edit: false, delete: false };

/** Minimal campaign with one scene, two player seats and a co-DM seat. */
export function makeCampaign(): Campaign {
  const seat = (id: string, label: string, role: 'player' | 'codm') => ({
    id,
    label,
    binding: 'persistent' as const,
    identityId: null,
    role,
    permissions: perms,
  });
  return {
    id: IDS.campaign,
    name: 'Test campaign',
    schemaVersion: 1,
    settings: {
      defaultBinding: 'persistent',
      instanceMode: 'linked',
      spectators: { enabled: false, view: 'players' },
    },
    seats: {
      [IDS.owner]: seat(IDS.owner, 'Owner', 'player'),
      [IDS.other]: seat(IDS.other, 'Other', 'player'),
      [IDS.coDm]: seat(IDS.coDm, 'Co-DM', 'codm'),
    },
    scenes: {
      [IDS.scene]: {
        id: IDS.scene,
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
        layers: {},
        entities: {},
      },
    },
    activeSceneId: IDS.scene,
  };
}

export const ACTORS = {
  host: { kind: 'host' },
  owner: { kind: 'seat', seatId: IDS.owner },
  otherSeat: { kind: 'seat', seatId: IDS.other },
  coDm: { kind: 'seat', seatId: IDS.coDm },
  // Spectators are connections, not seats: a seat actor with no known seat.
  spectator: { kind: 'seat' },
  mod: { kind: 'mod', modId: 'test-mod' },
} as const satisfies Record<string, Actor>;

export type ActorName = keyof typeof ACTORS;

/**
 * Permission-matrix helper (TECHNICAL.md §4.4): who may perform `type` with `payload`?
 * Returns the full matrix so tests assert every actor explicitly.
 */
export function permissionMatrix(
  state: Campaign,
  type: string,
  payload: unknown,
): Record<ActorName, boolean> {
  const names = Object.keys(ACTORS) as ActorName[];
  return Object.fromEntries(
    names.map((n) => [n, canPerform(state, ACTORS[n], type, payload)]),
  ) as Record<ActorName, boolean>;
}

/** Entity fixture for visibility and action tests. */
export function makeEntity(
  id: string,
  overrides: Partial<import('../schema/index.js').Entity> = {},
): import('../schema/index.js').Entity {
  return {
    id,
    layer: 'tokens',
    name: `Entity ${id.slice(0, 4)}`,
    owners: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...overrides,
  };
}
