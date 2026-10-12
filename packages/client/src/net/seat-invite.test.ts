import { describe, expect, it, vi } from 'vitest';
import { extractSeatInvite, redeemSeatInvite, seatInviteMessage } from './seat-invite.js';

const SEAT = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
const TOKEN = 'a'.repeat(43);

describe('seat invite link', () => {
  it('reads the fragment once and scrubs it, keeping other params', () => {
    const replaceState = vi.fn();
    const invite = extractSeatInvite(
      { pathname: '/', search: '', hash: `#invite=${SEAT}.${TOKEN}&x=1` },
      { replaceState },
    );
    expect(invite).toEqual({ seatId: SEAT, token: TOKEN });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#x=1');
  });

  it('scrubs but rejects malformed values and ignores links without an invite', () => {
    const replaceState = vi.fn();
    expect(
      extractSeatInvite({ pathname: '/', search: '', hash: '#invite=nope' }, { replaceState }),
    ).toBeUndefined();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    const untouched = vi.fn();
    expect(
      extractSeatInvite({ pathname: '/', search: '', hash: '' }, { replaceState: untouched }),
    ).toBeUndefined();
    expect(untouched).not.toHaveBeenCalled();
  });

  it('sends the credential in the header and the token only in the body', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    const result = await redeemSeatInvite(
      { identityId: 'ID1', identitySecret: 'sec' },
      { seatId: SEAT, token: TOKEN },
      fetchFn,
    );
    expect(result).toBe('seated');
    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('/api/seat-invites/redeem');
    expect(call[0]).not.toContain(TOKEN);
    expect((call[1].headers as Record<string, string>)['Authorization']).toBe('Mythic ID1.sec');
    expect(call[1].body).toContain(TOKEN);
  });

  it.each([
    [404, 'invalid'],
    [409, 'taken'],
    [500, 'error'],
  ] as const)('maps %i to %s', async (status, expected) => {
    const fetchFn = () => Promise.resolve(new Response('{}', { status }));
    const result = await redeemSeatInvite(
      { identityId: 'ID1', identitySecret: 's' },
      { seatId: SEAT, token: TOKEN },
      fetchFn,
    );
    expect(result).toBe(expected);
    expect(seatInviteMessage(result)).toBeTruthy();
  });

  it('maps a network failure to error', async () => {
    const fetchFn = () => Promise.reject(new Error('offline'));
    expect(
      await redeemSeatInvite(
        { identityId: 'ID1', identitySecret: 's' },
        { seatId: SEAT, token: TOKEN },
        fetchFn as unknown as typeof fetch,
      ),
    ).toBe('error');
  });
});
