import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { storeMigrate } from '@mythic/shared';
import type { HostConfig } from './config.js';
import { denyAssetUploads, registerAssetRoutes, type UploadAuthorizer } from './http/index.js';
import {
  createEngine,
  cryptoRandom,
  loadOrCreateCampaign,
  systemClock,
  ulid,
  type Clock,
  type Engine,
  type RandomSource,
} from './engine/index.js';
import {
  createGateway,
  createSqliteIdentityStore,
  generateHostToken,
  loadOrCreateHostSecret,
  type Gateway,
} from './gateway/index.js';
import { LocalAssetStore, LocalCampaignStore } from './storage/index.js';

export interface RunningHost {
  readonly gateway: Gateway;
  readonly engine: Engine;
  readonly port: number;
  /** D24: one-time host token (memory only). Callers may print it only in the DM link fragment. */
  readonly hostToken: string;
  close(): Promise<void>;
}

export interface StartHostOptions {
  /** Defaults to denying every upload until a seat-authenticated authorizer is wired. */
  uploadAuthorizer?: UploadAuthorizer;
  hostToken?: string;
  clock?: Clock;
  random?: RandomSource;
}

/**
 * Game host: gateway + engine room for one campaign, persisted in `config.dataDir` (§8.2).
 * The host secret is created on first run (TECHNICAL.md §7.2) and is never logged.
 */
export async function startHost(
  config: HostConfig,
  options: StartHostOptions = {},
): Promise<RunningHost> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  await mkdir(config.dataDir, { recursive: true });
  await loadOrCreateHostSecret(config.hostSecretPath);

  const assetStore = new LocalAssetStore(config.dataDir);
  const store = new LocalCampaignStore(config.dataDir, storeMigrate, assetStore);
  const identities = createSqliteIdentityStore(join(config.dataDir, 'index.sqlite'));
  const closeStores = async () => {
    assetStore.close();
    identities.close();
    await store.close();
  };

  let engine: Engine;
  try {
    const campaign = await loadOrCreateCampaign(store, {
      clock,
      random,
      ...(config.campaignId !== undefined ? { campaignId: config.campaignId } : {}),
    });
    engine = createEngine({
      campaign,
      sessionId: ulid(clock(), random),
      store,
      clock,
      random,
    });
  } catch (error) {
    await closeStores();
    throw error;
  }

  // Counts connections that completed `hello`, so tests can tell "socket open" from "authenticated".
  let authenticated = 0;
  const hostToken = options.hostToken ?? generateHostToken();
  const gateway = createGateway({
    hostToken,
    identities,
    handler: {
      ...engine,
      onConnect: (conn) => {
        authenticated += 1;
        return engine.onConnect(conn);
      },
      onDisconnect: (conn) => {
        authenticated -= 1;
        engine.onDisconnect(conn);
      },
    },
  });
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
  let port: number;
  try {
    port = await gateway.listen({ port: config.port, host: config.host });
  } catch (error) {
    await gateway.close();
    await closeStores();
    throw error;
  }
  return {
    gateway,
    engine,
    port,
    hostToken,
    async close() {
      await gateway.close();
      // Let queued intents finish their log append before the store closes (flushes fsync).
      await engine.idle();
      await closeStores();
    },
  };
}
