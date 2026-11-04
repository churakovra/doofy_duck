import { expect, test } from '@playwright/test';
import { installAccountBackend } from './account-backend.fixture';

test('balances, language choices and shop remain usable on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installAccountBackend(page, { balances: { FEATHER: 1234567, GAME_STAR: 300 } });
  await page.goto('/');
  const wallet = page.locator('.wallet-summary-button');
  await expect(wallet).toContainText('300');
  const amountsFit = await wallet.locator('strong').evaluateAll((nodes) => nodes.every((node) => {
    const box = node.getBoundingClientRect();
    const parent = node.closest('button')!.getBoundingClientRect();
    return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom;
  }));
  expect(amountsFit).toBe(true);
  const hudLayout = await page.evaluate(() => {
    const frame = document.querySelector('.game-frame')!.getBoundingClientRect();
    const score = document.querySelector('.record-group')!.getBoundingClientRect();
    const walletBox = document.querySelector('.account-wallet')!.getBoundingClientRect();
    const actions = document.querySelector('.hud-actions')!.getBoundingClientRect();
    const panel = document.querySelector('.screen-panel')!.getBoundingClientRect();
    const value = document.querySelector<HTMLElement>('.record-group strong')!;
    return { offset: Math.abs((score.left + score.right - frame.left - frame.right) / 2), scoreLeft: score.left, scoreRight: score.right, panelTop: panel.top, walletRight: walletBox.right, actionsLeft: actions.left, controlsTop: Math.min(walletBox.top, actions.top), frameTop: frame.top, controlsBottom: Math.max(walletBox.bottom, actions.bottom), fontSize: parseFloat(getComputedStyle(value).fontSize) };
  });
  expect(hudLayout.offset).toBeLessThan(1);
  expect(hudLayout.controlsTop - hudLayout.frameTop).toBe(18);
  expect(hudLayout.walletRight).toBeLessThanOrEqual(hudLayout.scoreLeft);
  expect(hudLayout.scoreRight).toBeLessThanOrEqual(hudLayout.actionsLeft);
  expect(hudLayout.controlsBottom).toBeLessThanOrEqual(hudLayout.panelTop);
  expect(hudLayout.fontSize).toBeGreaterThanOrEqual(34);
  await page.locator('.menu-trigger').click();
  await page.getByTestId('language-dropdown-trigger').click();
  await expect(page.getByRole('option', { name: 'English' })).toBeVisible();
  await page.getByRole('option', { name: 'English' }).click();
  await expect(page.getByTestId('language-dropdown-trigger')).toContainText('English');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(page.locator('.account-shop-wallet')).toContainText('Star');
  await expect(page.locator('.account-shop-dialog .wardrobe-preview-art')).toBeVisible();
  await expect(page.locator('.account-shop-item.selected')).toContainText('Classic');
  await expect(page.locator('.account-shop-item.selected')).toContainText('Equipped');
  await page.getByRole('button', { name: 'World', exact: true }).click();
  await expect(page.locator('.account-shop-item.selected')).toContainText('Meadow');
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-shop-dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shop', exact: true })).toBeFocused();
});

test('shows full multi-digit records without an ellipsis or overlap', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installAccountBackend(page);
  let bestScore = 987;
  await page.route('**/api/v1/runs/progress', async (route) => route.fulfill({ json: { bestScore } }));
  for (const score of [987, 9876543]) {
    bestScore = score;
    await page.goto('/');
    const value = page.locator('.record-group strong');
    await expect(value).toHaveText(new Intl.NumberFormat('ru-RU').format(score));
    const layout = await value.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const wallet = document.querySelector('.account-wallet')!.getBoundingClientRect();
      const actions = document.querySelector('.hud-actions')!.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: element.scrollWidth, visibleWidth: element.clientWidth, left: rect.left, right: rect.right, walletRight: wallet.right, actionsLeft: actions.left, ellipsis: style.textOverflow };
    });
    expect(layout.width).toBeLessThanOrEqual(layout.visibleWidth);
    expect(layout.ellipsis).not.toBe('ellipsis');
    expect(layout.left).toBeGreaterThanOrEqual(layout.walletRight);
    expect(layout.right).toBeLessThanOrEqual(layout.actionsLeft);
  }
});

