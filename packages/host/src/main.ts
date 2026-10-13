#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allActions, storeMigrate } from '@mythic/shared';
import { formatCampaignList, pickCampaignInteractively } from './campaign-picker.js';
import { HELP, resolveConfig } from './cli.js';
import { CampaignSelectionError } from './engine/index.js';
import { startHost } from './server.js';
import { LocalCampaignStore } from './storage/index.js';

let resolved;
try {
  resolved = await resolveConfig(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(HELP);
  process.exit(2);
}
if (resolved.flags.help) {
  console.log(HELP);
  process.exit(0);
}
const config = resolved.config;
if (!config.clientDir) {
  // dist/main.js -> ../../client/dist/app (monorepo layout, built by `pnpm build`).
  const guess = fileURLToPath(new URL('../../client/dist/app', import.meta.url));
  if (existsSync(`${guess}/index.html`)) config.clientDir = guess;
}
if (resolved.flags.listCampaigns) {
  const store = new LocalCampaignStore(config.dataDir, storeMigrate);
  try {
    await store.reindex();
    const campaigns = await store.list();
    console.log(
      campaigns.length === 0
        ? 'No campaigns yet; start the host to create one.'
        : formatCampaignList(campaigns).join('\n'),
    );
  } finally {
    await store.close();
  }
  process.exit(0);
}
// The picker only appears for a person at a terminal; scripts and services keep "newest".
const interactive = process.stdin.isTTY && process.stdout.isTTY;
let running;
try {
  running = await startHost(config, {
    ...(resolved.publicUrl !== undefined ? { publicUrl: resolved.publicUrl } : {}),
    ...(interactive ? { chooseCampaign: (list) => pickCampaignInteractively(list) } : {}),
  });
} catch (error) {
  if (!(error instanceof CampaignSelectionError)) throw error;
  console.error(error.message);
  process.exit(2);
}
const port = String(running.port);
const buildCommit = process.env['MYTHIC_BUILD_COMMIT']?.slice(0, 12) || 'unknown';
console.log(`Campaign: ${running.engine.state().name} (${running.engine.state().id})`);
console.log(`mythic-host build 0.0.0+${buildCommit}; shared actions=${String(allActions.length)}`);
// Machine-readable line: the e2e harness and dev:table wait for it.
console.log(`mythic-host listening on ${config.host}:${port}`);
if (!config.clientDir)
  console.log('client not built (run `pnpm build`); only the host API is served');
for (const { url } of running.joinUrls) console.log(`Players can join at: ${url}`);
// D24: the token travels in the URL fragment (never sent to servers or logged by them) and is
// printed only here. Single use; a restart mints a new one.
const publicUrl = running.joinUrls.find((entry) => entry.kind === 'public')?.url;
const baseUrl = publicUrl || running.joinUrls[0]?.url || `http://${config.host}:${port}`;
console.log(`DM link: ${baseUrl.replace(/\/+$/, '')}/#host=${running.hostToken}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void running.close().finally(() => process.exit(0));
  });
}
