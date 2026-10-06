/** Game host server. */
export const PACKAGE_NAME = '@mythic/host';
export { loadConfig, DEFAULT_MAX_IMAGE_UPLOAD_BYTES, DEFAULT_PORT } from './config.js';
export type { HostConfig } from './config.js';
export { startHost } from './server.js';
export type { RunningHost, StartHostOptions } from './server.js';
export type { AuthenticatedSeat, UploadAuthorizer } from './http/index.js';
