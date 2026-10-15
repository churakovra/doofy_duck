import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`starts after wallet effect cleanup at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    // This suite also runs against Vite development/React StrictMode, not only a build.
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = page.getByRole('button', { name: /Начать полёт/ });
      await expect(start).toBeEnabled();
      await expect(page.locator('.wallet-storage')).toHaveText('Кошелёк на этом устройстве');
      await start.click();
      await expect(page.locator('.running-score')).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(1);
      if (attempt === 0) await page.reload();
    }
  });
}
