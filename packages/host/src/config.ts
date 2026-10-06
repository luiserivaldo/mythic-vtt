import { join, resolve } from 'node:path';

export const DEFAULT_PORT = 8787;

export interface HostConfig {
  port: number;
  host: string;
  dataDir: string;
  hostSecretPath: string;
  /** Campaign to open (`MYTHIC_CAMPAIGN_ID`); default: most recently updated, else a new one. */
  campaignId?: string;
  /** Atomic checkpoint interval before initiative exists (T5). */
  autosaveEvery: number;
  /** Exposes /__test/connections for the e2e harness; never enable on a real table. */
  testEndpoints: boolean;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`invalid MYTHIC_PORT: ${raw}`);
  return n;
}

function parseAutosaveEvery(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`invalid MYTHIC_AUTOSAVE_ACTIONS: ${raw}`);
  return n;
}

/** Reads host settings from the environment; the data dir and secret path default under ./data. */
export function loadConfig(env: Record<string, string | undefined>): HostConfig {
  const dataDir = resolve(env['MYTHIC_DATA_DIR'] || 'data');
  return {
    port: parsePort(env['MYTHIC_PORT']),
    host: env['MYTHIC_HOST'] || '127.0.0.1',
    dataDir,
    autosaveEvery: parseAutosaveEvery(env['MYTHIC_AUTOSAVE_ACTIONS']),
    hostSecretPath: env['MYTHIC_HOST_SECRET_PATH']
      ? resolve(env['MYTHIC_HOST_SECRET_PATH'])
      : join(dataDir, 'host-secret'),
    testEndpoints: env['MYTHIC_TEST_ENDPOINTS'] === '1',
    ...(env['MYTHIC_CAMPAIGN_ID'] ? { campaignId: env['MYTHIC_CAMPAIGN_ID'] } : {}),
  };
}
