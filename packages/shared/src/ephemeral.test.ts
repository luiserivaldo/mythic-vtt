import { describe, expect, it } from 'vitest';
import { PING_SCENE_ID_MAX, PingPayload, parsePingPayload } from './ephemeral.js';

// LAY-05 / M4-14: the `ping` channel's payload contract. Both ends enforce it — a client validating
// a marker it received, and the host relay validating what a sender put on a toggle-gated channel —
// so the boundary cases below have to hold for the relay too, not only for the board.
describe('ping payload (LAY-05)', () => {
  it('parses a point on a scene, with or without the relay-stamped profile colour', () => {
    expect(parsePingPayload({ sceneId: 'S', x: 2.5, y: 0, z: 3.25 })).toEqual({
      sceneId: 'S',
      x: 2.5,
      y: 0,
      z: 3.25,
    });
    expect(parsePingPayload({ sceneId: 'S', x: 0, y: 0, z: 0, color: '#a1B2c3' })).toEqual({
      sceneId: 'S',
      x: 0,
      y: 0,
      z: 0,
      color: '#a1B2c3',
    });
    // The scene id is bounded, so a ping can never carry a paragraph of it.
    expect(parsePingPayload({ sceneId: 'S'.repeat(PING_SCENE_ID_MAX), x: 0, y: 0, z: 0 })).not.toBe(
      null,
    );
  });

  it('returns null for anything that is not exactly a finite ping', () => {
    const malformed: unknown[] = [
      null,
      undefined,
      'x',
      1,
      true,
      [],
      {},
      { sceneId: 'S' },
      { sceneId: 'S', x: 0, y: 0 },
      { sceneId: '', x: 0, y: 0, z: 0 },
      { sceneId: 'S'.repeat(PING_SCENE_ID_MAX + 1), x: 0, y: 0, z: 0 },
      { sceneId: 'S', x: Number.NaN, y: 0, z: 0 },
      { sceneId: 'S', x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
      { sceneId: 'S', x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
      { sceneId: 'S', x: '0', y: 0, z: 0 },
      { sceneId: 'S', x: 0, y: 0, z: 0, color: 'red' },
      { sceneId: 'S', x: 0, y: 0, z: 0, padding: 'x'.repeat(4096) },
    ];
    for (const data of malformed) expect(parsePingPayload(data)).toBeNull();
    // `z.number()` is the finite check: JSON cannot carry NaN, but a JS sender can put it on the wire.
    expect(PingPayload.safeParse({ sceneId: 'S', x: Number.NaN, y: 0, z: 0 }).success).toBe(false);
  });
});
