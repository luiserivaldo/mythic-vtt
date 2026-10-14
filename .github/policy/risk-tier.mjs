// Alpha Pipeline v2 review gate: pure policy. No I/O here, so it can be tested against real PR file
// lists and so the trusted workflow (gate.mjs) is the only place that talks to GitHub.
import { readFileSync } from 'node:fs';

export const TIERS = ['A', 'B', 'C'];
const rank = (tier) => TIERS.indexOf(tier);
export const maxTier = (...tiers) =>
  tiers.filter((t) => TIERS.includes(t)).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'A');

export function loadTierMap(url = new URL('./risk-tiers.json', import.meta.url)) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

/** Minimal glob: `**` (any depth), `*` and `?` (within a segment), `{a,b}` alternatives. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` may also match zero directories.
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') out += '(?:';
    else if (c === '}') out += ')';
    else if (c === ',') out += '|';
    else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function compileTierMap(map) {
  return { C: map.C.map(globToRegExp), A: map.A.map(globToRegExp) };
}

/** C wins over A, so a `.md` or `.css` under a critical path stays critical. Unmatched is B. */
export function fileTier(path, compiled) {
  if (compiled.C.some((re) => re.test(path))) return 'C';
  if (compiled.A.some((re) => re.test(path))) return 'A';
  return 'B';
}

/** An empty or unreadable file list is never cheap: it counts as B. */
export function filesTier(paths, compiled) {
  if (paths.length === 0) return 'B';
  return maxTier(...paths.map((p) => fileTier(p, compiled)));
}

const labelTier = (label) => /^tier-([abc])$/i.exec(label)?.[1].toUpperCase();

/**
 * The gate verdict for one PR head.
 * - `currentLabels`: labels on the PR now; one tier label must be present (synced from the Jira
 *   brief) before the gate can succeed: fail closed.
 * - `everLabels`: every label ever applied (timeline); a tier can be raised but never lowered.
 * - `critical`: the newest `review/critical` status on the head, or undefined.
 * - `trustedCreator`: the critical App's bot login; any other creator is refused.
 */
export function evaluate({
  files,
  compiled,
  currentLabels,
  everLabels,
  critical,
  trustedCreator,
  head,
  base,
}) {
  const fromFiles = filesTier(files, compiled);
  const declared = [...currentLabels, ...everLabels].map(labelTier).filter(Boolean);
  const tier = maxTier(fromFiles, ...declared);
  const tag = `tier=${tier} head=${head.slice(0, 7)} base=${base.slice(0, 7)}`;
  const verdict = (state, reason) => ({ state, tier, fromFiles, description: `${tag}: ${reason}` });

  if (!currentLabels.some(labelTier)) return verdict('pending', 'awaiting tier label from Jira');
  if (tier !== 'C') return verdict('success', 'no critical review needed');
  if (!critical) return verdict('pending', 'awaiting review/critical');
  if (critical.creator !== trustedCreator) return verdict('failure', 'review/critical untrusted');
  if (!critical.description.includes(`base=${base}`)) {
    return verdict('pending', 'review/critical is for another base');
  }
  if (critical.state !== 'success') return verdict('failure', `review/critical ${critical.state}`);
  return verdict('success', 'critical review valid');
}
