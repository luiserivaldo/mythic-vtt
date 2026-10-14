import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClientStore } from '../store/store.js';
import { socketFactory, tid } from '../testing.js';
import { createSession } from './session.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const sockets = socketFactory();
  const session = createSession({
    url: 'ws://test/ws',
    identity: { identityId: tid(2), identitySecret: 'secret' },
    store: createClientStore(),
    createSocket: sockets.createSocket,
  });
  return { sockets, session };
}

// LAY-05: the board mounts behind the join screen, so a tool asks for the ephemeral stream while
// the session has no client yet. The request must survive until a socket exists, and must follow
// the session across a restart (a new client is created per profile).
describe('session ephemeral listeners', () => {
  it('delivers to a tool that subscribed before the session started', () => {
    const { sockets, session } = setup();
    const seen: unknown[] = [];
    session.onEphemeral((message) => seen.push(message.data));

    expect(sockets.sockets).toHaveLength(0);
    session.start({ displayName: 'Guest' });
    const socket = sockets.last();
    socket.serverOpen();
    socket.serverSend({ t: 'ephemeral', channel: 'draw.stroke', data: { strokeId: 'a' } });

    expect(seen).toEqual([{ strokeId: 'a' }]);
  });

  it('stops delivering on unsubscribe, before or after the socket exists', () => {
    const { sockets, session } = setup();
    const seen: unknown[] = [];
    const off = session.onEphemeral((message) => seen.push(message.data));
    off();
    session.start({ displayName: 'Guest' });
    const first = sockets.last();
    first.serverOpen();
    first.serverSend({ t: 'ephemeral', channel: 'draw.stroke', data: { strokeId: 'a' } });
    expect(seen).toEqual([]);

    const kept = session.onEphemeral((message) => seen.push(message.data));
    first.serverSend({ t: 'ephemeral', channel: 'draw.stroke', data: { strokeId: 'b' } });
    expect(seen).toEqual([{ strokeId: 'b' }]);

    // A restart replaces the client; both a dropped and a kept listener are followed.
    session.start({ displayName: 'Renamed' });
    const second = sockets.last();
    second.serverOpen();
    second.serverSend({ t: 'ephemeral', channel: 'draw.stroke', data: { strokeId: 'c' } });
    expect(seen).toEqual([{ strokeId: 'b' }, { strokeId: 'c' }]);
    kept();
    second.serverSend({ t: 'ephemeral', channel: 'draw.stroke', data: { strokeId: 'd' } });
    expect(seen).toEqual([{ strokeId: 'b' }, { strokeId: 'c' }]);
  });
});
