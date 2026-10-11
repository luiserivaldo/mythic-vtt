import { expect, test } from '@playwright/test';
import { RawClient, startTable, testUlid } from './harness.js';

test('chat contract filters actual WebSocket snapshots, updates and reconnect replay', async () => {
  const table = await startTable();
  const clients: RawClient[] = [];
  const connect = async (
    name: string,
    extra: Partial<Parameters<typeof RawClient.connect>[1]> = {},
  ) => {
    const c = await RawClient.connect(table, {
      name,
      identityId: testUlid(name, 91),
      identitySecret: `${name}-fixture-secret`,
      ...extra,
    });
    clients.push(c);
    await c.waitFor('initial view', () => c.lastSeq >= 0);
    return c;
  };
  try {
    const host = await connect('host', { hostToken: table.hostToken });
    const alice = await connect('alice');
    const coDm = await connect('codm');
    const spectator = await connect('spectator');
    const seatId = testUlid('seat', 91);
    const dmSeatId = testUlid('seat', 92);
    for (const [id, client, role] of [
      [seatId, alice, 'player'],
      [dmSeatId, coDm, 'codm'],
    ] as const) {
      expect((await host.intent('seat.create', { seatId: id, label: role, role })).t).toBe('ack');
      expect(
        (await host.intent('seat.assign', { seatId: id, identityId: client.opts.identityId })).t,
      ).toBe('ack');
    }
    await Promise.all([alice, coDm, spectator].map((c) => c.waitForSeq(host.lastSeq)));
    const before = spectator.state;
    const beforeSeq = spectator.lastSeq;
    for (const [text, audience] of [
      ['WHISPER-PRIVATE-TEXT', { kind: 'whisper', seatId }],
      ['DM-PRIVATE-TEXT', { kind: 'dm' }],
      ['PUBLIC-TEXT', { kind: 'public' }],
    ] as const)
      expect((await host.intent('chat.post', { text, audience })).t).toBe('ack');
    await Promise.all([alice, coDm, spectator].map((c) => c.waitForSeq(host.lastSeq)));
    const wire = (c: RawClient) => c.frames.join('\n');
    expect(wire(alice)).toContain('WHISPER-PRIVATE-TEXT');
    expect(wire(alice)).not.toContain('DM-PRIVATE-TEXT');
    expect(wire(coDm)).toContain('DM-PRIVATE-TEXT');
    expect(wire(coDm)).not.toContain('WHISPER-PRIVATE-TEXT');
    expect(wire(spectator)).not.toContain('PRIVATE-TEXT');
    expect(wire(spectator)).toContain('PUBLIC-TEXT');
    const late = await connect('late');
    expect(wire(late)).not.toContain('PRIVATE-TEXT');
    const replay = await connect('replay', {
      ...spectator.opts,
      lastSeq: beforeSeq,
      initialState: before,
    });
    await replay.waitForSeq(host.lastSeq);
    expect(wire(replay)).not.toContain('PRIVATE-TEXT');
    expect(wire(replay)).toContain('PUBLIC-TEXT');
    expect(
      (await spectator.intent('chat.post', { text: 'forged', audience: { kind: 'public' } })).t,
    ).toBe('reject');
    const forged = {
      audience: { kind: 'public' },
      result: {
        notation: '1d20',
        dice: [{ sides: 20, value: 20, kept: true, sign: 1 }],
        modifier: 0,
        total: 20,
      },
    };
    for (const c of [host, alice, spectator])
      expect((await c.intent('dice.record', forged)).t).toBe('reject');
    expect(
      (
        await host.intent('permission.update', {
          target: 'seat',
          seatId,
          permissions: { view: false },
        })
      ).t,
    ).toBe('ack');
    const revoked = await connect('revoked', {
      ...alice.opts,
      lastSeq: beforeSeq,
      initialState: before,
    });
    expect(revoked.durableFrames[0]?.type).toBe('snapshot');
    expect(wire(revoked)).not.toContain('PRIVATE-TEXT');
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await table.stop();
  }
});
