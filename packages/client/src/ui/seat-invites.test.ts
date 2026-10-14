// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tid } from '../testing.js';
import { SeatInvites } from './SeatInvites.js';
import {
  inviteWarning,
  issueSeatInvite,
  listSeatInvites,
  revokeSeatInvite,
  seatInviteUrl,
} from './seat-invites.js';

// React only wraps state updates in act() when the test environment says so.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SEAT_A = tid(2);
const SEAT_B = tid(3);
const TOKEN = 'a'.repeat(43);
const NEXT_TOKEN = 'b'.repeat(43);
const PLAYER_URL = 'https://table.example/play';

const request = (url: string, init: RequestInit): Response =>
  new Response(JSON.stringify({ ok: true, url, method: init.method }), { status: 200 });

describe('seat invite requests', () => {
  it('puts the credential in the header of every request and never the token in a URL', async () => {
    const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(request('', {})),
    );
    fetchFn
      .mockResolvedValueOnce(new Response(JSON.stringify({ seatIds: [SEAT_A] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ seatId: SEAT_A, token: TOKEN }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ revoked: true }), { status: 200 }));
    const credential = { identityId: 'DM1', identitySecret: 'seed' };

    expect(await listSeatInvites(fetchFn, credential)).toEqual([SEAT_A]);
    expect(await issueSeatInvite(SEAT_A, fetchFn, credential)).toBe(TOKEN);
    await revokeSeatInvite(SEAT_A, fetchFn, credential);

    const call = (index: number): [string, RequestInit] => {
      const entry = fetchFn.mock.calls[index];
      if (!entry) throw new Error(`no request ${String(index)}`);
      return entry;
    };
    expect(call(0)[0]).toBe('/api/seat-invites');
    expect(call(1)[0]).toBe(`/api/seat-invites/${SEAT_A}`);
    expect(call(1)[1].method).toBe('POST');
    expect(call(2)[1].method).toBe('DELETE');
    for (const [url, init] of [call(0), call(1), call(2)]) {
      expect(url).not.toContain(TOKEN);
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Mythic DM1.seed');
    }
  });

  it('refuses a failed response or a body that is not the issued token', async () => {
    const forbidden = () => Promise.resolve(new Response('{}', { status: 403 }));
    const garbage = () => Promise.resolve(new Response(JSON.stringify({ token: 'short' })));
    for (const fetchFn of [forbidden, garbage]) {
      await expect(
        issueSeatInvite(SEAT_A, fetchFn, { identityId: 'D', identitySecret: 's' }),
      ).rejects.toThrow();
    }
    await expect(
      listSeatInvites(() => Promise.resolve(new Response('{}', { status: 500 })), {
        identityId: 'D',
        identitySecret: 's',
      }),
    ).rejects.toThrow();
    await expect(
      revokeSeatInvite(SEAT_A, garbage, { identityId: 'D', identitySecret: 's' }),
    ).rejects.toThrow();
  });

  it('keeps the seat and token in the fragment, after any hosted path', () => {
    const url = new URL(seatInviteUrl(`${PLAYER_URL}/?room=one#old`, SEAT_A, TOKEN));
    expect(url.pathname).toBe('/play/');
    expect(url.search).toBe('?room=one');
    expect(new URLSearchParams(url.hash.slice(1)).get('invite')).toBe(`${SEAT_A}.${TOKEN}`);
  });

  it('warns that the current link stops working', () => {
    expect(inviteWarning('Aria')).toBe(
      'Regenerate the invite link for Aria? The current link stops working.',
    );
  });
});

