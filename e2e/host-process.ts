import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A host process on a data dir of its own, serving the built client so uploads and the host-only
// REST routes are same-origin (D36). Used where a test needs several campaigns or restarts.

export const hostDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/host');
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '../packages/client/dist/app');
// 1x1 PNG: the smallest valid upload the image pipeline accepts.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface Running {
  child: ChildProcess;
  hostPort: number;
  hostToken: string;
}

export function start(dataDir: string, args: string[]): Promise<Running> {
  const child = spawn(process.execPath, ['dist/main.js', ...args], {
    cwd: hostDir,
    env: {
      ...process.env,
      MYTHIC_PORT: '0',
      MYTHIC_DATA_DIR: dataDir,
      MYTHIC_CLIENT_DIR: clientDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`host startup timed out: ${output}`));
    }, 15_000);
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

export async function stop(running: Running): Promise<void> {
  const { child } = running;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGTERM');
  });
}
