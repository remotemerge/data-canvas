import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  if (isBuild) {
    process.env['NODE_ENV'] = 'production';
  }

  return {
    base: '/',
    envPrefix: ['VITE_'],
    plugins: [
      react(),
      VitePWA({
        includeAssets: ['icon.svg', 'icon-maskable.svg'],
        injectRegister: null,
        manifest: {
          name: 'Data Canvas',
          short_name: 'Data Canvas',
          description: 'The shared visual workspace for humans and AI to explore data together.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#0f1117',
          theme_color: '#5b8cff',
          orientation: 'any',
          icons: [
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/icon-maskable.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        registerType: 'prompt',
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,wasm,woff,woff2,svg,webmanifest}'],
          // DuckDB's largest Wasm bundle is about 41 MiB and is required for an offline start.
          maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
          navigateFallback: '/index.html',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '~@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    },
    /*
     * DuckDB-Wasm ships prebuilt worker and Wasm artifacts that must stay whole.
     */
    optimizeDeps: {
      exclude: ['@duckdb/duckdb-wasm'],
    },
    worker: {
      format: 'es',
    },
    server: {
      port: 3000,
      hmr: {
        host: 'localhost',
        port: 3000,
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
