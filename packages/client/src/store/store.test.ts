import { describe, expect, it } from 'vitest';
import { makeCampaign, tid } from '../testing.js';
import { applyPatchMessage } from './patches.js';
import { createClientStore } from './store.js';

const snapshot = (seq: number, name = 'Test') => ({
  t: 'snapshot' as const,
  seq,
  state: makeCampaign(name),
  seatId: tid(9),
});
const rename = (seq: number, name: string) => ({
  t: 'patch' as const,
  seq,
  patches: [{ op: 'replace' as const, path: ['name'], value: name }],
});

describe('applyPatchMessage', () => {
  const c = makeCampaign();
  it('applies the next seq without mutating the input', () => {
    const out = applyPatchMessage(c, 1, 2, [{ op: 'replace', path: ['name'], value: 'New' }]);
    expect(out.kind).toBe('applied');
    if (out.kind === 'applied') expect(out.campaign.name).toBe('New');
    expect(c.name).toBe('Test');
  });
  it('ignores stale, flags gaps and bad paths', () => {
    expect(applyPatchMessage(c, 5, 5, []).kind).toBe('stale');
    expect(applyPatchMessage(c, 5, 7, []).kind).toBe('gap');
    expect(
      applyPatchMessage(c, 1, 2, [{ op: 'replace', path: ['seats', 'x', 'label'], value: 'a' }])
        .kind,
    ).toBe('invalid');
  });
});

describe('client store', () => {
  it('applies snapshot then patches', () => {
    const s = createClientStore();
    expect(s.getState().applyServerMessage(snapshot(3))).toBe('ok');
    expect(s.getState()).toMatchObject({ ready: true, seq: 3, seatId: tid(9) });
    expect(s.getState().applyServerMessage(rename(4, 'Renamed'))).toBe('ok');
    expect(s.getState().campaign?.name).toBe('Renamed');
    expect(s.getState().seq).toBe(4);
  });

  it('requests resync on a gap, a patch before any snapshot, or an invalid snapshot', () => {
    const s = createClientStore();
    expect(s.getState().applyServerMessage(rename(1, 'x'))).toBe('resync');
    s.getState().applyServerMessage(snapshot(3));
    expect(s.getState().applyServerMessage(rename(9, 'x'))).toBe('resync');
    expect(s.getState().seq).toBe(3);
    expect(
      s.getState().applyServerMessage({ t: 'snapshot', seq: 1, state: { nope: 1 }, seatId: null }),
    ).toBe('resync');
    expect(s.getState().seq).toBe(3);
  });

  it('ignores replayed patches', () => {
    const s = createClientStore();
    s.getState().applyServerMessage(snapshot(3));
    expect(s.getState().applyServerMessage(rename(3, 'Old'))).toBe('ok');
    expect(s.getState().campaign?.name).toBe('Test');
  });

  it('keeps the campaign but clears ready when the connection drops', () => {
    const s = createClientStore();
    s.getState().applyServerMessage(snapshot(1));
    s.getState().setConnection('waiting');
    expect(s.getState().ready).toBe(false);
    expect(s.getState().campaign).not.toBeNull();
  });

  it('records presence, notices and fatal errors', () => {
    const s = createClientStore();
    s.getState().applyServerMessage({
      t: 'presence',
      seats: [],
      spectators: 2,
      joinUrls: [{ kind: 'public', url: 'https://table.example/play' }],
    });
    s.getState().applyServerMessage({ t: 'notice', level: 'info', code: 'q', message: 'hi' });
    s.getState().applyServerMessage({
      t: 'error',
      code: 'unauthorized',
      message: 'bad',
      fatal: true,
    });
    expect(s.getState().presence?.spectators).toBe(2);
    expect(s.getState().presence?.joinUrls).toEqual([
      { kind: 'public', url: 'https://table.example/play' },
    ]);
    expect(s.getState().notices).toHaveLength(1);
    expect(s.getState().fatalError).toContain('unauthorized');
    s.getState().dismissNotice(0);
    expect(s.getState().notices).toHaveLength(0);
  });
});
