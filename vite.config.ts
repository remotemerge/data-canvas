import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SERVICE_WORKER_SOURCE } from './src/app/pwa/service-worker-source.ts';

/**
 * Emits the service worker with a precache list taken from the real build output.
 *
 * Hand-written rather than a PWA plugin dependency: the asset set is small and fully known at the
 * end of the bundle, and the precache list is the only part that cannot be written by hand. DuckDB's
 * Wasm and worker files are the ones that matter most — without them cached the app cannot start
 * offline at all.
 */
const serviceWorkerPlugin = (): Plugin => ({
  name: 'data-canvas-service-worker',
  apply: 'build',
  generateBundle(_options, bundle) {
    const assets = Object.keys(bundle)
      .filter((fileName) => /\.(?:js|css|wasm|woff2?)$/.test(fileName))
      .map((fileName) => `/${fileName}`);
    // `index.html` is fetched network-first but still precached, so a cold offline start works.
    const precache = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', ...assets];
    // Content-derived so a rebuilt worker replaces the previous cache rather than accumulating.
    const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);

    this.emitFile({
      type: 'asset',
      fileName: 'service-worker.js',
      source: SERVICE_WORKER_SOURCE.replaceAll('__PRECACHE_MANIFEST__', JSON.stringify(precache)).replaceAll(
        '__CACHE_VERSION__',
        version,
      ),
    });
  },
});

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  if (isBuild) {
    process.env['NODE_ENV'] = 'production';
  }

  return {
    base: '/',
    envPrefix: ['VITE_'],
    plugins: [react(), serviceWorkerPlugin()],
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
