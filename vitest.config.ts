import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    passWithNoTests: true,
    // React resolves to its production build (no act()) when NODE_ENV is production, which the
    // worker shell exports; force the test build so component tests behave the same everywhere.
    env: { NODE_ENV: 'test' },
    // CI runs ~100 test files in parallel on a small runner; host integration tests start real
    // servers and hash identities with scrypt, so the 10 s defaults flake under that load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
