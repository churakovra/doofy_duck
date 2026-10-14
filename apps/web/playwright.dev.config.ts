import { defineConfig } from '@playwright/test';
import production from './playwright.config';

export default defineConfig({
  ...production,
  testMatch: '**/dev-start.browser.spec.ts',
  testIgnore: [],
  use: { ...production.use, baseURL: 'http://127.0.0.1:4175' },
  webServer: {
    command: 'npm run dev -- --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
