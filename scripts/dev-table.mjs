// `pnpm dev:table`: a game host plus the client dev server, for local testing (M0-13).
// Host settings come from MYTHIC_* env vars (see packages/host/src/config.ts); the Vite proxy
// reads the same MYTHIC_PORT, so the two always agree.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const revision = spawnSync('git', ['rev-parse', '--short=8', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});
const env = {
  ...process.env,
  MYTHIC_PORT: process.env.MYTHIC_PORT || '8787',
  MYTHIC_BUILD_COMMIT:
    revision.status === 0 && revision.stdout.trim() ? revision.stdout.trim() : 'unknown',
};

// The trailing ellipsis includes workspace dependencies, so the host cannot load a stale shared
// action registry after an action is added in source (PT1-01).
const build = spawnSync('pnpm', ['--filter', '@mythic/host...', 'build'], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  spawn('node', ['dist/main.js'], { cwd: join(root, 'packages/host'), env, stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@mythic/client', 'dev'], { cwd: root, env, stdio: 'inherit' }),
];

let stopping = false;
/** @param {number} code */
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
for (const c of children) {
  c.on('exit', (code) => {
    stop(code ?? 0);
  });
}
for (const s of ['SIGINT', 'SIGTERM']) {
  process.on(s, () => {
    stop(0);
  });
}
