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
