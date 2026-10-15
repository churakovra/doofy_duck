import { expect, test } from '@playwright/test';

const viewports = [
  { width: 320, height: 640 },
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 844, height: 280 },
];

async function changeVisibility(page: import('@playwright/test').Page, hidden: boolean) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('phone layouts keep controls readable and clear of the ready card and wallet', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('doofy-duck:wallet:v1', JSON.stringify({
      version: 1,
      balances: { FEATHER: 1234567, GAME_STAR: 9876543 },
      settledRunIds: ['mobile-layout'],
    }));
  });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeVisible();
    await expect(page.locator('.wallet-storage')).toHaveText('Кошелёк на этом устройстве');
    await page.locator('.screen-panel .primary-button').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      };
      return {
        width: innerWidth,
        height: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        canvas: box('canvas'),
        frame: box('.game-frame'),
        hud: box('.hud'),
        card: box('.screen-card'),
        panel: box('.screen-panel'),
        wallet: box('.wallet-strip'),
        action: box('.screen-panel .primary-button'),
        balances: [...document.querySelectorAll<HTMLElement>('.wallet-total')].map((item) => {
          const surface = item.getBoundingClientRect();
          return [...item.querySelectorAll<HTMLElement>('.token, strong')].map((part) => {
            const rect = part.getBoundingClientRect();
            return { surfaceLeft: surface.left, surfaceRight: surface.right, left: rect.left, right: rect.right };
          });
        }),
        controls: [...document.querySelectorAll<HTMLElement>('.hud button, .screen-card button')].map((button) => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
        ratio: (() => { const rect = document.querySelector('canvas')!.getBoundingClientRect(); return rect.width / rect.height; })(),
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.ratio).toBeCloseTo(360 / 580, 2);
    expect(layout.controls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    const intersects = (a: typeof layout.card, b: typeof layout.card) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    expect(intersects(layout.card, layout.hud)).toBe(false);
    expect(intersects(layout.card, layout.wallet)).toBe(false);
    expect(layout.action.top).toBeGreaterThanOrEqual(layout.frame.top);
    expect(layout.action.bottom).toBeLessThanOrEqual(layout.frame.bottom);
    expect(layout.balances.flat().every(({ left, right, surfaceLeft, surfaceRight }) => left >= surfaceLeft && right <= surfaceRight)).toBe(true);
    expect((await page.locator('.wallet-total').nth(0).locator('strong').textContent())?.replace(/\D/g, '')).toBe('1234567');
    expect((await page.locator('.wallet-total').nth(1).locator('strong').textContent())?.replace(/\D/g, '')).toBe('9876543');
    if (viewport.width === 320 && viewport.height === 568) {
      await page.screenshot({ path: testInfo.outputPath('mobile-ready-320x568.png') });
    }
    if (viewport.width === 390 && viewport.height === 844) {
      await page.screenshot({ path: testInfo.outputPath('mobile-ready.png') });
    }
    await page.locator('.screen-panel .primary-button').click();
    await expect(page.locator('.running-score')).toBeVisible();
  }
});

test('touch layouts hide keyboard-only instructions', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeVisible();
  await expect(page.locator('.keyboard-hint')).toBeHidden();
  await context.close();
});

test('running game shows only the score; backgrounding reveals the paused controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeEnabled();
  await page.getByRole('button', { name: /Начать полёт/ }).click();
  await expect(page.locator('.running-score')).toBeVisible();
  await expect(page.locator('.running-score')).toContainText(/^\d+$/);
  await expect(page.getByRole('button', { name: /Пауза|Pause/ })).toHaveCount(0);
  for (const selector of ['.brand', '.best-card', '.menu-trigger', '.wallet-strip', '.screen-card', '.tap-hint']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await changeVisibility(page, true);
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
  for (const selector of ['.brand', '.best-card', '.menu-trigger', '.wallet-strip']) await expect(page.locator(selector)).toBeVisible();
});

