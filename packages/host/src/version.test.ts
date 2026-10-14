import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOST_VERSION } from './version.js';

describe('HOST_VERSION', () => {
  it("equals the host package.json's version", () => {
    const raw = readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8');
    const { version } = JSON.parse(raw) as { version: string };
    expect(HOST_VERSION).toBe(version);
    expect(HOST_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
