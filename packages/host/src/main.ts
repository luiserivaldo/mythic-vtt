import { loadConfig } from './config.js';
import { startHost } from './server.js';

const config = loadConfig(process.env);
const running = await startHost(config);
// Machine-readable line: the e2e harness and dev:table wait for it.
console.log(`mythic-host listening on ${config.host}:${String(running.port)}`);
// D24: the token travels in the URL fragment (never sent to servers or logged by them) and is
// printed only here. Single use; a restart mints a new one.
const baseUrl = process.env['MYTHIC_PUBLIC_URL'] || `http://${config.host}:${String(running.port)}`;
console.log(`DM link: ${baseUrl.replace(/\/+$/, '')}/#host=${running.hostToken}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void running.close().finally(() => process.exit(0));
  });
}
