import type { ClientMessage, ServerMessage } from '@mythic/protocol';

type Of<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>;

/** A live, authenticated connection as the engine sees it. */
export interface GatewayConnection {
  readonly connectionId: string;
  readonly identityId: string;
  readonly displayName: string;
  readonly avatar: string | undefined;
  /** D24: true when this identity is the host's bound identity (bound via the one-time host token). */
  readonly isHost: boolean;
  /** Last `seq` the client reported in `hello`, for replay or snapshot (TECHNICAL.md §7.1). */
  readonly lastSeq: number | undefined;
  /** Validated and encoded by the gateway; a no-op once the socket is closed. */
  send(message: ServerMessage): void;
  /** Pre-serialized frame, for spectator fan-out (§7.4). */
  sendRaw(frame: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * What the engine (M0-10) implements. The gateway only authenticates and validates the frame
 * shape; payload validation, permissions, seq assignment and filtering are the engine's job.
 * Handlers may be async; a thrown error is reported as a non-fatal `server-error`.
 */
export interface GatewayHandler {
  /** Called once after a successful `hello`. */
  onConnect(conn: GatewayConnection): void | Promise<void>;
  onJoin(conn: GatewayConnection, msg: Of<'join'>): void | Promise<void>;
  onIntent(conn: GatewayConnection, msg: Of<'intent'>): void | Promise<void>;
  onEphemeral(conn: GatewayConnection, msg: Of<'ephemeral'>): void | Promise<void>;
  onDisconnect(conn: GatewayConnection): void;
}

/** Placeholder until the engine exists: every intent is refused rather than silently dropped. */
export const noopHandler: GatewayHandler = {
  onConnect: () => undefined,
  onJoin: () => undefined,
  onIntent(conn, msg) {
    conn.send({
      t: 'reject',
      clientRef: msg.clientRef,
      reason: 'forbidden',
      detail: 'no engine attached',
    });
  },
  onEphemeral: () => undefined,
  onDisconnect: () => undefined,
};
