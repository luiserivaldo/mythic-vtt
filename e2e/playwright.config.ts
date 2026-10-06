import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Slow load tests are tagged @load and run on their own (multiclient-e2e skill).
  grepInvert: /@load/,
  timeout: 30_000,
  forbidOnly: true,
  use: { trace: 'retain-on-failure' },
});
