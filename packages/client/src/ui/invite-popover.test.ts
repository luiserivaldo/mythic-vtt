// @vitest-environment happy-dom
import type { Campaign } from '@mythic/shared';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tid } from '../testing.js';
import { canInvite, INTERNET_PLAY_GUIDE_URL, inviteSeats } from './invite-popover.js';
import { InvitePopover } from './InvitePopover.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SEAT_A = tid(2);
const SEAT_B = tid(3);
const TOKEN = 'a'.repeat(43);
const NEXT = 'b'.repeat(43);

describe('invite popover rules', () => {
  it('is for the DM only', () => {
    expect(canInvite('host')).toBe(true);
    for (const role of ['codm', 'player', 'observer'] as const) expect(canInvite(role)).toBe(false);
  });

  it('lists live seats by label and skips archived ones', () => {
    const seat = (id: string, label: string, archived = false) => ({ id, label, archived });
    const campaign = {
      seats: { a: seat(SEAT_B, 'Bram'), b: seat(SEAT_A, 'Aria'), c: seat(tid(4), 'Gone', true) },
    } as unknown as Campaign;
    expect(inviteSeats(campaign)).toEqual([
      { id: SEAT_A, label: 'Aria' },
      { id: SEAT_B, label: 'Bram' },
    ]);
    expect(inviteSeats(null)).toEqual([]);
  });
});

describe('invite popover', () => {
  let container: HTMLDivElement;
  let root: Root;
  const written: string[] = [];
  let issued: string[] = [];

  beforeEach(() => {
    written.length = 0;
    issued = [TOKEN, NEXT];
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      const body =
        init.method === 'POST' ? { seatId: SEAT_A, token: issued.shift() } : { seatIds: [SEAT_B] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  const show = async (urls: { kind: 'lan' | 'public'; url: string }[]) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const seats = [
      { id: SEAT_A, label: 'Aria' },
      { id: SEAT_B, label: 'Bram' },
    ];
    await act(async () => {
      root.render(createElement(InvitePopover, { joinUrls: urls, seats }));
      await Promise.resolve();
    });
  };
  const button = (name: string, within: ParentNode = container): HTMLButtonElement => {
    const found = [...within.querySelectorAll('button')].find((b) => b.textContent === name);
    if (!found) throw new Error(`no button ${name}`);
    return found;
  };
  const click = async (target: HTMLButtonElement) => {
    await act(async () => {
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it('shows the LAN link, the guide and a disabled relay card', async () => {
    await show([{ kind: 'lan', url: 'http://192.168.1.20:8787/' }]);
    expect(container.textContent).toContain('http://192.168.1.20:8787/');
    const guide = container.querySelector('a');
    expect(guide?.getAttribute('href')).toBe(INTERNET_PLAY_GUIDE_URL);
    const relay = container.querySelector('[aria-label="Mythic Cloud relay"]');
    expect(relay?.getAttribute('aria-disabled')).toBe('true');
    expect(relay?.textContent).toContain('Coming soon');
    expect(button('Get a public link').disabled).toBe(true);

    await click(button('Copy'));
    expect(written).toEqual(['http://192.168.1.20:8787/']);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied the LAN link.');
  });

  it('copies a seat invite in the fragment and reuses it on a second copy', async () => {
    await show([{ kind: 'public', url: 'https://table.example/play' }]);
    const aria = container.querySelector('[aria-label="Seat Aria"]');
    if (!aria) throw new Error('no Aria row');
    await click(button('Copy invite for this seat', aria));
    await click(button('Copy invite for this seat', aria));
    const expected = `https://table.example/play#invite=${SEAT_A}.${TOKEN}`;
    expect(written).toEqual([expected, expected]);
    expect(container.textContent).not.toContain(TOKEN);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Copied the invite for Aria.',
    );
  });

  it('says the previous link died when it had to issue a new one', async () => {
    await show([{ kind: 'public', url: 'https://table.example/play' }]);
    const bram = container.querySelector('[aria-label="Seat Bram"]');
    if (!bram) throw new Error('no Bram row');
    await click(button('Copy invite for this seat', bram));
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'New link copied. The previous link for Bram stopped working.',
    );
  });

  it('offers no seat invites without a join link', async () => {
    await show([]);
    expect(container.textContent).toContain('No join link yet');
    expect(container.querySelector('[aria-label="Seat invites"]')).toBeNull();
  });
});
