import { CURRENT_SCHEMA_VERSION } from '@mythic/shared';
import type { ServerMessage } from '@mythic/protocol';
import type { Campaign, Entity } from '@mythic/shared';
import type { GatewayConnection } from '../gateway/engine-seam.js';
import type { LogEntry } from '../storage/types.js';
import type { Clock, RandomSource } from './sources.js';

// Test fixtures for the engine (unit and integration tests). Not used at runtime.

const CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Deterministic ULID-shaped id. */
export const tid = (n: number): string => (CHARS[n % 32] ?? '0').repeat(26);

export const T = {
  campaign: tid(1),
  scene: tid(2),
  seatA: tid(3),
  seatB: tid(4),
  coDm: tid(5),
  host: tid(6),
  alice: tid(7),
  bob: tid(8),
  carol: tid(9),
  token: tid(10),
  secret: tid(11),
  hiddenName: tid(12),
  newScene: tid(13),
} as const;

/** Strings that must never reach a non-host audience (PERM-03). */
export const SECRETS = ['SECRET-DM', 'HIDDEN-NAME'] as const;

function entity(id: string, over: Partial<Entity>): Entity {
  return {
    id,
    layer: 'tokens',
    name: `Entity ${id.slice(0, 3)}`,
    owners: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ...over,
  };
}

/**
 * One scene with a visible token, a DM-layer entity and a token whose label is DM-only.
 * Alice sits in seat A; seat B and the co-DM seat are free.
 */
export function fixtureCampaign(): Campaign {
  const perms = { view: true, move: true, edit: false, delete: false };
  const seat = (id: string, label: string, role: 'player' | 'codm', identityId: string | null) => ({
    id,
    label,
    binding: 'persistent' as const,
    identityId,
    role,
    permissions: perms,
  });
  return {
    id: T.campaign,
    name: 'Engine test',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: {
      defaultBinding: 'persistent',
      instanceMode: 'linked',
      spectators: { enabled: true, view: 'players' },
    },
    seats: {
      [T.seatA]: seat(T.seatA, 'A', 'player', T.alice),
      [T.seatB]: seat(T.seatB, 'B', 'player', null),
      [T.coDm]: seat(T.coDm, 'Co', 'codm', null),
    },
    scenes: {
      [T.scene]: {
        id: T.scene,
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
        entities: {
          [T.token]: entity(T.token, { name: 'Goblin', owners: [T.seatA] }),
          [T.secret]: entity(T.secret, { layer: 'dm', name: 'SECRET-DM' }),
          [T.hiddenName]: entity(T.hiddenName, {
            name: 'HIDDEN-NAME',
            token: { sizeCells: 1, heightCells: 1, labelVisibility: 'dm' },
          }),
        },
      },
    },
    activeSceneId: T.scene,
  };
}

/** A fake gateway connection that records what it receives (raw frames decoded). */
export interface FakeConnection extends GatewayConnection {
  readonly received: ServerMessage[];
  /** Everything received, as sent on the wire, for leak scans. */
  wire(): string;
  clear(): void;
}

let nextConn = 0;
export function fakeConnection(
  identityId: string,
  opts: { isHost?: boolean; lastSeq?: number } = {},
): FakeConnection {
  const received: ServerMessage[] = [];
  const frames: string[] = [];
  nextConn += 1;
  return {
    connectionId: `conn-${String(nextConn)}`,
    identityId,
    displayName: 'Test',
    avatar: undefined,
    isHost: opts.isHost ?? false,
    lastSeq: opts.lastSeq,
    received,
    send(m) {
      frames.push(JSON.stringify(m));
      received.push(m);
    },
    sendRaw(frame) {
      frames.push(frame);
      received.push(JSON.parse(frame) as ServerMessage);
    },
    close: () => undefined,
    wire: () => frames.join('\n'),
    clear() {
      received.length = 0;
      frames.length = 0;
    },
  };
}

/** In-memory log sink; `fail` makes the next append throw. */
export function memoryLog() {
  const entries: LogEntry[] = [];
  const log = {
    entries,
    fail: false,
    appendLog(_campaignId: string, _sessionId: string, batch: LogEntry[]): Promise<void> {
      if (log.fail) return Promise.reject(new Error('disk full'));
      entries.push(...batch);
      return Promise.resolve();
    },
  };
  return log;
}

/** Fixed-step clock and counter-based "random" source, for deterministic envelopes. */
export function fakeClock(start = 1_700_000_000_000, step = 1): Clock {
  let t = start - step;
  return () => (t += step);
}
export function fakeRandom(): RandomSource {
  let n = 0;
  return (size) => {
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) out[i] = (n += 1) & 0xff;
    return out;
  };
}
