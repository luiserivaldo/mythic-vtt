import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { RawClient, testUlid } from './harness.js';

const hostDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/host');
// 1x1 PNG: the smallest valid upload the image pipeline accepts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const DM = { identityId: testUlid('HOST', 7), identitySecret: 'multi-campaign-secret' };

interface Running {
  child: ChildProcess;
  hostPort: number;
  hostToken: string;
}

function start(dataDir: string, args: string[]): Promise<Running> {
  const child = spawn(process.execPath, ['dist/main.js', ...args], {
    cwd: hostDir,
    env: { ...process.env, MYTHIC_PORT: '0', MYTHIC_DATA_DIR: dataDir },
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

async function stop(running: Running): Promise<void> {
  const { child } = running;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function openAsDm(running: Running): Promise<RawClient> {
  const dm = await RawClient.connect(running, { name: 'dm', ...DM, hostToken: running.hostToken });
  await dm.waitFor('initial snapshot', () => dm.state !== undefined);
  return dm;
}

const sceneNames = (state: unknown): string[] =>
  Object.values((state as { scenes: Record<string, { name: string }> }).scenes).map((s) => s.name);

test('several campaigns on one host stay isolated and are chosen at start (HOST-03)', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mythic-multi-'));
  try {
    // Campaign Alpha: one extra scene and one uploaded image.
    let running = await start(dataDir, ['--new-campaign', 'Alpha']);
    let dm = await openAsDm(running);
    expect((dm.state as { name: string }).name).toBe('Alpha');
    const alphaId = (dm.state as { id: string }).id;
    expect(
      await dm.intent('scene.create', { sceneId: testUlid('SCENE', 1), name: 'Alpha vault' }),
    ).toMatchObject({ t: 'ack' });
    const upload = await fetch(`http://127.0.0.1:${String(running.hostPort)}/assets/images`, {
      method: 'POST',
      headers: {
        'content-type': 'image/png',
        authorization: `Mythic ${DM.identityId}.${DM.identitySecret}`,
      },
      body: PNG,
    });
    expect(upload.status).toBe(201);
    const alphaHash = ((await upload.json()) as { image: { hash: string } }).image.hash;
    await stop(running);

    // Campaign Beta on the same host: it sees none of Alpha, including the image.
    running = await start(dataDir, ['--new-campaign', 'Beta']);
    dm = await openAsDm(running);
    expect((dm.state as { name: string }).name).toBe('Beta');
    expect((dm.state as { id: string }).id).not.toBe(alphaId);
    expect(sceneNames(dm.state)).not.toContain('Alpha vault');
    const foreign = await fetch(`http://127.0.0.1:${String(running.hostPort)}/assets/${alphaHash}`);
    expect(foreign.status).toBe(404);
    await stop(running);

    // The flag brings Alpha back with everything it had.
    running = await start(dataDir, ['--campaign', 'alpha']);
    dm = await openAsDm(running);
    expect((dm.state as { id: string }).id).toBe(alphaId);
    expect(sceneNames(dm.state)).toContain('Alpha vault');
    const own = await fetch(`http://127.0.0.1:${String(running.hostPort)}/assets/${alphaHash}`);
    expect(own.status).toBe(200);
    await stop(running);

    // Listing and a bad choice, neither of which starts a server.
    const run = (args: string[]) =>
      spawnSync(process.execPath, ['dist/main.js', ...args], {
        cwd: hostDir,
        env: { ...process.env, MYTHIC_DATA_DIR: dataDir },
        encoding: 'utf8',
      });
    const listed = run(['--list-campaigns']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('Alpha');
    expect(listed.stdout).toContain('Beta');
    const unknown = run(['--campaign', 'Gamma']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('Alpha');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
