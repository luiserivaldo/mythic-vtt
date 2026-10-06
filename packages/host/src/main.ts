#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allActions } from '@mythic/shared';
import { HELP, resolveConfig } from './cli.js';
import { lanUrls } from './lan.js';
import { startHost } from './server.js';

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
const running = await startHost(config);
const port = String(running.port);
const buildCommit = process.env['MYTHIC_BUILD_COMMIT']?.slice(0, 12) || 'unknown';
console.log(`mythic-host build 0.0.0+${buildCommit}; shared actions=${String(allActions.length)}`);
// Machine-readable line: the e2e harness and dev:table wait for it.
console.log(`mythic-host listening on ${config.host}:${port}`);
if (!config.clientDir)
  console.log('client not built (run `pnpm build`); only the host API is served');
const urls = lanUrls(config.host, running.port);
for (const url of urls) console.log(`Players can join at: ${url}`);
// D24: the token travels in the URL fragment (never sent to servers or logged by them) and is
// printed only here. Single use; a restart mints a new one.
const baseUrl = resolved.publicUrl || urls[0] || `http://${config.host}:${port}`;
console.log(`DM link: ${baseUrl.replace(/\/+$/, '')}/#host=${running.hostToken}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void running.close().finally(() => process.exit(0));
  });
}
