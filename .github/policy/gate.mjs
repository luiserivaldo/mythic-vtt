// Alpha Pipeline v2 review gate, run by review-gate.yml from the default branch. It reads the PR
// only through the API (never checks out or runs PR code) and writes `review-gate` as the
// mythic-vtt-gate App, on the head and on the test-merge commit. Any error exits non-zero without
// posting, so a missing verdict keeps the PR blocked (fail closed).
import { createSign } from 'node:crypto';
import { compileTierMap, evaluate, loadTierMap } from './risk-tier.mjs';

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};
const repo = env('GITHUB_REPOSITORY');
const prNumber = Number(env('PR_NUMBER'));
if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('PR_NUMBER is not a PR number');
const trustedCreator = `${env('CRITICAL_APP_SLUG')}[bot]`;
const api = 'https://api.github.com';

const b64url = (data) => Buffer.from(data).toString('base64url');
function appJwt(appId, key) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  )}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key, 'base64url')}`;
}

async function call(token, method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pages(token, path) {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await call(token, 'GET', `${path}${sep}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error(`${path}: more than 3000 entries`);
}

const jwt = appJwt(env('GATE_APP_ID'), env('GATE_APP_KEY'));
const installation = await call(jwt, 'GET', `/repos/${repo}/installation`);
const { token } = await call(jwt, 'POST', `/app/installations/${installation.id}/access_tokens`);

const pr = await call(token, 'GET', `/repos/${repo}/pulls/${prNumber}`);
if (pr.state !== 'open') {
  console.log(`PR #${prNumber} is ${pr.state}; nothing to gate`);
  process.exit(0);
}
const head = pr.head.sha;
const compare = await call(token, 'GET', `/repos/${repo}/compare/${pr.base.sha}...${head}`);
const base = compare.merge_base_commit.sha;
const files = (await pages(token, `/repos/${repo}/pulls/${prNumber}/files`)).map((f) => f.filename);
const timeline = await pages(token, `/repos/${repo}/issues/${prNumber}/timeline`);
const everLabels = timeline.filter((e) => e.event === 'labeled').map((e) => e.label.name);
const currentLabels = pr.labels.map((l) => l.name);
// Newest first: the latest review/critical on this exact head is the one that counts.
const statuses = await call(token, 'GET', `/repos/${repo}/commits/${head}/statuses?per_page=100`);
const latest = statuses.find((s) => s.context === 'review/critical');
const critical = latest && {
  state: latest.state,
  creator: latest.creator?.login,
  description: latest.description ?? '',
};

const verdict = evaluate({
  files,
  compiled: compileTierMap(loadTierMap()),
  currentLabels,
  everLabels,
  critical,
  trustedCreator,
  head,
  base,
});
console.log(JSON.stringify({ pr: prNumber, head, base, ...verdict }));

// Branch protection may read the head or the test-merge commit; post the same bound verdict on both.
const targets = [head, pr.merge_commit_sha].filter(Boolean);
for (const sha of new Set(targets)) {
  await call(token, 'POST', `/repos/${repo}/statuses/${sha}`, {
    state: verdict.state,
    context: 'review-gate',
    description: verdict.description,
    target_url: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
}
