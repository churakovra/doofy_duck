import { expect, test } from '@playwright/test';
import { installAccountBackend, prepareAccountFlight } from './account-backend.fixture';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`starts and restores an account-backed flight at ${viewport.width}px`, async ({ page }) => {
    await installAccountBackend(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    // This suite also runs against Vite development/React StrictMode, not only a build.
    await prepareAccountFlight(page);
    await page.locator('.screen-panel .primary-button').click();
    await expect(page.locator('.running-score')).toBeVisible();
    await page.reload();
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
    await page.locator('.screen-panel .primary-button').click();
    await expect(page.locator('.running-score')).toBeVisible();
  });
}
