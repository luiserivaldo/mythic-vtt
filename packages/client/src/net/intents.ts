import type { ServerMessage } from '@mythic/protocol';

type RejectReason = Extract<ServerMessage, { t: 'reject' }>['reason'];

export type IntentFailure = RejectReason | 'connection-lost' | 'timeout' | 'queue-full';

export type IntentResult =
  { ok: true; seq: number } | { ok: false; reason: IntentFailure; detail?: string };

export interface IntentRequest {
  clientRef: string;
  type: string;
  payload: unknown;
  sceneId?: string;
}

export interface IntentQueueOptions {
  /** Transmit an intent; only called while connected. */
  send(intent: IntentRequest): void;
  /** Time to wait for an ack/reject once sent. */
  ackTimeoutMs?: number | undefined;
  /** Max intents held while disconnected. */
  maxQueued?: number | undefined;
  onChange?(pending: number): void;
}

interface Entry {
  request: IntentRequest;
  sent: boolean;
  settle(result: IntentResult): void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Intents are never applied optimistically: the store only changes on the host's patch (§4.2).
 * The queue tracks the ack/reject correlation. Policy on connection loss: intents not yet sent
 * wait and flush on reconnect; intents already sent fail with `connection-lost`, because we cannot
 * know whether the host applied them and resending could duplicate a non-idempotent action.
 */
export function createIntentQueue(options: IntentQueueOptions) {
  const ackTimeoutMs = options.ackTimeoutMs ?? 10_000;
  const maxQueued = options.maxQueued ?? 100;
  const entries = new Map<string, Entry>();
  let counter = 0;
  let connected = false;

  const notify = () => options.onChange?.(entries.size);

  function finish(clientRef: string, result: IntentResult): void {
    const entry = entries.get(clientRef);
    if (!entry) return;
    entries.delete(clientRef);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.settle(result);
    notify();
  }

  function transmit(entry: Entry): void {
    entry.sent = true;
    entry.timer = setTimeout(() => {
      finish(entry.request.clientRef, { ok: false, reason: 'timeout' });
    }, ackTimeoutMs);
    options.send(entry.request);
  }

  return {
    submit(type: string, payload: unknown, sceneId?: string): Promise<IntentResult> {
      return new Promise((resolve) => {
        const queued = [...entries.values()].filter((e) => !e.sent).length;
        if (!connected && queued >= maxQueued) {
          resolve({ ok: false, reason: 'queue-full' });
          return;
        }
        counter += 1;
        const request: IntentRequest = {
          clientRef: `c${String(counter)}`,
          type,
          payload,
          ...(sceneId !== undefined ? { sceneId } : {}),
        };
        const entry: Entry = { request, sent: false, settle: resolve };
        entries.set(request.clientRef, entry);
        notify();
        if (connected) transmit(entry);
      });
    },
    /** Call with true once the session is ready to accept intents, false when it drops. */
    setConnected(next: boolean): void {
      if (next === connected) return;
      connected = next;
      if (next) {
        for (const entry of [...entries.values()]) if (!entry.sent) transmit(entry);
      } else {
        for (const [ref, entry] of [...entries]) {
          if (entry.sent) finish(ref, { ok: false, reason: 'connection-lost' });
        }
      }
    },
    handleAck(clientRef: string, seq: number): void {
      finish(clientRef, { ok: true, seq });
    },
    handleReject(clientRef: string, reason: RejectReason, detail?: string): void {
      finish(clientRef, { ok: false, reason, ...(detail !== undefined ? { detail } : {}) });
    },
    pendingCount: () => entries.size,
  };
}

export type IntentQueue = ReturnType<typeof createIntentQueue>;
