import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/*
 * A Chrome origin-trial token is bound to a single origin, so it cannot be committed and reused
 * across preview, production, and local builds. An absent token removes the placeholder rather than
 * emitting `content=""`, which Chrome treats as a malformed trial tag.
 */
const webmcpOriginTrial = (token: string | undefined): Plugin => ({
  name: 'data-canvas-webmcp-origin-trial',
  transformIndexHtml: (html) =>
    html.replace(
      '%VITE_WEBMCP_ORIGIN_TRIAL_META%',
      token ? `<meta http-equiv="origin-trial" content="${token}" />` : '',
    ),
});

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
      tailwindcss(),
      webmcpOriginTrial(process.env['VITE_WEBMCP_ORIGIN_TRIAL_TOKEN']),
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
          background_color: '#f8fafc',
          theme_color: '#f8fafc',
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
    // DuckDB-Wasm's prebuilt worker and Wasm artifacts must stay whole.
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
