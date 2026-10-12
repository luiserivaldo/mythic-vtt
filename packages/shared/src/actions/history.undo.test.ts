import { describe, expect, it } from 'vitest';
import type { ActionEnvelope } from './envelope.js';
import { HistoryUndoPayload, UndoRequest } from './history.undo.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix } from './testing.js';

const T = 'history.undo';
const payload = {
  targetSeqs: [3],
  patches: [{ op: 'replace', path: ['name'], value: 'Before' }],
};
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 4,
  ts: 1_000,
});

describe('history.undo', () => {
  it('accepts a client request with or without targets and nothing else', () => {
    expect(UndoRequest.safeParse({}).success).toBe(true);
    expect(UndoRequest.safeParse({ targetSeqs: [1, 2] }).success).toBe(true);
    expect(UndoRequest.safeParse({ targetSeqs: [] }).success).toBe(false);
    expect(UndoRequest.safeParse({ targetSeqs: [0] }).success).toBe(false);
    expect(
      UndoRequest.safeParse({ targetSeqs: Array.from({ length: 51 }, (_, i) => i + 1) }).success,
    ).toBe(false);
    expect(UndoRequest.safeParse({ targetSeqs: [1], patches: [] }).success).toBe(false);
  });

  it('validates the logged payload', () => {
    expect(HistoryUndoPayload.safeParse(payload).success).toBe(true);
    expect(
      HistoryUndoPayload.safeParse({ ...payload, patches: [{ op: 'move', path: [] }] }).success,
    ).toBe(false);
    expect(HistoryUndoPayload.safeParse({ ...payload, extra: 1 }).success).toBe(false);
  });

  it('lets the host and seats act, and denies spectators and mods', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: true,
      otherSeat: true,
      coDm: true,
      spectator: false,
      mod: false,
    });
  });

  it('applies the patches and records its own inverse', () => {
    const state = { ...makeCampaign(), name: 'After' };
    const result = reduceAction(state, envelope());
    expect(result.state.name).toBe('Before');
    expect(result.inversePatches).toEqual([{ op: 'replace', path: ['name'], value: 'After' }]);
    expect(state.name).toBe('After');
  });

  it('is deterministic', () => {
    const state = { ...makeCampaign(), name: 'After' };
    const a = reduceAction(state, envelope());
    const b = reduceAction(state, envelope());
    expect(b.state).toEqual(a.state);
    expect(b.patches).toEqual(a.patches);
  });
});
