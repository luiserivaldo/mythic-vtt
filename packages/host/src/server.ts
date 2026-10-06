import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { storeMigrate } from '@mythic/shared';
import type { HostConfig } from './config.js';
import {
  createHttpAuthenticator,
  createSeatUploadAuthorizer,
  registerAssetRoutes,
  registerCampaignRoutes,
  registerStaticClient,
  type UploadAuthorizer,
} from './http/index.js';
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
import { LocalAssetStore, LocalCampaignStore, type ImportLimits } from './storage/index.js';

export interface RunningHost {
  readonly gateway: Gateway;
  readonly engine: Engine;
  readonly port: number;
  /** D24: one-time host token (memory only). Callers may print it only in the DM link fragment. */
  readonly hostToken: string;
  close(): Promise<void>;
}

export interface StartHostOptions {
  /** Defaults to the D36 authorizer: host and co-DM identities only. */
  uploadAuthorizer?: UploadAuthorizer;
  /** Overrides for campaign import limits (defaults: `DEFAULT_IMPORT_LIMITS`). */
  importLimits?: Partial<ImportLimits>;
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
  // D36: HTTP reuses the SES-02 identity (same hash check as `hello`) and the host binding.
  const httpAuth = createHttpAuthenticator({
    identities,
    state: () => engine.state(),
    now: clock,
  });
  registerAssetRoutes(gateway.app, {
    assetStore,
    uploadAuthorizer:
      options.uploadAuthorizer ?? createSeatUploadAuthorizer(httpAuth, { now: clock }),
    maxUploadBytes: config.maxImageUploadBytes,
  });
  registerCampaignRoutes(gateway.app, {
    store,
    auth: httpAuth,
    now: clock,
    ...(options.importLimits ? { importLimits: options.importLimits } : {}),
  });
  if (config.testEndpoints) {
    gateway.app.get('/__test/connections', () => ({
      open: gateway.connectionCount(),
      authenticated,
    }));
  }
  // After every explicit route: the static handler is the not-found fallback.
  if (config.clientDir) registerStaticClient(gateway.app, config.clientDir);
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
      try {
        // Server shutdown is the only Session-end boundary currently exposed. SES-05 requires
        // per-session Seat bindings to clear; the engine records those releases as actions.
        await engine.endSession();
      } finally {
        try {
          await gateway.close();
          // Let queued intents finish their log append before the store closes (flushes fsync).
          await engine.idle();
        } finally {
          await closeStores();
        }
      }
    },
  };
}
