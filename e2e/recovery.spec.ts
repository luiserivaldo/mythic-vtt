import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { RawClient, testUlid } from './harness.js';

const hostDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/host');

async function start(
  dataDir: string,
): Promise<{ child: ChildProcess; hostPort: number; hostToken: string }> {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: hostDir,
    env: {
      ...process.env,
      MYTHIC_PORT: '0',
      MYTHIC_DATA_DIR: dataDir,
      MYTHIC_AUTOSAVE_ACTIONS: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`host startup timed out: ${output}`));
    }, 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on [^\s:]+:(\d+)[\s\S]*DM link: \S+#host=([\w-]+)/.exec(output);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, hostPort: Number(match[1]), hostToken: match[2] ?? '' });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`host exited during startup (${String(code)}): ${output}`));
    });
  });
}

async function stop(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.kill(signal);
  });
}

test('SIGKILL recovers the autosave plus log tail and keeps sequence increasing', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-crash-'));
  const children: ChildProcess[] = [];
  try {
    const first = await start(dataDir);
    children.push(first.child);
    const dm = await RawClient.connect(first, {
      name: 'dm',
      identityId: testUlid('HOST', 1),
      identitySecret: 'crash-test-secret',
      hostToken: first.hostToken,
    });
    await dm.waitFor('initial snapshot', () => dm.state !== undefined);
    const campaignId = (dm.state as { id: string }).id;
    const sceneId = testUlid('SCENE', 1);
    const entityId = testUlid('TOKEN', 1);
    expect(await dm.intent('scene.create', { sceneId, name: 'First' })).toMatchObject({
      t: 'ack',
      seq: 1,
    });
    expect(
      await dm.intent('entity.create', {
        sceneId,
        entity: {
          id: entityId,
          layer: 'tokens',
          name: 'Crash survivor',
          owners: [],
          transform: {
            position: { x: 2, y: 0, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
          },
          token: { sizeCells: 1, heightCells: 1, labelVisibility: 'all' },
        },
      }),
    ).toMatchObject({
      t: 'ack',
      seq: 2,
    });
    expect(await dm.intent('scene.rename', { sceneId, name: 'Tail' })).toMatchObject({
      t: 'ack',
      seq: 3,
    });
    await stop(first.child, 'SIGKILL');

    const sessions = join(dataDir, 'campaigns', campaignId, 'sessions');
    const { readdir } = await import('node:fs/promises');
    const [sessionId] = await readdir(sessions);
    if (!sessionId) throw new Error('session directory missing');
    expect(
      JSON.parse(await readFile(join(sessions, sessionId, 'snapshots/autosave.json'), 'utf8')),
    ).toMatchObject({ seq: 2 });
    await appendFile(join(sessions, sessionId, 'log.jsonl'), '{"envelope":');

    const second = await start(dataDir);
    children.push(second.child);
    const restored = await RawClient.connect(second, {
      name: 'restored-dm',
      identityId: testUlid('HOST', 2),
      identitySecret: 'crash-test-secret-2',
      hostToken: second.hostToken,
    });
    await restored.waitFor('recovered snapshot', () => restored.state !== undefined);
    expect(restored.lastSeq).toBe(3);
    expect(
      (restored.state as { scenes: Record<string, { name: string }> }).scenes[sceneId]?.name,
    ).toBe('Tail');
    expect(
      (restored.state as { scenes: Record<string, { entities: Record<string, { name: string }> }> })
        .scenes[sceneId]?.entities[entityId]?.name,
    ).toBe('Crash survivor');
    expect(await restored.intent('scene.rename', { sceneId, name: 'After restart' })).toMatchObject(
      { t: 'ack', seq: 4 },
    );
    await restored.close();
    await stop(second.child, 'SIGTERM');
    const secondSession = (await readdir(sessions)).find((id) => id !== sessionId);
    if (!secondSession) throw new Error('second session directory missing');
    expect(
      JSON.parse(await readFile(join(sessions, secondSession, 'snapshots/end.json'), 'utf8')),
    ).toMatchObject({ seq: 4 });

    const third = await start(dataDir);
    children.push(third.child);
    const clean = await RawClient.connect(third, {
      name: 'clean-dm',
      identityId: testUlid('HOST', 3),
      identitySecret: 'crash-test-secret-3',
      hostToken: third.hostToken,
    });
    await clean.waitFor('clean restart snapshot', () => clean.state !== undefined);
    expect(clean.lastSeq).toBe(4);
    const scenes = (
      clean.state as {
        scenes: Record<string, { name: string; entities: Record<string, { name: string }> }>;
      }
    ).scenes;
    expect(scenes[sceneId]?.name).toBe('After restart');
    expect(scenes[sceneId]?.entities[entityId]?.name).toBe('Crash survivor');
    await clean.close();
    await stop(third.child, 'SIGTERM');
  } finally {
    await Promise.all(children.map((child) => stop(child, 'SIGKILL')));
    await rm(dataDir, { recursive: true, force: true });
  }
});
