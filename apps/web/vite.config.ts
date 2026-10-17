import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
  },
  server: {
    host: '127.0.0.1', port: 4173, strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/.well-known': 'http://127.0.0.1:8080',
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
