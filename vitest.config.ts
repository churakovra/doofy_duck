import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Unit tests must exercise current source, including on a clean checkout.
    alias: { '@doofy-duck/game-sim': fileURLToPath(new URL('./packages/game-sim/src/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
  },
});
