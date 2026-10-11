import { describe, expect, it } from 'vitest';
import { reduceAction, type ActionEnvelope, type DiceRecord } from '@mythic/shared';
import { createEngine } from './engine.js';
import {
  fakeClock,
  fakeConnection,
  fakeRandom,
  fixtureCampaign,
  memoryLog,
  T,
  tid,
} from './testing.js';
import { randomFloats } from './sources.js';

function setup() {
  const log = memoryLog();
  const campaign = fixtureCampaign();
  const seat = campaign.seats[T.coDm];
  if (!seat) throw new Error('missing co-DM');
  seat.identityId = T.carol;
  const engine = createEngine({
    campaign,
    sessionId: tid(20),
    store: log,
    clock: fakeClock(),
    random: fakeRandom(),
    onError: () => undefined,
  });
  return { engine, log, campaign };
}
const post = (text: string, audience: unknown) => ({
  t: 'intent' as const,
  type: 'chat.post',
  payload: { text, audience },
  clientRef: 'post',
});

describe('chat contract on the host', () => {
  it('filters live, snapshot and replay frames and hides DM content on demotion', async () => {
    const { engine, log } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const coDm = fakeConnection(T.carol);
    const spectator = fakeConnection(T.bob);
    for (const c of [host, alice, coDm, spectator]) await engine.onConnect(c);
    await engine.onIntent(host, post('DM-SECRET-MESSAGE', { kind: 'dm' }));
    await engine.onIntent(
      host,
      post('WHISPER-SECRET-MESSAGE', { kind: 'whisper', seatId: T.seatA }),
    );
    await engine.onIntent(alice, post('PUBLIC-MESSAGE', { kind: 'public' }));
    expect(log.entries).toHaveLength(3);
    expect(host.wire()).toContain('DM-SECRET-MESSAGE');
    expect(coDm.wire()).toContain('DM-SECRET-MESSAGE');
    expect(coDm.wire()).not.toContain('WHISPER-SECRET-MESSAGE');
    expect(alice.wire()).toContain('WHISPER-SECRET-MESSAGE');
    expect(alice.wire()).not.toContain('DM-SECRET-MESSAGE');
    for (const lastSeq of [undefined, 0]) {
      const watcher = fakeConnection(T.bob, lastSeq === undefined ? {} : { lastSeq });
      await engine.onConnect(watcher);
      expect(watcher.wire()).not.toContain('SECRET-MESSAGE');
      expect(watcher.wire()).toContain('PUBLIC-MESSAGE');
    }
    engine.onDisconnect(coDm);
    await engine.onIntent(host, {
      t: 'intent',
      type: 'seat.update',
      payload: { seatId: T.coDm, role: 'player' },
      clientRef: 'demote',
    });
    const demoted = fakeConnection(T.carol, { lastSeq: 0 });
    await engine.onConnect(demoted);
    expect(demoted.received[0]?.t).toBe('snapshot');
    expect(demoted.wire()).not.toContain('SECRET-MESSAGE');
    await engine.onIntent(spectator, post('UNAUTHORIZED', { kind: 'public' }));
    expect(spectator.received.at(-1)?.t).toBe('reject');
  });
  it('logs only trusted host dice output and replays its proof; rejected/failed writes publish nothing', async () => {
    const { engine, log, campaign } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    const alice = fakeConnection(T.alice);
    const spectator = fakeConnection(T.bob);
    for (const c of [host, alice, spectator]) await engine.onConnect(c);
    const rng = randomFloats(2, fakeRandom());
    const dice = rng.map((draw) => ({
      sides: 20,
      value: Math.floor(draw * 20) + 1,
      kept: true,
      sign: 1 as const,
    }));
    const payload: DiceRecord = {
      audience: { kind: 'dm' },
      result: {
        notation: '2d20+5',
        dice,
        modifier: 5,
        total: dice.reduce((sum, die) => sum + die.value, 5),
      },
    };
    for (const c of [host, alice, spectator]) {
      await engine.onIntent(c, { t: 'intent', type: 'dice.record', payload, clientRef: 'forge' });
      expect(c.received.at(-1)).toMatchObject({ t: 'reject', reason: 'forbidden' });
    }
    expect(engine.seq()).toBe(0);
    await engine.recordRoll({ kind: 'seat', seatId: T.seatA }, payload, rng);
    expect(log.entries[0]?.envelope.rng).toEqual(rng);
    expect(engine.state().chat?.[0]).toMatchObject({ kind: 'roll', result: payload.result });
    expect(reduceAction(campaign, log.entries[0]?.envelope as ActionEnvelope).state).toEqual(
      engine.state(),
    );
    expect(alice.wire()).toContain('2d20+5');
    expect(spectator.wire()).not.toContain('2d20+5');
    await expect(engine.recordRoll({ kind: 'host' }, payload, [1, 1])).rejects.toThrow();
    log.fail = true;
    const prior = engine.state();
    await expect(engine.recordRoll({ kind: 'host' }, payload, rng)).rejects.toThrow();
    expect(engine.state()).toBe(prior);
    expect(log.entries).toHaveLength(1);
  });
  it('forces a fresh view after view permission is revoked while disconnected', async () => {
    const { engine } = setup();
    const host = fakeConnection(T.host, { isHost: true });
    await engine.onConnect(host);
    await engine.onIntent(host, post('OLD-WHISPER-SECRET', { kind: 'whisper', seatId: T.seatA }));
    await engine.onIntent(host, {
      t: 'intent',
      type: 'permission.update',
      payload: { target: 'seat', seatId: T.seatA, permissions: { view: false } },
      clientRef: 'revoke',
    });
    const alice = fakeConnection(T.alice, { lastSeq: 0 });
    await engine.onConnect(alice);
    expect(alice.received[0]?.t).toBe('snapshot');
    expect(alice.wire()).not.toContain('OLD-WHISPER-SECRET');
  });
});
