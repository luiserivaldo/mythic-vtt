import { Campaign } from '@mythic/shared';
import type { SocketLike } from './net/connection.js';

/** Deterministic test ULID. */
export const tid = (n: number): string =>
  '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.charAt(n % 32).repeat(26);

export function makeCampaign(name = 'Test'): Campaign {
  return Campaign.parse({
    id: tid(1),
    name,
    schemaVersion: 1,
    settings: {
      defaultBinding: 'persistent',
      instanceMode: 'linked',
      spectators: { enabled: false, view: 'players' },
    },
    seats: {},
    scenes: {},
    activeSceneId: null,
  });
}

/** In-memory socket pair half: the "server" side is driven by the test. */
export class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readonly sent: unknown[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    // Real sockets fire `close` asynchronously; tests trigger it via serverClose().
    this.closed = true;
  }
  serverOpen(): void {
    this.onopen?.({} as Event);
  }
  serverSend(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
  serverClose(): void {
    this.onclose?.({} as CloseEvent);
  }
}

/** Collects every socket the client opens, standing in for the real host. */
export function socketFactory() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    createSocket: (): FakeSocket => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    last: (): FakeSocket => {
      const s = sockets[sockets.length - 1];
      if (!s) throw new Error('no socket created');
      return s;
    },
  };
}
