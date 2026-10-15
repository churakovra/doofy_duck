import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: ['**/*.spec.ts', '**/*.browser.ts'],
  testIgnore: ['**/dev-start.browser.spec.ts'],
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // SwiftShader contexts share the host CPU; isolate timing-sensitive game suites.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview --workspace @doofy-duck/web -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
