import { defineConfig } from 'oxlint';

export default defineConfig({
  globals: {
    Bun: 'readonly',
  },
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    perf: 'warn',
  },
  rules: {
    // Best practices
    'no-var': 'error',
    eqeqeq: 'error',
    'no-eval': 'error',
    'no-implicit-coercion': 'error',

    // TypeScript rules
    'no-unused-vars': 'error',
    'no-explicit-any': 'warn',
    'consistent-type-imports': 'error',
    'no-floating-promises': 'error',
    'await-thenable': 'error',

    // Restriction rules
    'no-console': 'warn',

    // Disabled rules
    'prefer-destructuring': 'off',
    'sort-keys': 'off',
    'switch-case-braces': 'off',
    'no-map-spread': 'off',
  },
  ignorePatterns: ['dist/**', 'node_modules/**', 'public/**'],
});
