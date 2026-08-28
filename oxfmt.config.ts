import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  printWidth: 120,
  ignorePatterns: ['dist/**', 'node_modules/**', 'public/**'],
  overrides: [
    {
      files: ['**/*.scss', '**/*.css', '**/*.html'],
      options: {
        singleQuote: false,
      },
    },
  ],
});
