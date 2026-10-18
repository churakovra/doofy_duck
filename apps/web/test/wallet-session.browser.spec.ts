import { expect, test } from '@playwright/test';
import { installAccountBackend, prepareAccountFlight } from './account-backend.fixture';

test('Telegram account restores across tabs and starts a server-backed run', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installAccountBackend(context, { balances: { FEATHER: 5, GAME_STAR: 2 } });
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.locator('.account-id')).toHaveText('100000001');

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('.account-id')).toHaveText('100000001');
  await first.reload();
  await expect(first.locator('.account-id')).toHaveText('100000001');
  await prepareAccountFlight(first);
  await expect(first.locator('canvas')).toHaveCount(1);
  const balanceImport = await first.evaluate(() => Object.keys(localStorage).filter((key) => /wallet|balance|coin/i.test(key)));
  expect(balanceImport).toEqual([]);
  await second.close();
  await first.close();
  await context.close();
});
