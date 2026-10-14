import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Slow load tests are tagged @load and run on their own (multiclient-e2e skill).
  grepInvert: /@load/,
  timeout: 30_000,
  forbidOnly: true,
  // Software-rendered multi-client scenes compete for CPU on CI runners.
  ...(process.env.CI ? { workers: 1, globalTimeout: 20 * 60_000 } : {}),
  retries: 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
