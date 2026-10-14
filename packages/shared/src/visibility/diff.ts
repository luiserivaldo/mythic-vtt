import type { Patch } from 'immer';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function walk(before: unknown, after: unknown, path: (string | number)[], out: Patch[]): void {
  if (before === after) return; // structural sharing: unchanged subtree
  if (isRecord(before) && isRecord(after)) {
    for (const key of Object.keys(before)) {
      if (!(key in after)) out.push({ op: 'remove', path: [...path, key] });
    }
    for (const [key, next] of Object.entries(after)) {
      if (!(key in before)) out.push({ op: 'add', path: [...path, key], value: next });
      else walk(before[key], next, [...path, key], out);
    }
    return;
  }
  out.push({ op: 'replace', path, value: after });
}

/**
 * Minimal patches turning `before` into `after`. Arrays and scalars are replaced wholesale.
 * Cost is proportional to the changed part when both sides share unchanged subtrees.
 */
export function diffPatches(before: unknown, after: unknown): Patch[] {
  const out: Patch[] = [];
  walk(before, after, [], out);
  return out;
}
