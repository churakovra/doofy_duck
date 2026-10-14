import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'apps/web/test/**/*.spec.ts', 'apps/web/test/**/*.browser.ts'],
    environment: 'node',
  },
});
