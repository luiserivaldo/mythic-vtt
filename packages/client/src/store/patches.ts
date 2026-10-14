import { applyPatches, enablePatches, type Patch } from 'immer';
import type { WirePatch } from '@mythic/protocol';
import { Campaign } from '@mythic/shared';

enablePatches();

/** Validate the host's filtered snapshot with the shared schema (never trust the wire). */
export function parseSnapshot(state: unknown): Campaign | undefined {
  const parsed = Campaign.safeParse(state);
  return parsed.success ? parsed.data : undefined;
}

export type PatchOutcome =
  | { kind: 'applied'; campaign: Campaign; seq: number }
  /** Already seen (replay overlap); ignore. */
  | { kind: 'stale' }
  /** Missed one or more patches: the caller must resync (reconnect with `lastSeq`). */
  | { kind: 'gap' }
  /** Patch did not apply cleanly to our state: resync. */
  | { kind: 'invalid' };

/** Apply one `patch` message. Patches are strictly sequential: seq must be lastSeq + 1. */
export function applyPatchMessage(
  campaign: Campaign,
  lastSeq: number,
  seq: number,
  patches: readonly WirePatch[],
): PatchOutcome {
  if (seq <= lastSeq) return { kind: 'stale' };
  if (seq !== lastSeq + 1) return { kind: 'gap' };
  try {
    const next = applyPatches(campaign, patches as Patch[]);
    return { kind: 'applied', campaign: next, seq };
  } catch {
    return { kind: 'invalid' };
  }
}
