import { mkdir } from 'node:fs/promises';
import type { HostConfig } from './config.js';
import {
  createGateway,
  loadOrCreateHostSecret,
  noopHandler,
  type Gateway,
} from './gateway/index.js';

export interface RunningHost {
  readonly gateway: Gateway;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Minimal host entry point: gateway only, with the no-op handler until the engine (M0-10) lands.
 * The host secret is created on first run (TECHNICAL.md §7.2) and is never logged.
 */
export async function startHost(config: HostConfig): Promise<RunningHost> {
  await mkdir(config.dataDir, { recursive: true });
  await loadOrCreateHostSecret(config.hostSecretPath);

  // Counts connections that completed `hello`, so tests can tell "socket open" from "authenticated".
  let authenticated = 0;
  const gateway = createGateway({
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
  return { gateway, port, close: () => gateway.close() };
}
