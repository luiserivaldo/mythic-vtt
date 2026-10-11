import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { Campaign, CHAT_HISTORY_LIMIT, ChatPost, type ChatAudience } from '../schema/index.js';
import { patchesFor } from '../visibility/patches-for.js';
import { visibleTo } from '../visibility/visible-to.js';
import { reduceAction } from './run.js';
import { ACTORS, IDS, makeCampaign, permissionMatrix, testId } from './testing.js';
import type { ActionEnvelope } from './envelope.js';

const envelope = (audience: ChatAudience, seq = 1): ActionEnvelope => ({
  id: testId(seq + 10),
  type: 'chat.post',
  payload: { audience, text: 'private-message' },
  actor: ACTORS.owner,
  campaignId: IDS.campaign,
  sessionId: IDS.session,
  seq,
  ts: 123,
});

describe('chat.post (ACT-01 / PERM-03)', () => {
  it('validates bounded text and exact destination without client-authored metadata', () => {
    expect(ChatPost.parse({ audience: { kind: 'public' }, text: ' hi ' }).text).toBe('hi');
    for (const payload of [
      {},
      { audience: { kind: 'whisper' }, text: 'hi' },
      { audience: { kind: 'public' }, text: '  ' },
      { audience: { kind: 'public' }, text: 'x'.repeat(4001) },
      { audience: { kind: 'public' }, text: 'hi', author: { kind: 'host' } },
      { audience: { kind: 'dm', seatId: IDS.other }, text: 'hi' },
    ])
      expect(ChatPost.safeParse(payload).success).toBe(false);
  });
  it('allows seated senders and rejects unknown destinations, spectators and mods', () => {
    const state = makeCampaign();
    expect(
      permissionMatrix(state, 'chat.post', { audience: { kind: 'public' }, text: 'hi' }),
    ).toEqual({
      host: true,
      owner: true,
      otherSeat: true,
      coDm: true,
      spectator: false,
      mod: false,
    });
    expect(
      Object.values(
        permissionMatrix(state, 'chat.post', {
          audience: { kind: 'whisper', seatId: testId(31) },
          text: 'hi',
        }),
      ),
    ).not.toContain(true);
    const seat = state.seats[IDS.owner];
    if (!seat) throw new Error('missing seat');
    seat.permissions = { ...seat.permissions, view: false };
    expect(
      permissionMatrix(state, 'chat.post', { audience: { kind: 'dm' }, text: 'hi' }).owner,
    ).toBe(false);
  });
  it.each([
    [{ kind: 'public' }, true, true, true],
    [{ kind: 'whisper', seatId: IDS.other }, true, false, false],
    [{ kind: 'dm' }, false, true, false],
  ] as const)('filters snapshots and patches for %j', (audience, other, coDm, spectator) => {
    const before = makeCampaign();
    const a = envelope(audience);
    const result = reduceAction(before, a);
    expect(reduceAction(before, a)).toEqual(result);
    expect(Campaign.parse(result.state).chat?.[0]).toMatchObject({
      id: a.id,
      sessionId: a.sessionId,
      seq: a.seq,
      ts: a.ts,
      author: { kind: 'seat', seatId: IDS.owner, label: 'Owner' },
    });
    for (const [viewer, allowed] of [
      [{ kind: 'host' }, true],
      [{ kind: 'seat', seatId: IDS.owner }, true],
      [{ kind: 'seat', seatId: IDS.other }, other],
      [{ kind: 'seat', seatId: IDS.coDm }, coDm],
      [{ kind: 'spectators' }, spectator],
    ] as const) {
      const patches = patchesFor(viewer, before, result.state, result.patches);
      expect(JSON.stringify(patches).includes('private-message')).toBe(allowed);
      expect(applyPatches(visibleTo(viewer, before), patches)).toEqual(
        visibleTo(viewer, result.state),
      );
      expect(JSON.stringify(visibleTo(viewer, result.state)).includes('private-message')).toBe(
        allowed,
      );
    }
  });
  it('bounds scrollback without leaking private entries when public messages shift', () => {
    let state = makeCampaign();
    for (let seq = 1; seq <= CHAT_HISTORY_LIMIT; seq++)
      state = reduceAction(state, envelope({ kind: 'dm' }, seq)).state;
    const next = reduceAction(state, envelope({ kind: 'public' }, CHAT_HISTORY_LIMIT + 1));
    expect(next.state.chat).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(next.state.chat?.[0]?.seq).toBe(2);
    const viewer = { kind: 'spectators' } as const;
    const patches = patchesFor(viewer, state, next.state, next.patches);
    expect(applyPatches(visibleTo(viewer, state), patches)).toEqual(visibleTo(viewer, next.state));
    expect(visibleTo(viewer, next.state).chat).toHaveLength(1);
  });
});
