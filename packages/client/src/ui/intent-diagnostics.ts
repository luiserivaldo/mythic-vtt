import type { IntentResult } from '../net/intents.js';

export interface IntentDiagnostic {
  id: number;
  type: string;
  payload: string;
  outcome: 'ack' | 'reject';
  reason?: string;
  latencyMs: number;
}

const SENSITIVE_KEY = /(secret|token|password|authorization|credential)/i;

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, seen),
    ]),
  );
}

/** A bounded, redacted payload description for the developer overlay. */
export function summarizePayload(payload: unknown, maxLength = 96): string {
  let summary: string;
  try {
    summary = JSON.stringify(redact(payload, new WeakSet()));
  } catch {
    summary = '[unavailable]';
  }
  return summary.length <= maxLength ? summary : `${summary.slice(0, maxLength - 1)}…`;
}

export function diagnosticOutcome(
  result: IntentResult,
): Pick<IntentDiagnostic, 'outcome' | 'reason'> {
  return result.ok
    ? { outcome: 'ack' }
    : {
        outcome: 'reject',
        reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
      };
}

export function appendDiagnostic(
  diagnostics: readonly IntentDiagnostic[],
  diagnostic: IntentDiagnostic,
  limit = 20,
): IntentDiagnostic[] {
  return [...diagnostics, diagnostic].slice(-limit);
}
