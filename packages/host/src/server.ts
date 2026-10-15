import { createSeatInvites } from './gateway/seat-invites.js';
import { createSpectatorLinks } from './gateway/spectator-links.js';
import { registerSpectatorRoutes } from './http/spectator-routes.js';
import { registerSpectatorViewRoutes } from './http/spectator-view-routes.js';
import { createSpectatorView } from './gateway/spectator-view.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { storeMigrate } from '@mythic/shared';
import type { HostConfig } from './config.js';
import {
  createHttpAuthenticator,
  createSeatUploadAuthorizer,
  registerAssetRoutes,
  registerCampaignRoutes,
  registerHistoryRoutes,
  registerJoinRoutes,
  registerSeatInviteRoutes,
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
import { recoverCampaign, saveCampaignCheckpoint } from './engine/recovery.js';
import { readHistoryChunk, type HistoryPosition } from './storage/history-log-reader.js';
import { playerJoinUrls, type PlayerJoinUrl } from './lan.js';
import {
  LocalAssetStore,
  LocalCampaignStore,
  backfillAssetLinks,
  scopedAssetStore,
  type CampaignMeta,
  type ImportLimits,
} from './storage/index.js';

export interface RunningHost {
  readonly gateway: Gateway;
  readonly engine: Engine;
  readonly port: number;
  /** D24: one-time host token (memory only). Callers may print it only in the DM link fragment. */
  readonly hostToken: string;
  /** M1-38: fragment-free player links reported to the CLI and authenticated host client. */
  readonly joinUrls: readonly PlayerJoinUrl[];
  close(): Promise<void>;
}

export interface StartHostOptions {
  /** Defaults to the D36 authorizer: host and co-DM identities only. */
  uploadAuthorizer?: UploadAuthorizer;
  /** Overrides for campaign import limits (defaults: `DEFAULT_IMPORT_LIMITS`). */
  importLimits?: Partial<ImportLimits>;
  hostToken?: string;
  publicUrl?: string;
  /** HOST-03: asked when several campaigns exist and none was selected; undefined = newest. */
  chooseCampaign?: (campaigns: readonly CampaignMeta[]) => Promise<string | undefined>;
  clock?: Clock;
  random?: RandomSource;
}

/**
 * Game host: gateway + engine room for one campaign, persisted in `config.dataDir` (§8.2). The
 * data dir may hold several campaigns (HOST-03); the one to open is chosen at start and the
 * others stay untouched and unreachable (their assets included).
 * The host secret is created on first run and is never logged.
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
  let reportedJoinUrls: PlayerJoinUrl[] = [];
  try {
    await store.reindex();
    await backfillAssetLinks(assetStore, store);
    const savedFiles = await loadOrCreateCampaign(store, {
      clock,
      random,
      ...(config.campaignId !== undefined ? { campaignId: config.campaignId } : {}),
      ...(config.campaign !== undefined ? { campaign: config.campaign } : {}),
      ...(config.newCampaign !== undefined ? { newCampaign: config.newCampaign } : {}),
      ...(options.chooseCampaign ? { choose: options.chooseCampaign } : {}),
    });
    const { campaign, seq } = await recoverCampaign(store, savedFiles);
    const startedAt = clock();
    const sessionId = ulid(startedAt, random);
    await store.startSession(
      campaign.id,
      {
        schemaVersion: campaign.schemaVersion,
        sessionId,
        startedAt,
      },
      { seq, state: campaign },
    );
    engine = createEngine({
      campaign,
      sessionId,
      store,
      clock,
      random,
      initialSeq: seq,
      // HIST-07: rollback walks the on-disk log backwards, newest first, across Sessions.
      readLog: async function* () {
        await store.flushLogs();
        const sessions = (await store.readSessions(campaign.id, 1024))
          .reverse()
          .map((session) => session.sessionId);
        let position: HistoryPosition | undefined = { session: 0 };
        while (position) {
          const chunk = await readHistoryChunk(store.folder(campaign.id), sessions, position);
          yield chunk.entries;
          position = chunk.next;
        }
      },
      hostJoinUrls: () => reportedJoinUrls,
      onApplied: async (state, appliedSeq) => {
        if (appliedSeq % config.autosaveEvery === 0)
          await saveCampaignCheckpoint(store, state, sessionId, appliedSeq, 'autosave');
      },
    });
  } catch (error) {
    await closeStores();
    throw error;
  }

  // Counts connections that completed `hello`, so tests can tell "socket open" from "authenticated".
  let authenticated = 0;
  const hostToken = options.hostToken ?? generateHostToken();
  const spectatorLinks = createSpectatorLinks(
    join(config.dataDir, 'index.sqlite'),
    engine.state().id,
  );
  const spectatorView = createSpectatorView(
    join(config.dataDir, 'index.sqlite'),
    engine.state().id,
  );
  // Restore the persisted choice; an unknown or co-DM seat quietly keeps the player view.
  await engine.setSpectatorView(spectatorView.get());
  const seatInvites = createSeatInvites(join(config.dataDir, 'index.sqlite'), engine.state().id);
  const gateway = createGateway({
    spectatorTokenValid: (token) => spectatorLinks.valid(token),
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
  registerSpectatorRoutes(gateway.app, {
    auth: httpAuth,
    links: spectatorLinks,
    disconnect: () => {
      gateway.disconnectSpectators();
    },
  });
  registerSpectatorViewRoutes(gateway.app, {
    auth: httpAuth,
    view: spectatorView,
    apply: (seatId) => engine.setSpectatorView(seatId),
  });
  // UX-44: the pre-join payload; the host's public profile is its stored display name and avatar.
  registerJoinRoutes(gateway.app, {
    state: () => engine.state(),
    host: async () => {
      const id = await identities.getHostIdentityId();
      const stored = id === undefined ? undefined : await identities.get(id);
      return stored
        ? {
            name: stored.displayName,
            ...(stored.avatar !== undefined ? { avatar: stored.avatar } : {}),
          }
        : undefined;
    },
    now: clock,
  });
  registerSeatInviteRoutes(gateway.app, {
    auth: httpAuth,
    invites: seatInvites,
    state: () => engine.state(),
    claimSeat: (identityId, seatId) => engine.claimSeat(identityId, seatId),
  });
  // HOST-03: HTTP only sees this campaign's assets; the raw pool stays with import/export.
  registerAssetRoutes(gateway.app, {
    assetStore: scopedAssetStore(assetStore, engine.state().id),
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
  registerHistoryRoutes(gateway.app, { store, engine, auth: httpAuth, now: clock });
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
    spectatorLinks.close();
    spectatorView.close();
    seatInvites.close();
    await closeStores();
    throw error;
  }
  const joinUrls = playerJoinUrls(config.host, port, options.publicUrl);
  // The actual port is not known until after listen. Connections created after startHost returns
  // receive this resolved list through the closure above.
  reportedJoinUrls = joinUrls;
  return {
    gateway,
    engine,
    port,
    hostToken,
    joinUrls,
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
          await saveCampaignCheckpoint(
            store,
            engine.state(),
            engine.sessionId,
            engine.seq(),
            'end',
          );
        } finally {
          spectatorLinks.close();
          spectatorView.close();
          seatInvites.close();
          await closeStores();
        }
      }
    },
  };
}