test('game frame stays fixed while the running state shows only the score', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeEnabled();
  const frame = page.locator('.game-frame');
  const size = async () => frame.boundingBox();
  const readySize = await size();
  expect(readySize).not.toBeNull();
  expect(await page.locator('.hud').evaluate((node) => node.closest('.game-frame') !== null)).toBe(true);
  expect(await page.locator('.wallet-strip').evaluate((node) => node.closest('.game-frame') !== null)).toBe(true);
  expect(await page.locator('.screen-card').evaluate((node) => node.closest('.game-frame') !== null)).toBe(true);
  await page.getByRole('button', { name: /Начать полёт/ }).click();
  await page.clock.runFor(70);
  const score = page.locator('.running-score');
  await expect(score).toBeVisible();
  await expect(score).toContainText(/^\d+$/);
  await expect(page.getByRole('button', { name: /Пауза|Pause/ })).toHaveCount(0);
  for (const selector of ['.brand', '.best-card', '.menu-trigger', '.wallet-strip', '.screen-card', '.tap-hint']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await page.screenshot({ path: testInfo.outputPath('running-score.png') });
  const runningSize = await size();
  expect(runningSize?.width).toBeCloseTo(readySize!.width, 0);
  expect(runningSize?.height).toBeCloseTo(readySize!.height, 0);
  const canvasInside = await page.locator('canvas').evaluate((canvas) => {
    const frameRect = canvas.closest('.game-frame')!.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      ratio: canvasRect.width / canvasRect.height,
      inside: canvasRect.left >= frameRect.left && canvasRect.top >= frameRect.top
        && canvasRect.right <= frameRect.right && canvasRect.bottom <= frameRect.bottom,
    };
  });
  expect(canvasInside.ratio).toBeCloseTo(360 / 580, 2);
  expect(canvasInside.inside).toBe(true);
  await changeVisibility(page, true);
  await expect(page.getByRole('heading', { name: 'На паузе' })).toBeVisible();
  for (const selector of ['.brand', '.best-card', '.menu-trigger', '.wallet-strip']) await expect(page.locator(selector)).toBeVisible();
  const pauseSize = await size();
  expect(pauseSize?.width).toBeCloseTo(readySize!.width, 0);
  expect(pauseSize?.height).toBeCloseTo(readySize!.height, 0);
  await changeVisibility(page, false);
  await page.getByRole('button', { name: /Продолжить/ }).click();
  await expect(score).toBeVisible();
  await page.clock.runFor(8_000);
  await expect(page.getByRole('heading', { name: 'Хороший заход!' })).toBeVisible({ timeout: 8_000 });
  for (const selector of ['.brand', '.best-card', '.menu-trigger', '.wallet-strip']) await expect(page.locator(selector)).toBeVisible();
  const deadSize = await size();
  expect(deadSize?.width).toBeCloseTo(readySize!.width, 0);
  expect(deadSize?.height).toBeCloseTo(readySize!.height, 0);
  await page.screenshot({ path: testInfo.outputPath('dead-result.png') });
});

test('Telegram viewport and content safe-area insets shape the app shell', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty('--tg-viewport-stable-height', '700px');
    style.setProperty('--tg-safe-area-inset-top', '24px');
    style.setProperty('--tg-safe-area-inset-bottom', '18px');
    style.setProperty('--tg-safe-area-inset-left', '60px');
    style.setProperty('--tg-safe-area-inset-right', '0px');
    style.setProperty('--tg-content-safe-area-inset-top', '12px');
    style.setProperty('--tg-content-safe-area-inset-bottom', '10px');
    style.setProperty('--tg-content-safe-area-inset-left', '12px');
    style.setProperty('--tg-content-safe-area-inset-right', '0px');
  });
  const dimensions = await page.locator('.game-shell').evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    top: getComputedStyle(document.querySelector('.hud')!).top,
    frame: (() => {
      const rect = document.querySelector('.game-frame')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    })(),
    stage: (() => {
      const rect = document.querySelector('.stage')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })(),
    hud: (() => {
      const rect = document.querySelector('.hud')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })(),
    wallet: (() => {
      const rect = document.querySelector('.wallet-strip')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })(),
    panel: (() => {
      const rect = document.querySelector('.screen-panel')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })(),
  }));
  expect(dimensions.height).toBe(700);
  expect(dimensions.top).toBe('10px');
  expect(dimensions.stage.left).toBe(dimensions.frame.left);
  expect(dimensions.stage.right).toBe(dimensions.frame.right);
  expect(dimensions.stage.left).toBeGreaterThanOrEqual(72);
  expect(dimensions.stage.right).toBeLessThanOrEqual(390);
  for (const region of [dimensions.hud, dimensions.wallet, dimensions.panel]) {
    expect(region.left).toBeGreaterThanOrEqual(72);
    expect(region.right).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button', { name: 'Меню' }).click();
    const dialog = await page.getByRole('dialog').boundingBox();
  expect(dialog).not.toBeNull();
  if (dialog) {
    expect(dialog.x).toBeGreaterThanOrEqual(72);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(390);
  }
});

test('side safe areas and a short stable Telegram viewport preserve canvas ratio and the primary action', async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 280 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeVisible();
    await page.evaluate((shortHeight) => {
      const style = document.documentElement.style;
      style.setProperty('--tg-safe-area-inset-left', '24px');
      style.setProperty('--tg-safe-area-inset-right', '28px');
      style.setProperty('--tg-content-safe-area-inset-left', '8px');
      style.setProperty('--tg-content-safe-area-inset-right', '8px');
      style.setProperty('--tg-viewport-stable-height', shortHeight ? '280px' : '844px');
    }, viewport.height < 400);
    await page.locator('.screen-panel .primary-button').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!.getBoundingClientRect();
      const frame = document.querySelector('.game-frame')!.getBoundingClientRect();
      const panel = document.querySelector('.screen-panel')!.getBoundingClientRect();
      const action = document.querySelector<HTMLElement>('.screen-panel .primary-button')!.getBoundingClientRect();
      return { ratio: canvas.width / canvas.height, width: innerWidth, canvasLeft: canvas.left, canvasRight: canvas.right,
        frameTop: frame.top, frameBottom: frame.bottom, panelTop: panel.top, panelBottom: panel.bottom,
        actionTop: action.top, actionBottom: action.bottom, actionHeight: action.height };
    });
    expect(layout.ratio).toBeCloseTo(360 / 580, 2);
    expect(layout.canvasLeft).toBeGreaterThanOrEqual(32);
    expect(layout.canvasRight).toBeLessThanOrEqual(layout.width - 36);
    expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
    expect(layout.actionTop).toBeGreaterThanOrEqual(layout.frameTop);
    expect(layout.actionBottom).toBeLessThanOrEqual(layout.frameBottom);
    await page.locator('.screen-panel .primary-button').click();
    await expect(page.locator('.running-score')).toBeVisible();
  }
});

