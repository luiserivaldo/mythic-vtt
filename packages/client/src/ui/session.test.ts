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
    spectatorIdentity: () => ({ identityId: tid(3), identitySecret: 'watcher' }),
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

// MV-270: watching never presents the visitor's own identity, which the host would put back in
// any seat it holds.
describe('session identities', () => {
  it('says hello as the visitor, or as the spectator identity when watching', () => {
    const { sockets, session } = setup();
    session.start({ displayName: 'Ana' });
    sockets.last().serverOpen();
    expect(sockets.last().sent[0]).toMatchObject({ t: 'hello', identityId: tid(2) });
    session.start({ displayName: 'Spectator' }, { spectator: true });
    sockets.last().serverOpen();
    expect(sockets.last().sent[0]).toMatchObject({ t: 'hello', identityId: tid(3) });
    expect(JSON.stringify(sockets.last().sent)).not.toContain(tid(2));
  });

  // D46 / MV-280: the spectator intent rides on hello, so the host never lists it as unseated.
  it('declares as=spectator on hello only when watching', () => {
    const { sockets, session } = setup();
    session.start({ displayName: 'Ana' });
    sockets.last().serverOpen();
    expect(sockets.last().sent[0]).not.toHaveProperty('as');
    session.start({ displayName: 'Spectator' }, { spectator: true });
    sockets.last().serverOpen();
    expect(sockets.last().sent[0]).toMatchObject({ t: 'hello', as: 'spectator' });
    expect(sockets.last().sent.filter((m) => (m as { t: string }).t === 'join')).toEqual([]);
  });

  it('never sends a host token alongside as=spectator', () => {
    const sockets = socketFactory();
    const take = vi.fn(() => 'host-token');
    const session = createSession({
      url: 'ws://test/ws',
      identity: { identityId: tid(2), identitySecret: 'secret' },
      spectatorIdentity: () => ({ identityId: tid(3), identitySecret: 'watcher' }),
      hostToken: { take, confirm: () => undefined },
      store: createClientStore(),
      createSocket: sockets.createSocket,
    });
    session.start({ displayName: 'Spectator' }, { spectator: true });
    sockets.last().serverOpen();
    expect(sockets.last().sent[0]).toMatchObject({ as: 'spectator' });
    expect(sockets.last().sent[0]).not.toHaveProperty('hostToken');
    expect(take).not.toHaveBeenCalled();
  });
});
