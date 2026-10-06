/** Game host server. */
export const PACKAGE_NAME = '@mythic/host';
export { loadConfig, DEFAULT_PORT } from './config.js';
export type { HostConfig } from './config.js';
export { startHost } from './server.js';
export type { RunningHost } from './server.js';
