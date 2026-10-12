import { describe, expect, it } from 'vitest';
import { parseArgs, resolveConfig } from './cli.js';

const file = (obj: unknown) => ({ readFile: () => Promise.resolve(JSON.stringify(obj)) });
const none = {
  readFile: () => Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' })),
};

describe('config precedence (HOST-01)', () => {
  it('uses defaults when nothing is set', async () => {
    const { config } = await resolveConfig([], {}, none);
    expect(config.port).toBe(8787);
    expect(config.host).toBe('127.0.0.1');
  });

  it('file < env < flags', async () => {
    const f = file({ port: 1111, maxImageUploadBytes: 5 });
    expect((await resolveConfig([], {}, f)).config.port).toBe(1111);
    expect((await resolveConfig([], { MYTHIC_PORT: '2222' }, f)).config.port).toBe(2222);
    const r = await resolveConfig(['--port', '3333'], { MYTHIC_PORT: '2222' }, f);
    expect(r.config.port).toBe(3333);
    expect(r.config.maxImageUploadBytes).toBe(5);
  });

  it('--lan binds 0.0.0.0, but an explicit host wins within a layer', async () => {
    expect((await resolveConfig(['--lan'], {}, none)).config.host).toBe('0.0.0.0');
    expect((await resolveConfig(['--lan', '--host', '10.0.0.5'], {}, none)).config.host).toBe(
      '10.0.0.5',
    );
    expect(
      (await resolveConfig([], { MYTHIC_HOST: '10.0.0.6' }, file({ lan: true }))).config.host,
    ).toBe('10.0.0.6');
    expect((await resolveConfig([], {}, file({ lan: true }))).config.host).toBe('0.0.0.0');
  });

  it('--data-dir picks where the default config file is looked for', async () => {
    const seen: string[] = [];
    await resolveConfig(
      ['--data-dir=/tmp/x'],
      {},
      {
        readFile: (p) => {
          seen.push(p);
          return Promise.resolve('{}');
        },
      },
    );
    expect(seen).toEqual(['/tmp/x/mythic.config.json']);
  });

  it('rejects unknown flags, unknown file keys and a missing explicit --config', async () => {
    expect(() => parseArgs(['--bogus'])).toThrow();
    expect(() => parseArgs(['--port'])).toThrow();
    await expect(resolveConfig([], {}, file({ secret: 'x' }))).rejects.toThrow(/invalid config/);
    await expect(resolveConfig(['--config', '/nope.json'], {}, none)).rejects.toThrow();
  });
});

describe('campaign selection flags (HOST-03)', () => {
  const pick = async (argv: string[], env: Record<string, string>, f: unknown = {}) => {
    const { config } = await resolveConfig(argv, env, file(f));
    return [config.campaignId, config.campaign, config.newCampaign];
  };

  it('parses --campaign, --new-campaign and --list-campaigns', () => {
    expect(parseArgs(['--campaign', 'Sunken Chapel', '--list-campaigns'])).toEqual({
      campaign: 'Sunken Chapel',
      listCampaigns: true,
    });
    expect(parseArgs(['--new-campaign=Lost Mine']).newCampaign).toBe('Lost Mine');
  });

  it('keeps MYTHIC_CAMPAIGN_ID and the config file key working', async () => {
    expect(await pick([], { MYTHIC_CAMPAIGN_ID: 'ENVID' })).toEqual([
      'ENVID',
      undefined,
      undefined,
    ]);
    expect(await pick([], {}, { campaignId: 'FILEID' })).toEqual(['FILEID', undefined, undefined]);
    expect(await pick([], {}, { campaign: 'Chapel' })).toEqual([undefined, 'Chapel', undefined]);
  });

  it('lets the highest layer replace the whole choice instead of conflicting', async () => {
    expect(await pick([], { MYTHIC_CAMPAIGN: 'env' }, { campaignId: 'FILEID' })).toEqual([
      undefined,
      'env',
      undefined,
    ]);
    expect(await pick(['--campaign', 'flag'], { MYTHIC_CAMPAIGN_ID: 'ENVID' })).toEqual([
      undefined,
      'flag',
      undefined,
    ]);
    expect(await pick(['--new-campaign', 'Fresh'], { MYTHIC_CAMPAIGN: 'env' })).toEqual([
      undefined,
      undefined,
      'Fresh',
    ]);
  });
});
