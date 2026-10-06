import { createContext, useCallback, useContext, useState } from 'react';
import type { IntentResult } from '../net/intents.js';
import type { IntentSpec } from './intent-specs.js';

export type SubmitIntent = (
  type: string,
  payload: unknown,
  sceneId?: string,
) => Promise<IntentResult>;

export const SubmitContext = createContext<SubmitIntent | null>(null);

export function describeFailure(result: Extract<IntentResult, { ok: false }>): string {
  const detail = result.detail ? `: ${result.detail}` : '';
  return `The host did not accept that (${result.reason}${detail}).`;
}

export type SendIntent = (spec: IntentSpec) => Promise<boolean>;

/** Sends an intent and reports only the outcome; the visible state changes when the patch lands. */
export function useSubmit(): {
  send: (spec: IntentSpec) => Promise<boolean>;
  error: string | null;
} {
  const submit = useContext(SubmitContext);
  const [error, setError] = useState<string | null>(null);
  const send = useCallback(
    async (spec: IntentSpec): Promise<boolean> => {
      if (!submit) throw new Error('useSubmit outside SubmitContext.Provider');
      const result = await submit(spec.type, spec.payload, spec.sceneId);
      setError(result.ok ? null : describeFailure(result));
      return result.ok;
    },
    [submit],
  );
  return { send, error };
}