test('shop categories select a scrollable item list as the catalog grows', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await installAccountBackend(page);
  await page.route('**/api/v1/shop/catalog', async (route) => {
    const items = (['skin', 'background'] as const).flatMap((itemType) => Array.from({ length: 12 }, (_, index) => ({
      item_type: itemType, item_id: `${itemType}-${index}`, asset_id: `${itemType}-${index}`,
      display_name: { en: `${itemType} ${index}`, ru: `${itemType} ${index}` },
      default: false, available: true, price: { currency: 'FEATHER', amount: '20' },
    })));
    await route.fulfill({ json: { catalog_version: 'large-catalog', enabled: true, items } });
  });
  await page.goto('/');
  await page.locator('.account-shop-trigger').click();
  const row = page.locator('.account-shop-items');
  await expect(page.getByRole('button', { name: 'Утёнок', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const [index, label] of ['Утёнок', 'Мир'].entries()) {
    if (index) await page.getByRole('button', { name: label, exact: true }).click();
    await expect(row.locator('button')).toHaveCount(12);
    expect(await row.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await row.locator('button').last().click();
    await expect(row.locator('button').last()).toHaveAttribute('aria-pressed', 'true');
    expect(await row.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  }
});

test('purchase shows the confirmed price and lets the player cancel', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await installAccountBackend(page);
  await page.route('**/api/v1/shop/catalog', async (route) => route.fulfill({ json: { catalog_version: 'v1', enabled: true, items: [
    { item_type: 'skin', item_id: 'mint', display_name: { en: 'Mint', ru: 'Мята' }, asset_id: 'mint', default: false, available: true, price: { currency: 'FEATHER', amount: '20' } },
  ] } }));
  await page.route('**/api/v1/shop/quotes', async (route) => route.fulfill({ json: {
    quote_id: 'quote-1', catalog_version: 'v1', eligibility_version: 'v1', item_type: 'skin', item_id: 'mint', currency: 'FEATHER', amount: '25', created_at: '2026-10-17T12:00:00Z', expires_at: '2026-10-17T12:05:00Z',
  } }));
  await page.goto('/');
  await page.locator('.account-shop-trigger').click();
  await expect(page.locator('.account-shop-actions button')).toContainText('20');
  await page.locator('.account-shop-actions button').click();
  const confirmation = page.locator('.account-shop-confirmation');
  await expect(confirmation).toContainText('Мята');
  await expect(confirmation.locator('.primary-button')).toContainText('25');
  await confirmation.locator('.control-button').click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.account-shop-actions button')).toContainText('20');
});

test('shop layout stays in place when an equip action appears', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await installAccountBackend(page);
  await page.route('**/api/v1/shop/catalog', async (route) => route.fulfill({ json: { catalog_version: 'v1', enabled: true, items: [
    { item_type: 'skin', item_id: 'classic', display_name: { en: 'Classic', ru: 'Классика' }, asset_id: 'classic', default: true, available: true, price: null },
    { item_type: 'skin', item_id: 'mint', display_name: { en: 'Mint', ru: 'Мята' }, asset_id: 'mint', default: false, available: true, price: { currency: 'FEATHER', amount: '20' } },
  ] } }));
  await page.route('**/api/v1/shop/inventory**', async (route) => route.fulfill({ json: { items: [{ item_type: 'skin', item_id: 'classic' }, { item_type: 'skin', item_id: 'mint' }], next_cursor: null } }));
  await page.goto('/');
  await page.locator('.account-shop-trigger').click();
  const dialog = page.locator('.account-shop-dialog');
  const row = page.locator('.account-shop-items');
  await expect(row.locator('button')).toHaveCount(2);
  const before = await dialog.boundingBox();
  const rowBefore = await row.boundingBox();
  await expect(page.locator('.account-shop-actions button')).toBeDisabled();
  await expect(page.locator('.account-shop-actions button')).toHaveText('Надето');
  await row.locator('button').nth(1).click();
  await expect(page.locator('.account-shop-actions button')).toBeEnabled();
  await expect(page.locator('.account-shop-actions button')).toHaveText('Надеть');
  const after = await dialog.boundingBox();
  const rowAfter = await row.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(after?.height).toBe(before?.height);
  expect(rowAfter?.y).toBe(rowBefore?.y);
});
