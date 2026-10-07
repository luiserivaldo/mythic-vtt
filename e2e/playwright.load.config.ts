import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const { grepInvert, ...defaults } = base;
void grepInvert;

export default defineConfig({
  ...defaults,
  grep: /@load/,
  timeout: 120_000,
});
