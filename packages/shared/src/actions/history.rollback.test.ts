import { describe, expect, it } from 'vitest';
import type { ActionEnvelope } from './envelope.js';
import {
  HistoryRollbackPayload,
  ROLLBACK_MAX_PATCHES,
  RollbackRequest,
} from './history.rollback.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix } from './testing.js';

const T = 'history.rollback';
const payload = {
  toSeq: 3,
  patches: [{ op: 'replace', path: ['name'], value: 'Before' }],
};
const envelope = (p: unknown = payload): ActionEnvelope => ({
  id: IDS.action,
  type: T,
  payload: p,
  actor: ACTORS.host,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq: 9,
  ts: 1_000,
});

describe('history.rollback', () => {
  it('accepts a client request naming only the target point', () => {
    expect(RollbackRequest.safeParse({ toSeq: 4 }).success).toBe(true);
    expect(RollbackRequest.safeParse({}).success).toBe(false);
    expect(RollbackRequest.safeParse({ toSeq: 0 }).success).toBe(false);
    expect(RollbackRequest.safeParse({ toSeq: 1.5 }).success).toBe(false);
    expect(RollbackRequest.safeParse({ toSeq: 2, patches: [] }).success).toBe(false);
  });

  it('validates the logged payload and bounds it', () => {
    expect(HistoryRollbackPayload.safeParse(payload).success).toBe(true);
    expect(
      HistoryRollbackPayload.safeParse({ ...payload, patches: [{ op: 'move', path: [] }] }).success,
    ).toBe(false);
    expect(HistoryRollbackPayload.safeParse({ ...payload, extra: 1 }).success).toBe(false);
    const many = Array.from({ length: ROLLBACK_MAX_PATCHES + 1 }, () => payload.patches[0]);
    expect(HistoryRollbackPayload.safeParse({ ...payload, patches: many }).success).toBe(false);
  });

  it('lets only the host act: not seats, a co-DM, spectators or mods', () => {
    expect(permissionMatrix(makeCampaign(), T, payload)).toEqual({
      host: true,
      owner: false,
      otherSeat: false,
      coDm: false,
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
