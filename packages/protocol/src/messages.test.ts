import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  isSupportedVersion,
  PROTOCOL_VERSION,
  RulerPreview,
  TokenDragPreview,
  type ClientMessage,
  type ServerMessage,
} from './index.js';

const id = 'A'.repeat(26);

const client: ClientMessage[] = [
  {
    t: 'hello',
    v: PROTOCOL_VERSION,
    identityId: id,
    identitySecret: 'secret',
    displayName: 'Ana',
    lastSeq: 4,
  },
  {
    t: 'hello',
    v: PROTOCOL_VERSION,
    identityId: id,
    identitySecret: 'secret',
    displayName: 'Ana',
    hostToken: 'tok',
  },
  { t: 'join', seatId: id },
  { t: 'join' },
  { t: 'intent', type: 'scene.rename', payload: { sceneId: id, name: 'x' }, clientRef: 'c1' },
  { t: 'ephemeral', channel: 'cursor', data: { x: 1, y: 2 } },
  {
    t: 'ephemeral',
    channel: 'token.drag-preview',
    data: { sceneId: id, entityId: id, to: { x: 1.25, y: 0, z: -2.5 } },
  },
  {
    t: 'ephemeral',
    channel: 'ruler.preview',
    data: {
      sceneId: id,
      points: [
        { x: 0.5, y: 0, z: 0.5 },
        { x: 3.5, y: 0, z: 4.5 },
      ],
      phase: 'active',
    },
  },
  { t: 'ping', n: 1 },
];

const server: ServerMessage[] = [
  { t: 'snapshot', seq: 3, state: { any: 'thing' }, seatId: id },
  { t: 'snapshot', seq: 0, state: null, seatId: null },
  {
    t: 'patch',
    seq: 4,
    patches: [
      { op: 'replace', path: ['scenes', id, 'name'], value: 'x' },
      { op: 'remove', path: ['scenes', id, 'entities', id] },
    ],
    clientRef: 'c1',
  },
  { t: 'ack', clientRef: 'c1', seq: 4 },
  { t: 'reject', clientRef: 'c1', reason: 'forbidden', detail: 'nope' },
  { t: 'ephemeral', channel: 'cursor', data: [1, 2], from: id },
  { t: 'presence', seats: [{ seatId: id, connected: true, latencyMs: null }], spectators: 2 },
  { t: 'pong', n: 1 },
  { t: 'notice', level: 'warning', code: 'quota', message: 'almost full' },
  {
    t: 'error',
    code: 'protocol-mismatch',
    message: 'old client',
    supportedVersion: 1,
    fatal: true,
  },
];

describe('codec round-trips', () => {
  it.each(client)('client $t', (m) => {
    expect(decodeClientMessage(encodeClientMessage(m))).toEqual({ ok: true, message: m });
  });
  it.each(server)('server $t', (m) => {
    expect(decodeServerMessage(encodeServerMessage(m))).toEqual({ ok: true, message: m });
  });
});

describe('rejections', () => {
  it('rejects invalid JSON and unknown message types', () => {
    expect(decodeClientMessage('{nope').ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ t: 'teleport' })).ok).toBe(false);
    expect(decodeServerMessage(JSON.stringify({ t: 'hello' })).ok).toBe(false); // direction matters
  });
  it('rejects missing or malformed fields and extra keys', () => {
    const bad = (m: unknown) => decodeClientMessage(JSON.stringify(m)).ok;
    expect(bad({ t: 'intent', type: 'x', payload: {} })).toBe(false); // no clientRef
    expect(
      bad({ t: 'hello', v: 1, identityId: 'bad', identitySecret: 's', displayName: 'a' }),
    ).toBe(false);
    const h = { t: 'hello', v: 1, identityId: id, identitySecret: 's', displayName: 'a' };
    expect(bad(h)).toBe(true); // hostToken is optional (backwards compatible)
    expect(bad({ ...h, hostToken: 'tok' })).toBe(true);
    expect(bad({ ...h, hostToken: '' })).toBe(false);
    expect(bad({ ...h, hostToken: 5 })).toBe(false);
    expect(bad({ ...h, hostToken: 'x'.repeat(257) })).toBe(false);
    expect(bad({ t: 'ping', n: -1 })).toBe(false);
    expect(bad({ t: 'ping', n: 1, extra: true })).toBe(false);
  });
  it('refuses to encode a malformed frame', () => {
    expect(() => encodeClientMessage({ t: 'ping', n: -1 })).toThrow();
  });
});

describe('protocol version', () => {
  it('is carried by hello and checked explicitly', () => {
    expect(isSupportedVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedVersion(PROTOCOL_VERSION + 1)).toBe(false);
  });
});

describe('token drag preview', () => {
  it('validates the additive TOK-02 ephemeral shape', () => {
    const message = {
      t: 'ephemeral',
      channel: 'token.drag-preview',
      data: { sceneId: id, entityId: id, to: { x: 1.25, y: 0, z: -2.5 } },
    };
    expect(TokenDragPreview.safeParse(message).success).toBe(true);
    expect(
      TokenDragPreview.safeParse({ ...message, data: { ...message.data, entityId: 'bad' } })
        .success,
    ).toBe(false);
    expect(
      TokenDragPreview.safeParse({ ...message, data: { ...message.data, to: { x: 1, y: 2 } } })
        .success,
    ).toBe(false);
    expect(TokenDragPreview.safeParse({ ...message, extra: true }).success).toBe(false);
    expect(
      decodeClientMessage(
        JSON.stringify({ ...message, data: { ...message.data, entityId: 'bad' } }),
      ).ok,
    ).toBe(false);
  });
});

describe('ruler preview', () => {
  it('validates the additive MEAS-01 ephemeral shape', () => {
    const message = {
      t: 'ephemeral',
      channel: 'ruler.preview',
      data: {
        sceneId: id,
        points: [{ x: 0.5, y: 0, z: 0.5 }],
        phase: 'active',
      },
    } as const;
    expect(RulerPreview.safeParse(message).success).toBe(true);
    expect(
      RulerPreview.safeParse({ ...message, data: { ...message.data, phase: 'stored' } }).success,
    ).toBe(false);
    expect(
      decodeClientMessage(
        JSON.stringify({ ...message, data: { ...message.data, points: [{ x: 1, z: 2 }] } }),
      ).ok,
    ).toBe(false);
  });
});

describe('v2 presence latency', () => {
  it('decodes the golden online/offline fixture and round-trips it', () => {
    const raw = readFileSync(
      new URL('../../../fixtures/protocol/v2/presence.json', import.meta.url),
      'utf8',
    );
    const decoded = decodeServerMessage(raw);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('invalid golden fixture');
    expect(decodeServerMessage(encodeServerMessage(decoded.message))).toEqual(decoded);
  });
  it('rejects missing, unbounded and private connection details', () => {
    const seat = { seatId: id, connected: true, latencyMs: 42 };
    const valid = (value: unknown) =>
      decodeServerMessage(JSON.stringify({ t: 'presence', seats: [value], spectators: 0 })).ok;
    expect(valid(seat)).toBe(true);
    for (const latencyMs of [-1, 0.5, 30_001, '42'])
      expect(valid({ ...seat, latencyMs })).toBe(false);
    expect(valid({ seatId: id, connected: true })).toBe(false);
    expect(valid({ ...seat, ip: '192.0.2.1' })).toBe(false);
    expect(valid({ ...seat, identitySecret: 'not-a-real-secret' })).toBe(false);
  });
});
