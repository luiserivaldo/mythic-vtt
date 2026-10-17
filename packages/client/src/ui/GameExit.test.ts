// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientStoreContext } from '../store/react.js';
import { createClientStore } from '../store/store.js';
import { GameExitButton, GameExitScreen, gameExitStore } from './GameExit.js';
import { JoinContext, type JoinEnv } from './join-context.js';
import type { Session } from './session.js';
import { SubmitContext, type SubmitIntent } from './submit.js';

// UX-05b (MV-273): the host DM ends the game (red, capture then stop); everyone else leaves it.

let container: HTMLDivElement;
let root: Root;
const profile = { displayName: 'Ada' };

function fakeSession() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    started: () => true,
    currentProfile: () => profile,
    subscribe: () => () => undefined,
    join: vi.fn(),
    submitIntent: vi.fn<SubmitIntent>(() => Promise.resolve({ ok: true, seq: 1 })),
    sendEphemeral: vi.fn(),
    onEphemeral: () => () => undefined,
  } satisfies Session;
}

function show(realIsHost: boolean, reload = vi.fn()) {
  const store = createClientStore();
  store.setState({ realIsHost, ready: true });
  const session = fakeSession();
  const env: JoinEnv = {
    session,
    storage: { getItem: () => null, setItem: () => undefined },
    identityId: 'viewer',
    hostVisitor: realIsHost,
    initialProfile: null,
  };
  act(() => {
    root.render(
      createElement(
        ClientStoreContext.Provider,
        { value: store },
        createElement(
          JoinContext.Provider,
          { value: env },
          createElement(
            SubmitContext.Provider,
            { value: session.submitIntent },
            createElement(GameExitButton),
            createElement(GameExitScreen, { reload }),
          ),
        ),
      ),
    );
  });
  return { session, reload };
}

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const dialog = () => container.querySelector('[role="dialog"]');

async function click(name: string) {
  const found = button(name);
  if (!found) throw new Error(`no ${name} button`);
  await act(async () => {
    found.click();
    await Promise.resolve();
  });
}

describe('End Game / Leave Game (UX-05b)', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    gameExitStore.setState({ exited: null });
  });
  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('gives the host DM a red End Game and no way to sign out or leave', () => {
    show(true);
    expect(button('End Game')?.className).toContain('ui-danger-button');
    expect(button('Leave Game')).toBeUndefined();
    expect(container.textContent).not.toMatch(/sign out/i);
  });

  it('ends the game for the DM: the session stops and they can sign back in', async () => {
    const { session } = show(true);
    // No board canvas here, so nothing is captured; the session still stops.
    await click('End Game');
    await vi.waitFor(() => {
      expect(session.stop).toHaveBeenCalledTimes(1);
    });
    expect(dialog()?.getAttribute('aria-label')).toBe('Game ended');
    await click('Sign back in');
    expect(session.start).toHaveBeenCalledWith(profile);
    expect(dialog()).toBeNull();
  });

  it('gives everyone else Leave Game, which stops the session and offers to rejoin', async () => {
    const { session, reload } = show(false);
    expect(button('End Game')).toBeUndefined();
    await click('Leave Game');
    expect(session.stop).toHaveBeenCalledTimes(1);
    expect(dialog()?.getAttribute('aria-label')).toBe('Left the game');
    await click('Rejoin');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.start).not.toHaveBeenCalled();
  });
});
