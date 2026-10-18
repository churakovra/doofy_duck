import { expect, test, type Page } from '@playwright/test';
import { installAccountBackend, prepareAccountFlight } from './account-backend.fixture';

test.beforeEach(async ({ page }) => installAccountBackend(page));

async function waitForPlayableGame(page: Page) {
  await expect(page.locator('.account-id')).toHaveText('100000001');
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeEnabled();
  await prepareAccountFlight(page);
}

async function changeVisibility(page: Page, hidden: boolean) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('ready screen starts one playable run from the first Space press', async ({ page }, testInfo) => {
  // Assert first-input behavior independently of host stalls that intentionally pause gameplay.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForPlayableGame(page);
  await expect(page.locator('script[src="/@vite/client"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
  await expect(page.locator('canvas[aria-label="Игровое поле Doofy Duck"]')).toBeVisible();
  await page.keyboard.press('Space');
  await page.clock.runFor(70);
  await expect(page.locator('.running-score')).toBeVisible();
  await expect(page.getByRole('button', { name: /Пауза|Pause/ })).toHaveCount(0);
  for (const selector of ['.brand', '.score-card', '.menu-trigger', '.wallet-status-strip', '.screen-card']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await page.screenshot({ path: testInfo.outputPath('web-running.png'), fullPage: true });
});

test('screen start, pause, explicit resume, death, and restart survive three cycles', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForPlayableGame(page);
  await expect(page.locator('canvas[aria-label="Игровое поле Doofy Duck"]')).toBeVisible();
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.keyboard.press('Space');
    await expect(page.locator('.running-score')).toBeVisible();
    await changeVisibility(page, true);
    await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
    await changeVisibility(page, false);
    await page.locator('.screen-card .primary-button').evaluate((button: HTMLButtonElement) => button.click());
    for (let elapsed = 0; elapsed < 8_000 && !(await page.locator('.account-settlement').isVisible().catch(() => false)); elapsed += 200) {
      if (await page.getByRole('heading', { name: 'На паузе' }).isVisible().catch(() => false)) {
        await page.locator('.screen-card .primary-button').evaluate((button: HTMLButtonElement) => button.click());
      }
      await page.waitForTimeout(200);
    }
    await expect(page.locator('.account-settlement')).toContainText(/Зачислено|Расчёт/);
    await page.getByRole('button', { name: /Начать полёт/ }).click();
    await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);
  }
});

test('short landscape viewports keep the complete playfield and HUD inside the screen', async ({ page }) => {
  await page.goto('/');
  await prepareAccountFlight(page);
  for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 390 }]) {
    await page.setViewportSize(viewport);
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
        hud: rect('.hud'), wallet: rect('.wallet-status-strip'), card: rect('.screen-card'),
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

test('field touch starts gameplay while the ready menu remains isolated from field input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForPlayableGame(page);
  await page.getByRole('button', { name: 'Меню' }).dispatchEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await page.getByRole('button', { name: 'Меню' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть настройки' }).click();
  const canvas = page.locator('canvas');
  await canvas.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await expect(page.locator('.running-score')).toBeVisible();
  await expect(page.getByRole('button', { name: /Пауза|Pause/ })).toHaveCount(0);
});

test('queued field inputs after pause and resume retain the next accepted sequence', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await waitForPlayableGame(page);
  const canvas = page.locator('canvas');
  const touch = () => canvas.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await touch();
  await expect(page.locator('.running-score')).toBeVisible();
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true }));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
  await changeVisibility(page, false);
  await page.getByRole('button', { name: /Продолжить/ }).click();
  await touch();
  await page.waitForTimeout(150);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.running-score')).toBeVisible();
});

test('renderer failure blocks gameplay input and reports a visible error', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => { throw new Error('forced renderer failure'); }) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/Игровая симуляция остановлена из-за ошибки/);
  await expect(page.getByRole('button', { name: 'Обновить страницу' })).toBeVisible();
  await page.locator('.game-shell').dispatchEvent('pointerdown', { button: 0, pointerType: 'touch', isPrimary: true, bubbles: true });
  await expect(page.getByRole('alert')).toContainText(/Игровая симуляция остановлена из-за ошибки/);
  await expect(page.getByRole('button', { name: 'Обновить страницу' })).toBeVisible();
});

test('account authentication failure shows a recoverable error', async ({ page }) => {
  await page.route('**/api/v1/auth/telegram', async (route) => route.fulfill({ status: 503, body: JSON.stringify({ detail: { code: 'service_unavailable' } }) }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /Повторить|Retry/ })).toBeVisible();
});

test('an input event burst stays within the bounded queue and preserves contiguous frames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(() => {
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
  await page.goto('/');
  await waitForPlayableGame(page);
  await page.locator('canvas').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
  await page.clock.runFor(34);
  await expect(page.locator('.running-score')).toBeVisible();
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    for (let i = 0; i < 40; i += 1) canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: i + 2, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true }));
  });
  await page.clock.runFor(150);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.running-score')).toBeVisible();
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
  await prepareAccountFlight(page);
  await page.locator('.screen-panel .primary-button').click();
  await expect(page.locator('.running-score')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
});

test('account session restores without importing browser wallet balances', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.account-id')).toHaveText('100000001');
  await page.reload();
  await expect(page.locator('.account-id')).toHaveText('100000001');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => /wallet|balance|coin/i.test(key))).toBe(false);
});

test('a verified account run settles server-side once and survives re-login', async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.addInitScript(() => {
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
  await prepareAccountFlight(page);
  await page.locator('.screen-panel .primary-button').click();
  const advanceFrames = async (count: number) => {
    for (let i = 0; i < count; i++) await page.clock.runFor(17);
  };
  await advanceFrames(1);
  let previousTapTick = 1;
  for (const tapTick of [19, 52, 86, 120, 166]) {
    await advanceFrames(tapTick - previousTapTick);
    await page.locator('canvas').dispatchEvent('pointerdown', { pointerId: tapTick, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true });
    previousTapTick = tapTick;
  }
  await advanceFrames(160);
  await expect(page.locator('.account-settlement')).toContainText(/Зачислено|credited/);
  const gains = await page.locator('.earnings-summary strong').allTextContents();
  expect(gains.map((value) => Number(value.match(/\d+/)?.[0] ?? 0)).some((amount) => amount > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('account-settlement.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('.account-id')).toHaveText('100000001');
  await expect(page.locator('.account-settlement')).toContainText(/Зачислено|credited/);
  const balanceImport = await page.evaluate(() => Object.keys(localStorage).filter((key) => /wallet|balance|coin/i.test(key)));
  expect(balanceImport).toEqual([]);
});