describe('seat invite controls', () => {
  let container: HTMLDivElement;
  let root: Root;
  const written: string[] = [];
  let calls: { url: string; method: string }[] = [];
  let confirmed = true;

  const stubHost = (
    handler: (url: string, method: string) => { status?: number; body: unknown },
  ): void => {
    calls = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({ url, method });
      const { status = 200, body } = handler(url, method);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    });
  };

  /** Fires a click and lets the handler's promise chain settle inside act(). */
  const settle = async (fire: () => void): Promise<void> => {
    await act(async () => {
      fire();
      await Promise.resolve();
    });
  };

  const show = async (playerUrl: string | undefined): Promise<void> => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await settle(() => {
      root.render(
        createElement(SeatInvites, {
          seats: [
            { id: SEAT_A, label: 'Aria' },
            { id: SEAT_B, label: 'Bram' },
          ],
          playerUrl,
        }),
      );
    });
  };

  const row = (label: string): HTMLElement => {
    const found = container.querySelector(`li[aria-label="Invite link for ${label}"]`);
    if (!(found instanceof HTMLElement)) throw new Error(`no invite row for ${label}`);
    return found;
  };

  const press = async (label: string, name: string): Promise<void> => {
    const button = [...row(label).querySelectorAll('button')].find(
      (candidate) => candidate.textContent === name,
    );
    if (!button) throw new Error(`no ${name} button for ${label}`);
    await settle(() => {
      button.click();
    });
  };

  const status = (): string => container.querySelector('[role="status"]')?.textContent ?? '';
  const link = (label: string): string | null =>
    row(label).querySelector('a')?.getAttribute('href') ?? null;

  beforeEach(() => {
    localStorage.setItem(
      'mythic.identity.v1',
      JSON.stringify({ identityId: 'DM1', identitySecret: 'seed' }),
    );
    written.length = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
    confirmed = true;
    // happy-dom has no window.confirm; the stubbed global is the same object as `window`.
    vi.stubGlobal('confirm', () => confirmed);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists one row per seat with copy, regenerate and revoke, and no requirement IDs', async () => {
    stubHost(() => ({ body: { seatIds: [] } }));
    await show(PLAYER_URL);
    expect(container.querySelectorAll('li[aria-label^="Invite link for "]')).toHaveLength(2);
    for (const label of ['Aria', 'Bram']) {
      expect(row(label).textContent).toContain('No link');
      for (const name of ['Copy link', 'Regenerate', 'Revoke'])
        expect([...row(label).querySelectorAll('button')].some((b) => b.textContent === name)).toBe(
          true,
        );
    }
    expect(container.textContent).not.toMatch(/M4-06|SES-04|UI-DOCK|UX-\d/);
  });

  it('issues a link when copy has none, then copies it and keeps the fragment', async () => {
    stubHost((url) =>
      url === '/api/seat-invites'
        ? { body: { seatIds: [] } }
        : { body: { seatId: SEAT_A, token: TOKEN } },
    );
    await show(PLAYER_URL);
    await press('Aria', 'Copy link');

    expect(calls).toEqual([
      { url: '/api/seat-invites', method: 'GET' },
      { url: `/api/seat-invites/${SEAT_A}`, method: 'POST' },
    ]);
    expect(written).toEqual([`${PLAYER_URL}#invite=${SEAT_A}.${TOKEN}`]);
    expect(status()).toBe('Copied the invite link for Aria.');
    expect(link('Aria')).toBe(`${PLAYER_URL}#invite=${SEAT_A}.${TOKEN}`);
    expect(row('Aria').textContent).toContain('Link active');
    // The other seat keeps its own state.
    expect(link('Bram')).toBeNull();
    expect(row('Bram').textContent).toContain('No link');
  });

  it('copies the link it already holds without issuing another one', async () => {
    stubHost((url) =>
      url === '/api/seat-invites'
        ? { body: { seatIds: [] } }
        : { body: { seatId: SEAT_A, token: TOKEN } },
    );
    await show(PLAYER_URL);
    await press('Aria', 'Copy link');
    await press('Aria', 'Copy link');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(written).toHaveLength(2);
  });

  it('says the previous link stopped working when it replaces one the host already had', async () => {
    stubHost((url) =>
      url === '/api/seat-invites'
        ? { body: { seatIds: [SEAT_A] } }
        : { body: { seatId: SEAT_A, token: NEXT_TOKEN } },
    );
    await show(PLAYER_URL);
    expect(row('Aria').textContent).toContain('Link active');
    await press('Aria', 'Copy link');
    expect(status()).toBe('New link ready. The previous link for Aria stopped working.');
    expect(written).toEqual([`${PLAYER_URL}#invite=${SEAT_A}.${NEXT_TOKEN}`]);
  });

  it('regenerates only after the warning is accepted, and replaces the link', async () => {
    let issued = 0;
    stubHost((url) => {
      if (url === '/api/seat-invites') return { body: { seatIds: [] } };
      issued += 1;
      return { body: { seatId: SEAT_A, token: issued === 1 ? TOKEN : NEXT_TOKEN } };
    });
    await show(PLAYER_URL);
    await press('Aria', 'Copy link');
    confirmed = false;
    await press('Aria', 'Regenerate');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(link('Aria')).toBe(`${PLAYER_URL}#invite=${SEAT_A}.${TOKEN}`);

    confirmed = true;
    await press('Aria', 'Regenerate');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    expect(link('Aria')).toBe(`${PLAYER_URL}#invite=${SEAT_A}.${NEXT_TOKEN}`);
    expect(status()).toBe('New link ready. The previous link for Aria stopped working.');
  });

  it('revokes and leaves the row with no link', async () => {
    stubHost((url, method) =>
      url === '/api/seat-invites'
        ? { body: { seatIds: [] } }
        : method === 'DELETE'
          ? { body: { revoked: true } }
          : { body: { seatId: SEAT_A, token: TOKEN } },
    );
    await show(PLAYER_URL);
    await press('Aria', 'Copy link');
    await press('Aria', 'Revoke');
    expect(calls[2]).toEqual({ url: `/api/seat-invites/${SEAT_A}`, method: 'DELETE' });
    expect(link('Aria')).toBeNull();
    expect(row('Aria').textContent).toContain('No link');
    expect(status()).toBe('Invite link revoked.');
  });

  it('reports a refused request and leaves the row alone', async () => {
    stubHost((url) =>
      url === '/api/seat-invites'
        ? { body: { seatIds: [] } }
        : { status: 403, body: { error: 'forbidden' } },
    );
    await show(PLAYER_URL);
    await press('Aria', 'Copy link');
    expect(status()).toBe('Could not copy the invite link.');
    expect(written).toEqual([]);
    expect(link('Aria')).toBeNull();
    expect(row('Aria').textContent).toContain('No link');
  });

  it('offers nothing to invite with when the host reports no join URL', async () => {
    stubHost(() => ({ body: { seatIds: [] } }));
    await show(undefined);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent).toContain('No player join URL is available');
  });
});
