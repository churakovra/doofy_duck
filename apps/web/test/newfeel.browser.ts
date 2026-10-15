import { expect, test } from '@playwright/test';

test('flight presentation animates inside the existing canvas', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(() => {
    // Normalize native RAF timestamps so the game clock advances in exact 60Hz steps.
    let previousBrowserTime = -1;
    let controlledTime = 0;
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => requestFrame((browserTime) => {
      if (browserTime !== previousBrowserTime) {
        previousBrowserTime = browserTime;
        controlledTime += 1000 / 60;
      }
      callback(controlledTime);
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('canvas[aria-label="Игровое поле Doofy Duck"]');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: /Начать полёт/ }).click();
  await page.clock.runFor(70);
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
  const before = await canvas.screenshot();
  await page.clock.runFor(70);
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('reduced motion keeps the playable duck and canvas available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const canvas = page.locator('canvas[aria-label="Игровое поле Doofy Duck"]');
  await expect(canvas).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
});
