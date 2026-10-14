import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('ready screen starts one playable run from the first Space press', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('script[src="/@vite/client"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
  await expect(page.locator('canvas[aria-label="Doofy Duck game canvas"]')).toBeVisible();
  await page.screenshot({ path: resolve(process.cwd(), 'docs/web-ready.png'), fullPage: true });
  await page.keyboard.press('Space');
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await page.screenshot({ path: resolve(process.cwd(), 'docs/web-running.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
});

test('screen start, pause, explicit resume, death, and restart are playable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('canvas[aria-label="Doofy Duck game canvas"]')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await page.locator('.pause-button').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
  await page.locator('.screen-card .primary-button').evaluate((button: HTMLButtonElement) => button.click());
  for (let elapsed = 0; elapsed < 8_000 && !(await page.getByRole('heading', { name: 'Хороший заход!' }).isVisible().catch(() => false)); elapsed += 200) {
    if (await page.getByRole('heading', { name: 'На паузе' }).isVisible().catch(() => false)) {
      await page.locator('.screen-card .primary-button').evaluate((button: HTMLButtonElement) => button.click());
    }
    await page.waitForTimeout(200);
  }
  await expect(page.getByRole('heading', { name: 'Хороший заход!' })).toBeVisible();
  await page.getByRole('button', { name: /Ещё раз/ }).click();
  await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('short landscape viewports keep the complete playfield and HUD inside the screen', async ({ page }) => {
  for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    const bounds = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        shell: rect('.game-shell'), canvas: rect('canvas'),
        hud: rect('.hud'), wallet: rect('.wallet-strip'), card: rect('.screen-card'),
        controls: [...document.querySelectorAll<HTMLElement>('.game-shell button')].map((button) => {
          const box = button.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
        }),
        ratio: (() => { const box = document.querySelector('canvas')!.getBoundingClientRect(); return box.width / box.height; })(),
      };
    });
    for (const box of [bounds.shell, bounds.canvas, bounds.hud, bounds.wallet, bounds.card, ...bounds.controls]) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(bounds.viewport.width);
      expect(box.bottom).toBeLessThanOrEqual(bounds.viewport.height);
    }
    expect(bounds.ratio).toBeCloseTo(360 / 580, 2);
  }
});

test('a primary field touch starts gameplay, while button touches remain isolated from field input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('canvas');
  await canvas.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
  await page.getByRole('button', { name: 'Пауза' }).dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
});

test('queued field inputs after pause and resume retain the next accepted sequence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const canvas = page.locator('canvas');
  const touch = () => canvas.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await touch();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true }));
    document.querySelector<HTMLButtonElement>('.pause-button')!.click();
  });
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
  await page.getByRole('button', { name: /Продолжить/ }).click();
  await touch();
  await page.waitForTimeout(150);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
});

test('renderer failure blocks gameplay input and reports a visible error', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => { throw new Error('forced renderer failure'); }) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeDisabled();
  await page.locator('.game-shell').dispatchEvent('pointerdown', { button: 0, pointerType: 'touch', isPrimary: true, bubbles: true });
  await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
});

test('an input event burst stays within the bounded queue and preserves contiguous frames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('canvas').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    for (let i = 0; i < 40; i += 1) canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: i + 2, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true }));
  });
  await page.waitForTimeout(150);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeEnabled();
});

test('resizes while keeping its single fixed-ratio playfield and pauses after visibility loss', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 844, height: 390 });
  const canvasSize = await page.locator('canvas').evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return { width: Math.round(bounds.width), height: Math.round(bounds.height), ratio: bounds.width / bounds.height };
  });
  expect(canvasSize.ratio).toBeCloseTo(360 / 580, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Начать полёт/ }).click();
  await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
});

test('blocked storage does not prevent repeated complete runs and restarts', async ({ page }) => {
  // Control animation timestamps so host CPU stalls cannot trigger the game's intentional overload pause.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked by test policy', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeEnabled();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('canvas').dispatchEvent('pointerdown', { pointerId: cycle + 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
    await page.clock.runFor(100);
    await expect(page.getByText('КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ')).toBeVisible();
    await page.clock.runFor(3000);
    await expect(page.getByRole('heading', { name: 'Хороший заход!' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: /Ещё раз/ }).click();
    await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);
  }
});
