import { mkdir } from 'node:fs/promises';
import type { HostConfig } from './config.js';
import { denyAssetUploads, registerAssetRoutes, type UploadAuthorizer } from './http/index.js';
import {
  createGateway,
  loadOrCreateHostSecret,
  noopHandler,
  type Gateway,
} from './gateway/index.js';
import { LocalAssetStore } from './storage/index.js';

export interface RunningHost {
  readonly gateway: Gateway;
  readonly port: number;
  close(): Promise<void>;
}

export interface StartHostOptions {
  uploadAuthorizer?: UploadAuthorizer;
}

/**
 * Host entry point with a no-op gateway handler until the engine (M0-10) lands.
 * The host secret is created on first run (TECHNICAL.md §7.2) and is never logged.
 */
export async function startHost(
  config: HostConfig,
  options: StartHostOptions = {},
): Promise<RunningHost> {
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
  const assetStore = new LocalAssetStore(config.dataDir);
  registerAssetRoutes(gateway.app, {
    assetStore,
    uploadAuthorizer: options.uploadAuthorizer ?? denyAssetUploads,
    maxUploadBytes: config.maxImageUploadBytes,
  });
  if (config.testEndpoints) {
    gateway.app.get('/__test/connections', () => ({
      open: gateway.connectionCount(),
      authenticated,
    }));
  }
  const port = await gateway.listen({ port: config.port, host: config.host });
  return {
    gateway,
    port,
    close: async () => {
      try {
        await gateway.close();
      } finally {
        assetStore.close();
      }
    },
  };
}
