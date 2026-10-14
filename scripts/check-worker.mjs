// `pnpm check:worker`: the targeted pre-push check for agent workers (Alpha Pipeline v2). It builds
// and typechecks everything (cheap, and cross-package type breaks are the common miss), but lints
// and unit-tests only what the branch changed. CI still runs the full `check` and `e2e` on the
// integrated result, so this must stay fast rather than exhaustive.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (/** @type {string[]} */ args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const baseRef = process.env.CHECK_BASE ?? 'origin/develop';
const base = git(['merge-base', 'HEAD', baseRef]);
// Committed and uncommitted changes since the branch left develop; deleted files are skipped.
const changed = [
  ...new Set(
    [
      git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`]),
      git(['diff', '--name-only', '--diff-filter=d', 'HEAD']),
    ]
      .join('\n')
      .split('\n')
      .filter(Boolean),
  ),
];
console.log(
  `check:worker against ${baseRef} (${base.slice(0, 7)}): ${String(changed.length)} files`,
);

const lintable = changed.filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !f.startsWith('fixtures/'));
const formattable = changed.filter((f) => /\.(ts|tsx|js|mjs|json|md|css|ya?ml)$/.test(f));
const sources = changed.filter((f) => /^packages\/[^/]+\/src\/.*\.tsx?$/.test(f));
const specs = changed.filter((f) => /^e2e\/.*\.spec\.ts$/.test(f));

run('pnpm', ['build']);
run('pnpm', ['typecheck']);
if (lintable.length > 0) run('pnpm', ['exec', 'eslint', ...lintable]);
if (formattable.length > 0) run('pnpm', ['exec', 'prettier', '--check', ...formattable]);
if (sources.length > 0) run('pnpm', ['exec', 'vitest', 'related', '--run', ...sources]);
if (changed.some((f) => f.startsWith('.github/policy/')))
  run('node', ['--test', '.github/policy/']);

console.log(
  specs.length > 0
    ? `\nRun the changed e2e specs under the host lock:\n  ${specs.join('\n  ')}`
    : '\nNo e2e spec changed; CI runs the full suite on the integrated head.',
);
