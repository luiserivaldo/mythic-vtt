import { describe, expect, it } from 'vitest';
import { appendDiagnostic, diagnosticOutcome, summarizePayload } from './intent-diagnostics.js';

describe('intent diagnostics', () => {
  it('summarises payloads without identity secrets or tokens', () => {
    const summary = summarizePayload({
      entityId: '01ENTITY',
      identitySecret: 'do-not-show',
      nested: { hostToken: 'also-private' },
    });
    expect(summary).toContain('01ENTITY');
    expect(summary).not.toContain('do-not-show');
    expect(summary).not.toContain('also-private');
    expect(summary).toContain('[redacted]');
  });

  it('bounds long summaries and recent history', () => {
    expect(summarizePayload({ name: 'x'.repeat(100) }, 20)).toHaveLength(20);
    const base = Array.from({ length: 20 }, (_, id) => ({
      id,
      type: 'test',
      payload: '{}',
      outcome: 'ack' as const,
      latencyMs: 1,
    }));
    expect(appendDiagnostic(base, { ...base[0]!, id: 20 }).map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it('labels acknowledgements and rejection details', () => {
    expect(diagnosticOutcome({ ok: true, seq: 4 })).toEqual({ outcome: 'ack' });
    expect(diagnosticOutcome({ ok: false, reason: 'forbidden', detail: 'host only' })).toEqual({
      outcome: 'reject',
      reason: 'forbidden: host only',
    });
  });
});
