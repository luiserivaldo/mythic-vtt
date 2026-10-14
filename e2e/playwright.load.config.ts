import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const defaults = { ...base };
delete defaults.grepInvert;

export default defineConfig({
  ...defaults,
  grep: /@load/,
  timeout: 120_000,
});
