import { mkdir } from 'node:fs/promises';
import type { HostConfig } from './config.js';
import {
  createGateway,
  generateHostToken,
  loadOrCreateHostSecret,
  noopHandler,
  type Gateway,
} from './gateway/index.js';

export interface RunningHost {
  readonly gateway: Gateway;
  readonly port: number;
  /** D24: one-time host token (memory only). Callers may print it only in the DM link fragment. */
  readonly hostToken: string;
  close(): Promise<void>;
}

/**
 * Minimal host entry point: gateway only, with the no-op handler until the engine (M0-10) lands.
 * The host secret is created on first run (TECHNICAL.md §7.2) and is never logged.
 */
export async function startHost(
  config: HostConfig,
  options: { hostToken?: string } = {},
): Promise<RunningHost> {
  await mkdir(config.dataDir, { recursive: true });
  await loadOrCreateHostSecret(config.hostSecretPath);

  // Counts connections that completed `hello`, so tests can tell "socket open" from "authenticated".
  let authenticated = 0;
  const hostToken = options.hostToken ?? generateHostToken();
  const gateway = createGateway({
    hostToken,
    handler: {
      ...noopHandler,
      onConnect: () => {
        authenticated += 1;
      },
      onDisconnect: () => {
        authenticated -= 1;
      },
    },
  });
  if (config.testEndpoints) {
    gateway.app.get('/__test/connections', () => ({
      open: gateway.connectionCount(),
      authenticated,
    }));
  }
  const port = await gateway.listen({ port: config.port, host: config.host });
  return { gateway, port, hostToken, close: () => gateway.close() };
}
