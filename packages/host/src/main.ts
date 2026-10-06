import { loadConfig } from './config.js';
import { startHost } from './server.js';

const config = loadConfig(process.env);
const running = await startHost(config);
// Machine-readable line: the e2e harness and dev:table wait for it.
console.log(`mythic-host listening on ${config.host}:${String(running.port)}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void running.close().finally(() => process.exit(0));
  });
}