test('memory-only wallet status fits below the ready action on a small phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked by test policy', 'SecurityError'); } });
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.wallet-storage')).toHaveText('Только в памяти · кошелёк не сохраняется на этом устройстве');
  const layout = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    return { frame: bounds('.game-frame'), wallet: bounds('.wallet-strip'), card: bounds('.screen-card'), action: bounds('.screen-panel .primary-button') };
  });
  expect(layout.wallet.top).toBeGreaterThanOrEqual(layout.frame.top);
  expect(layout.wallet.bottom).toBeLessThanOrEqual(layout.frame.bottom);
  expect(layout.action.bottom).toBeLessThanOrEqual(layout.card.bottom);
  await context.close();
});

test('language dropdown is styled, keyboard operable, persistent, and bounded on phones', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    for (const locale of ['ru', 'en'] as const) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate((value) => localStorage.setItem('doofy-duck:locale:v1', value), locale);
      await page.reload();
      const triggerName = locale === 'ru' ? 'Меню' : 'Menu';
      await page.getByRole('button', { name: triggerName }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(/Telegram Stars \(XTR\)/);
      const selectedName = locale === 'ru' ? 'Русский' : 'English';
      const otherName = locale === 'ru' ? 'English' : 'Русский';
      const languageTrigger = page.getByTestId('language-dropdown-trigger');
      await expect(languageTrigger).toHaveAttribute('aria-haspopup', 'listbox');
      await expect(languageTrigger).toHaveAttribute('aria-expanded', 'false');
      await languageTrigger.focus();
      await page.keyboard.press('ArrowDown');
      const listbox = page.getByRole('listbox', { name: locale === 'ru' ? 'Язык' : 'Language' });
      const selected = page.getByRole('option', { name: selectedName });
      const other = page.getByRole('option', { name: otherName });
      await expect(listbox).toBeVisible();
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(other).toHaveAttribute('aria-selected', 'false');
      await expect(selected).toBeFocused();

      const bounds = await page.evaluate(() => {
        const frame = document.querySelector('.game-frame')!.getBoundingClientRect();
        const panel = document.querySelector('[role="dialog"]')!.getBoundingClientRect();
        const dropdown = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
        return { frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom },
          panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
          dropdown: { left: dropdown.left, top: dropdown.top, right: dropdown.right, bottom: dropdown.bottom } };
      });
      expect(bounds.panel.left).toBeGreaterThanOrEqual(bounds.frame.left);
      expect(bounds.panel.top).toBeGreaterThanOrEqual(bounds.frame.top);
      expect(bounds.panel.right).toBeLessThanOrEqual(bounds.frame.right);
      expect(bounds.panel.bottom).toBeLessThanOrEqual(bounds.frame.bottom);
      expect(bounds.dropdown.left).toBeGreaterThanOrEqual(bounds.panel.left);
      expect(bounds.dropdown.top).toBeGreaterThanOrEqual(bounds.panel.top);
      expect(bounds.dropdown.right).toBeLessThanOrEqual(bounds.panel.right);
      expect(bounds.dropdown.bottom).toBeLessThanOrEqual(bounds.panel.bottom);
      await page.screenshot({ path: testInfo.outputPath(`dropdown-${viewport.width}-${locale}.png`) });

      await page.keyboard.press('ArrowDown');
      await expect(other).toBeFocused();
      await expect(other).toHaveAttribute('aria-selected', 'false');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(languageTrigger).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(() => page.evaluate(() => localStorage.getItem('doofy-duck:locale:v1'))).toBe(locale === 'ru' ? 'en' : 'ru');
      await languageTrigger.click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(languageTrigger).toBeFocused();
      await languageTrigger.click();
      await page.getByRole('button', { name: locale === 'ru' ? 'Sound: on' : 'Звук: вкл.' }).click();
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('.running-score')).toHaveCount(0);
      await languageTrigger.click();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: locale === 'ru' ? 'Sound: on' : 'Звук: вкл.' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: otherName === 'English' ? 'Menu' : 'Меню' })).toBeFocused();
    }
  }
});
