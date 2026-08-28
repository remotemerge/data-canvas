import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  if (isBuild) {
    process.env['NODE_ENV'] = 'production';
  }

  return {
    base: '/',
    envPrefix: ['VITE_'],
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '~@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
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
