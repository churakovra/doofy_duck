import { defineConfig, configDefaults } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Unit tests must exercise current source, including on a clean checkout.
    alias: { '@doofy-duck/game-sim': fileURLToPath(new URL('./packages/game-sim/src/index.ts', import.meta.url)) },
  },
  test: {
    exclude: [...configDefaults.exclude, 'apps/web/test/**/*.spec.ts', 'apps/web/test/**/*.browser.ts'],
    environment: 'node',
  },
});
