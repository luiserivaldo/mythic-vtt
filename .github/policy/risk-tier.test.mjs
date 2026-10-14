import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  compileTierMap,
  evaluate,
  fileTier,
  filesTier,
  globToRegExp,
  loadTierMap,
} from './risk-tier.mjs';

const compiled = compileTierMap(loadTierMap());
const fixture = (n) =>
  JSON.parse(readFileSync(new URL(`./fixtures/pr-${n}.json`, import.meta.url), 'utf8')).files;

test('globs: ** spans directories, * stays in a segment, braces alternate', () => {
  assert.ok(globToRegExp('packages/protocol/**').test('packages/protocol/src/version.ts'));
  assert.ok(globToRegExp('**/package.json').test('package.json'));
  assert.ok(globToRegExp('**/package.json').test('packages/host/package.json'));
  assert.ok(!globToRegExp('packages/*/x.ts').test('packages/a/b/x.ts'));
  assert.ok(globToRegExp('a/{b,c}*').test('a/cat.ts'));
  assert.ok(!globToRegExp('a/{b,c}*').test('a/dog.ts'));
  assert.ok(!globToRegExp('docs/**').test('docsx/a.md'));
});

test('critical paths are C even when they are markdown or css', () => {
  assert.equal(fileTier('.github/pull_request_template.md', compiled), 'C');
  assert.equal(fileTier('.github/policy/risk-tier.mjs', compiled), 'C');
  assert.equal(fileTier('packages/shared/src/visibility/visible-to.ts', compiled), 'C');
  assert.equal(fileTier('packages/client/src/render/token-labels.ts', compiled), 'C');
  assert.equal(fileTier('packages/client/src/net/identity-qr.ts', compiled), 'C');
  assert.equal(fileTier('packages/host/src/engine/ephemeral-relay.ts', compiled), 'C');
  assert.equal(fileTier('README.md', compiled), 'A');
  assert.equal(fileTier('packages/client/src/ui/shell.css', compiled), 'A');
  assert.equal(fileTier('packages/client/src/ui/TopBar.tsx', compiled), 'B');
  assert.equal(fileTier('e2e/view-as.spec.ts', compiled), 'B');
});

test('the 12 PRs open at cutover classify as reviewed by hand (2026-10-14)', () => {
  // #60 is C by path (token-labels.ts); #90 by its identity-credential code; #89 is plain UI.
  const expected = {
    14: 'C',
    26: 'C',
    45: 'C',
    48: 'C',
    56: 'C',
    60: 'C',
    89: 'B',
    90: 'C',
    92: 'C',
    94: 'C',
    95: 'C',
    96: 'C',
  };
  for (const [pr, tier] of Object.entries(expected)) {
    assert.equal(filesTier(fixture(pr), compiled), tier, `PR #${pr}`);
  }
});

test('an empty file list is never cheaper than B', () => {
  assert.equal(filesTier([], compiled), 'B');
});

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const trustedCreator = 'mythic-vtt-critical[bot]';
const run = (over) =>
  evaluate({
    files: ['packages/client/src/ui/TopBar.tsx'],
    compiled,
    currentLabels: ['tier-b'],
    everLabels: ['tier-b'],
    critical: undefined,
    trustedCreator,
    head,
    base,
    ...over,
  });
const review = (over) => ({
  state: 'success',
  creator: trustedCreator,
  description: `reviewed base=${base}`,
  ...over,
});

test('fails closed until a tier label is synced from Jira', () => {
  const v = run({ currentLabels: [], everLabels: [] });
  assert.equal(v.state, 'pending');
  assert.match(v.description, /awaiting tier label/);
});

test('a tier B PR passes without a critical review', () => {
  assert.equal(run({}).state, 'success');
});

test('a tier label can raise the tier but removing it never lowers it', () => {
  const removed = run({ currentLabels: ['tier-b'], everLabels: ['tier-c', 'tier-b'] });
  assert.equal(removed.tier, 'C');
  assert.equal(removed.state, 'pending');
  // A tier-a label never lowers a B diff.
  assert.equal(run({ currentLabels: ['tier-a'], everLabels: ['tier-a'] }).tier, 'B');
});

test('tier C needs a review/critical from the trusted App on the current base', () => {
  const files = ['packages/shared/src/visibility/visible-to.ts'];
  assert.equal(run({ files }).state, 'pending');
  assert.equal(run({ files, critical: review() }).state, 'success');
  assert.equal(run({ files, critical: review({ creator: 'mythic-vtt-bot' }) }).state, 'failure');
  assert.equal(
    run({ files, critical: review({ description: `reviewed base=${'c'.repeat(40)}` }) }).state,
    'pending',
  );
  assert.equal(run({ files, critical: review({ state: 'failure' }) }).state, 'failure');
});

test('the verdict description names tier, head and base and fits a status (140 chars)', () => {
  const v = run({ files: ['packages/protocol/src/version.ts'] });
  assert.match(v.description, /^tier=C head=aaaaaaa base=bbbbbbb: /);
  assert.ok(v.description.length <= 140);
});
