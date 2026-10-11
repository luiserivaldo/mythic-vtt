import { enablePatches, produceWithPatches, type Patch } from 'immer';
import type { Campaign } from '../schema/index.js';
import { isHost, isCoDm, type AnyAction } from './define.js';
import type { Actor, ActionEnvelope } from './envelope.js';
import { getAction } from './registry.js';

enablePatches();

export type RejectReason = 'unknown-action' | 'invalid-payload' | 'forbidden';

export type CheckResult =
  | { ok: true; action: AnyAction; payload: unknown }
  | { ok: false; reason: RejectReason; detail?: string };

/** Pipeline steps 2-3: schema, then permission. Mods need `modExposed`. */
export function checkIntent(
  state: Campaign,
  actor: Actor,
  type: string,
  payload: unknown,
): CheckResult {
  const action = getAction(type);
  if (!action) return { ok: false, reason: 'unknown-action' };
  const parsed = action.schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid-payload', detail: parsed.error.message };
  }
  if (actor.kind === 'mod' && !action.modExposed) return { ok: false, reason: 'forbidden' };
  const data: unknown = parsed.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'sceneId' in data &&
    typeof data.sceneId === 'string' &&
    state.scenes[data.sceneId]?.dmOnly &&
    !isHost(actor) &&
    !isCoDm(state, actor)
  )
    return { ok: false, reason: 'forbidden' };
  if (!action.permission(state, actor, parsed.data)) return { ok: false, reason: 'forbidden' };
  return { ok: true, action, payload: parsed.data };
}

export function canPerform(state: Campaign, actor: Actor, type: string, payload: unknown): boolean {
  return checkIntent(state, actor, type, payload).ok;
}

export interface ReduceResult {
  state: Campaign;
  patches: Patch[];
  inversePatches: Patch[];
}

/** Pipeline step 5. Assumes `checkIntent` already passed; re-validates the payload defensively. */
export function reduceAction(state: Campaign, envelope: ActionEnvelope): ReduceResult {
  const action = getAction(envelope.type);
  if (!action) throw new Error(`unknown action: ${envelope.type}`);
  const payload: unknown = action.schema.parse(envelope.payload);
  const [next, patches, inversePatches] = produceWithPatches(state, (draft) => {
    action.reduce(draft, { ...envelope, payload });
  });
  return { state: next, patches, inversePatches };
}
