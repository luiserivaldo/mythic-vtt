import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ServerMessage } from '@mythic/protocol';
import { loadConfig } from '../config.js';
import { startHost, type RunningHost } from '../server.js';
import { fakeConnection, tid } from './testing.js';

let dir: string | undefined;
let running: RunningHost | undefined;

async function shutDown() {
  const current = running;
  running = undefined;
  await current?.close();
}

afterEach(async () => {
  await shutDown();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const boot = async () => {
  if (!dir) throw new Error('no data dir');
  running = await startHost(loadConfig({ MYTHIC_DATA_DIR: dir, MYTHIC_PORT: '0' }));
  const host = fakeConnection(tid(6), { isHost: true });
  await running.engine.onConnect(host);
  return { engine: running.engine, host };
};

let ref = 0;
async function send(
  engine: RunningHost['engine'],
  host: ReturnType<typeof fakeConnection>,
  type: string,
  payload: unknown,
) {
  const clientRef = `i${String((ref += 1))}`;
  host.clear();
  await engine.onIntent(host, { t: 'intent', type, payload, clientRef });
  return host.received.find(
    (m): m is Extract<ServerMessage, { t: 'ack' | 'reject' }> =>
      (m.t === 'ack' || m.t === 'reject') && m.clientRef === clientRef,
  );
}

it('rolls back across a host restart, and a later restart recovers the rolled-back state', async () => {
  dir = await mkdtemp(join(tmpdir(), 'mythic-rollback-'));

  // Session 1: three renames.
  let { engine, host } = await boot();
  const sceneId = engine.state().activeSceneId ?? '';
  for (const name of ['One', 'Two', 'Three'])
    expect((await send(engine, host, 'scene.rename', { sceneId, name }))?.t).toBe('ack');
  expect(engine.seq()).toBe(3);
  await shutDown();

  // Session 2 rolls back to a point that only exists in session 1's log.
  ({ engine, host } = await boot());
  expect(engine.state().scenes[sceneId]?.name).toBe('Three');
  expect((await send(engine, host, 'scene.rename', { sceneId, name: 'Four' }))?.t).toBe('ack');
  expect(await send(engine, host, 'history.rollback', { toSeq: 1 })).toMatchObject({
    t: 'ack',
    seq: 5,
  });
  expect(engine.state().scenes[sceneId]?.name).toBe('One');
  await shutDown();

  // Session 3 recovers by replaying the logged rollback.
  const third = await boot();
  engine = third.engine;
  expect(engine.seq()).toBe(5);
  expect(engine.state().scenes[sceneId]?.name).toBe('One');

  // The log kept every action, in order, across the sessions.
  const campaignId = engine.state().id;
  const lines: string[] = [];
  const sessions = await readdir(join(dir, 'campaigns', campaignId, 'sessions'));
  for (const session of sessions.sort()) {
    const text = await readFile(
      join(dir, 'campaigns', campaignId, 'sessions', session, 'log.jsonl'),
      'utf8',
    ).catch(() => '');
    lines.push(...text.split('\n').filter(Boolean));
  }
  const types = lines.map(
    (line) => (JSON.parse(line) as { envelope: { type: string } }).envelope.type,
  );
  expect(types).toEqual([
    'scene.rename',
    'scene.rename',
    'scene.rename',
    'scene.rename',
    'history.rollback',
  ]);
});
