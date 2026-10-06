import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig, type HostConfig } from './config.js';

export const CONFIG_FILE_NAME = 'mythic.config.json';

export const HELP = `Usage: mythic-host [options]

  --port <n>        Port to listen on (default 8787; env MYTHIC_PORT)
  --host <addr>     Address to bind (default 127.0.0.1; env MYTHIC_HOST)
  --lan             Bind 0.0.0.0 so players on your network can join (env MYTHIC_LAN=1)
  --data-dir <dir>  Where campaigns and secrets live (default ./data; env MYTHIC_DATA_DIR)
  --config <file>   JSON config file (default <data-dir>/${CONFIG_FILE_NAME})
  --help            Show this help

Precedence: flags > environment > config file > defaults.`;

export interface CliFlags {
  port?: string;
  host?: string;
  lan?: boolean;
  dataDir?: string;
  config?: string;
  help?: boolean;
}

const VALUE_FLAGS: Record<string, keyof CliFlags> = {
  '--port': 'port',
  '--host': 'host',
  '--data-dir': 'dataDir',
  '--config': 'config',
};

export function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? '';
    const [name, inline] = raw.startsWith('--')
      ? (raw.split(/=(.*)/s) as [string, string?])
      : [raw];
    if (name === '--lan') flags.lan = true;
    else if (name === '--help' || name === '-h') flags.help = true;
    else if (name in VALUE_FLAGS) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new Error(`${name} needs a value`);
      (flags as Record<string, string>)[VALUE_FLAGS[name] as string] = value;
    } else throw new Error(`unknown argument: ${raw}`);
  }
  return flags;
}

// No secrets here: the host secret and DM token are never read from config.
const ConfigFile = z
  .object({
    port: z.number().int().min(0).max(65535),
    host: z.string().min(1),
    lan: z.boolean(),
    maxImageUploadBytes: z.number().int().positive(),
    campaignId: z.string().min(1),
    publicUrl: z.string().min(1),
    clientDir: z.string().min(1),
  })
  .partial()
  .strict();
export type ConfigFile = z.infer<typeof ConfigFile>;

export interface ResolvedCli {
  config: HostConfig;
  /** `MYTHIC_PUBLIC_URL` / `publicUrl`: base for the DM link when set. */
  publicUrl?: string;
}

export interface ResolveDeps {
  readFile?: (path: string) => Promise<string>;
}

/** flags > env > config file > defaults (HOST-01). */
export async function resolveConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  deps: ResolveDeps = {},
): Promise<ResolvedCli & { flags: CliFlags }> {
  const flags = parseArgs(argv);
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
  const dataDir = resolve(flags.dataDir ?? (env['MYTHIC_DATA_DIR'] || 'data'));
  const filePath = flags.config ? resolve(flags.config) : join(dataDir, CONFIG_FILE_NAME);

  let file: ConfigFile = {};
  try {
    file = ConfigFile.parse(JSON.parse(await read(filePath)));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    // A default-location file is optional; an explicit --config must exist.
    if (!(missing && !flags.config))
      throw new Error(`invalid config ${filePath}: ${String(error)}`, { cause: error });
  }

  const layered: Record<string, string | undefined> = {};
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined) layered[k] = String(v);
  };
  // Lowest first; later layers overwrite.
  set('MYTHIC_PORT', file.port);
  set('MYTHIC_MAX_IMAGE_UPLOAD_BYTES', file.maxImageUploadBytes);
  set('MYTHIC_CAMPAIGN_ID', file.campaignId);
  set('MYTHIC_CLIENT_DIR', file.clientDir);
  set('MYTHIC_PUBLIC_URL', file.publicUrl);
  for (const [k, v] of Object.entries(env)) if (k.startsWith('MYTHIC_') && v) layered[k] = v;
  set('MYTHIC_DATA_DIR', dataDir);
  set('MYTHIC_PORT', flags.port);
  // Host: per layer, an explicit host beats that layer's lan; layers go flags > env > file.
  const wildcard = '0.0.0.0';
  const host =
    flags.host ??
    (flags.lan ? wildcard : undefined) ??
    (env['MYTHIC_HOST'] || undefined) ??
    (env['MYTHIC_LAN'] === '1' ? wildcard : undefined) ??
    file.host ??
    (file.lan ? wildcard : undefined);
  set('MYTHIC_HOST', host);

  const publicUrl = layered['MYTHIC_PUBLIC_URL'];
  return { config: loadConfig(layered), flags, ...(publicUrl ? { publicUrl } : {}) };
}
