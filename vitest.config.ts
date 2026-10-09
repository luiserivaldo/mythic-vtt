import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    passWithNoTests: true,
    // CI runs ~100 test files in parallel on a small runner; host integration tests start real
    // servers and hash identities with scrypt, so the 10 s defaults flake under that load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
