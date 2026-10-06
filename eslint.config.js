import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // AGENTS.md §6: named exports only, no `any`, no unexplained non-null assertions.
      'no-restricted-exports': ['error', { restrictDefaultExports: { direct: true } }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // Tool configs are default exports by convention.
    files: ['*.config.{js,ts}', '**/*.config.{js,ts}'],
    rules: { 'no-restricted-exports': 'off' },
  },
  {
    // AGENTS.md §2.2: shared is pure.
    files: ['packages/shared/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'process', 'Buffer', 'fetch'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'shared must be pure (AGENTS.md §2.2)' },
        { object: 'Date', property: 'now', message: 'shared must be pure (AGENTS.md §2.2)' },
      ],
    },
  },
);
