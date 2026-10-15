import { expect, test } from '@playwright/test';

test('only one tab plays persistently; ownership transfers and fresh balances survive reload', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const seedWallet = JSON.stringify({ version: 1, balances: { FEATHER: 5, GAME_STAR: 2 }, settledRunIds: [] });
  await context.addInitScript((raw) => {
    const walletKey = 'doofy-duck:wallet:v1';
    if (localStorage.getItem(walletKey) === null) localStorage.setItem(walletKey, raw);
  }, seedWallet);
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.getByRole('button', { name: /Начать полёт/ })).toBeEnabled();
  await expect(first.getByText('Кошелёк на этом устройстве')).toBeVisible();

  const second = await context.newPage();
  // This case verifies tab ownership, not real-time renderer scheduling.
  await second.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await second.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await second.goto('/');
  await expect(second.getByRole('status')).toHaveText(/Кошелёк занят в другой вкладке/);
  await expect(second.getByRole('button', { name: /Начать полёт/ })).toBeDisabled();
  await second.keyboard.press('Space');
  await expect(second.getByRole('heading', { name: /Привет, путешественник!/ })).toBeVisible();
  await expect(second.getByRole('button', { name: /Начать полёт/ })).toBeDisabled();
  await expect(second.getByRole('button', { name: 'Пауза' })).toHaveCount(0);

  await first.close();
  await second.reload();
  await expect(second.getByText('Кошелёк на этом устройстве')).toBeVisible();
  await expect(second.locator('.wallet-total').nth(0).locator('strong')).toHaveText('5');
  await expect(second.locator('.wallet-total').nth(1).locator('strong')).toHaveText('2');
  await expect(second.getByRole('button', { name: /Начать полёт/ })).toBeEnabled();
  await second.keyboard.press('Space');
  await second.clock.runFor(70);
  await expect(second.locator('.running-score')).toBeVisible();
  await expect(second.getByRole('button', { name: /Пауза|Pause/ })).toHaveCount(0);
  await context.close();
});
