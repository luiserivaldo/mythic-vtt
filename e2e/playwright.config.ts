import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Multi-client harness arrives with M0-13; until then there is nothing to run.
  forbidOnly: true,
});
