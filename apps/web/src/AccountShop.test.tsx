// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountShop } from './AccountShop';
import { AccountApi, AccountApiError } from './account-api';
import { messages as en } from './messages.en';

vi.mock('./GameWardrobePreview', () => ({ GameWardrobePreview: () => <div data-testid="preview" /> }));

const catalog = {
  catalog_version: 'cosmetics-v1', enabled: true,
  items: [
    { item_type: 'skin', item_id: 'classic', display_name: { en: 'Classic', ru: 'Классика' }, asset_id: 'classic', default: true, available: true, price: null },
    { item_type: 'skin', item_id: 'mint', display_name: { en: 'Mint', ru: 'Мята' }, asset_id: 'mint', default: false, available: true, price: { currency: 'FEATHER', amount: '20' } },
    { item_type: 'background', item_id: 'nebula', display_name: { en: 'Nebula', ru: 'Туманность' }, asset_id: 'nebula', default: false, available: true, price: { currency: 'GAME_STAR', amount: '100' } },
  ],
};

function buildApi(overrides: Record<string, unknown> = {}) {
  return {
    shopCatalog: vi.fn().mockResolvedValue(catalog),
    walletBalances: vi.fn().mockResolvedValue({ balances: [{ currency: 'FEATHER', balance: '900719925474099312345' }, { currency: 'GAME_STAR', balance: '100' }] }),
    shopEquipment: vi.fn().mockResolvedValue({ equipment: [{ item_type: 'skin', item_id: 'classic', revision: 1 }, { item_type: 'background', item_id: 'meadow', revision: 1 }] }),
    shopInventory: vi.fn().mockResolvedValue({ items: [{ item_type: 'skin', item_id: 'classic' }], next_cursor: null }),
    shopQuote: vi.fn().mockResolvedValue({ quote_id: 'quote-1', catalog_version: 'cosmetics-v1', eligibility_version: 'telegram-account-v1', item_type: 'skin', item_id: 'mint', currency: 'FEATHER', amount: '20', created_at: '2026-10-17T12:00:00Z', expires_at: '2026-10-17T12:05:00Z' }),
    shopPurchase: vi.fn().mockResolvedValue({ purchase: { item_type: 'skin', item_id: 'mint', status: 'committed' }, current_balance: '42' }),
    shopPurchaseLookup: vi.fn(),
    setShopEquipment: vi.fn(),
    ...overrides,
  } as unknown as AccountApi;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('account cosmetic shop', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: AccountApi;
  const equipment = { skinId: 'classic', backgroundId: 'meadow' };
  const onEquipment = vi.fn();
  const onOpenChange = vi.fn();
  const render = (open = true, accountId = 'account-a', sessionEpoch = 0, equipped = equipment) => act(() => root.render(<AccountShop api={api} accountId={accountId} sessionEpoch={sessionEpoch} locale="en" messages={en} portalContainer={{ current: host }} open={open} onOpenChange={onOpenChange} equipment={equipped} onEquipment={onEquipment} />));
  const click = (selector: string) => act(() => { host.querySelector<HTMLElement>(selector)!.click(); });

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    api = buildApi();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it('shows exact account balances and asks for confirmation using the server quote before buying', async () => {
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain('900,719,925,474,099,312,345');
    expect(host.textContent).toContain('In-game Stars are separate from Telegram Stars (XTR).');
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });

    expect(host.textContent).toContain('20 Coins');
    expect(host.querySelector('.account-shop-confirmation')?.textContent).toContain('Mint');
    expect(api.shopPurchase).not.toHaveBeenCalled();
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-confirmation .primary-button')!.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(api.shopPurchase).toHaveBeenCalledWith('quote-1', expect.any(String));
    expect(host.textContent).toContain('Purchase confirmed. The item is now owned.');
  });

  it('hides equip when the selected skin is already equipped', async () => {
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector('.account-shop-item.selected')?.textContent).toContain('Classic');
    expect(host.querySelector('.account-shop-actions')).toBeNull();
  });

  it('hides equip when the selected world is already equipped', async () => {
    await act(async () => { render(true, 'account-a', 0, { ...equipment, backgroundId: 'nebula' }); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-tabs button:nth-child(2)');
    expect(host.querySelector('.account-shop-item.selected')?.textContent).toContain('Nebula');
    expect(host.querySelector('.account-shop-actions')).toBeNull();
  });

  it('brings the first selected item into view when switching shop categories', async () => {
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    const skinItems = host.querySelector<HTMLElement>('.account-shop-items')!;
    skinItems.scrollLeft = 180;

    click('.account-shop-tabs button:nth-child(2)');

    const worldItems = host.querySelector<HTMLElement>('.account-shop-items')!;
    expect(worldItems.scrollLeft).toBe(0);
    expect(host.querySelector('.account-shop-item.selected')?.textContent).toContain('Nebula');
  });

  it('keeps equip visible for an owned item that is not equipped', async () => {
    api = buildApi({ shopInventory: vi.fn().mockResolvedValue({ items: [{ item_type: 'skin', item_id: 'classic' }, { item_type: 'skin', item_id: 'mint' }], next_cursor: null }) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    expect(host.querySelector('.account-shop-actions button')?.textContent).toContain('Equip');
    expect(host.querySelector<HTMLButtonElement>('.account-shop-actions button')?.disabled).toBe(false);
  });

  it('does not present a malformed server quote as a purchase price', async () => {
    api = buildApi({ shopQuote: vi.fn().mockResolvedValue({
      quote_id: 'quote-1', catalog_version: 'cosmetics-v1', eligibility_version: 'telegram-account-v1',
      item_type: 'skin', item_id: 'mint', currency: 'XTR', amount: '20',
      created_at: '2026-10-17T12:00:00Z', expires_at: 'not-a-date',
    }) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });

    expect(host.querySelector('.account-shop-confirmation')).toBeNull();
    expect(host.textContent).toContain('The account shop is unavailable. Balances are not shown as zero.');
    expect(api.shopPurchase).not.toHaveBeenCalled();
  });

  it('keeps the same purchase identity when lookup returns 404 before the original POST settles', async () => {
    const purchasePost = deferred<unknown>();
    api = buildApi({
      shopPurchase: vi.fn().mockReturnValueOnce(purchasePost.promise).mockResolvedValueOnce({ purchase: { item_type: 'skin', item_id: 'mint' } }),
      shopPurchaseLookup: vi.fn().mockRejectedValue(new AccountApiError(404, 'http_404')),
    });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-confirmation .primary-button')!.click(); await Promise.resolve(); });
    const stored = JSON.parse(localStorage.getItem('doofy-duck:account-shop-pending:v1')!);
    purchasePost.reject(new AccountApiError(0, 'network_error'));
    await act(async () => { await purchasePost.promise.catch(() => undefined); await Promise.resolve(); await Promise.resolve(); });

    expect(host.querySelector('.account-shop-pending')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('doofy-duck:account-shop-pending:v1')!)['account-a']).toEqual(stored['account-a']);
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-pending button:last-child')!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(api.shopPurchase).toHaveBeenCalledTimes(2);
    expect(api.shopPurchase).toHaveBeenLastCalledWith(stored['account-a'].quote.quote_id, stored['account-a'].idempotencyKey);
  });

  it('retains purchase recovery and shows reopen guidance after a refreshed account mismatch', async () => {
    api = buildApi({
      shopPurchase: vi.fn().mockRejectedValue(new AccountApiError(409, 'account_session_identity_mismatch')),
      shopPurchaseLookup: vi.fn().mockRejectedValue(new AccountApiError(409, 'account_session_identity_mismatch')),
    });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-confirmation .primary-button')!.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(host.querySelector('.account-shop-pending')).not.toBeNull();
    expect(host.textContent).toContain('Open the game from Telegram, then retry the connection.');
    expect(JSON.parse(localStorage.getItem('doofy-duck:account-shop-pending:v1')!)['account-a']).toBeDefined();
  });

  it('clears purchase recovery after a definitive insufficient-funds response', async () => {
    api = buildApi({ shopPurchase: vi.fn().mockRejectedValue(new AccountApiError(409, 'insufficient_funds')) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-confirmation .primary-button')!.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(host.textContent).toContain('There are not enough funds for this purchase.');
    expect(localStorage.getItem('doofy-duck:account-shop-pending:v1')).toBeNull();
    expect(host.querySelector('.account-shop-pending')).toBeNull();
  });

  it('ignores a delayed purchase failure after the shop unmounts for another account', async () => {
    const purchasePost = deferred<unknown>();
    api = buildApi({
      shopPurchase: vi.fn().mockReturnValue(purchasePost.promise),
      shopPurchaseLookup: vi.fn().mockRejectedValue(new AccountApiError(404, 'http_404')),
    });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-confirmation .primary-button')!.click(); await Promise.resolve(); });
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<AccountShop api={api} accountId="account-b" sessionEpoch={0} locale="en" messages={en} portalContainer={{ current: host }} open={false} onOpenChange={onOpenChange} equipment={equipment} onEquipment={onEquipment} />); });
    purchasePost.reject(new AccountApiError(0, 'network_error'));
    await act(async () => { await purchasePost.promise.catch(() => undefined); await Promise.resolve(); await Promise.resolve(); });

    expect(api.shopPurchaseLookup).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('doofy-duck:account-shop-pending:v1')!)['account-a']).toBeDefined();
  });

  it('ignores a delayed purchase failure after the account session changes', async () => {
    const purchasePost = deferred<unknown>();
    api = buildApi({ shopPurchase: vi.fn().mockReturnValue(purchasePost.promise) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-confirmation .primary-button')!.click(); await Promise.resolve(); });
    render(false, 'account-a', 1);
    purchasePost.reject(new AccountApiError(0, 'network_error'));
    await act(async () => { await purchasePost.promise.catch(() => undefined); await Promise.resolve(); await Promise.resolve(); });

    expect(api.shopPurchaseLookup).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('doofy-duck:account-shop-pending:v1')!)['account-a']).toBeDefined();
  });

  it('discards a late quote when the player selects a different item', async () => {
    const quoteRequest = deferred<never>();
    api = buildApi({ shopQuote: vi.fn().mockReturnValue(quoteRequest.promise) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(2)');
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-actions button')!.click(); await Promise.resolve(); });
    click('.account-shop-item:nth-child(1)');
    quoteRequest.resolve({ quote_id: 'quote-1', catalog_version: 'cosmetics-v1', eligibility_version: 'telegram-account-v1', item_type: 'skin', item_id: 'mint', currency: 'FEATHER', amount: '20', created_at: '2026-10-17T12:00:00Z', expires_at: '2026-10-17T12:05:00Z' } as never);
    await act(async () => { await quoteRequest.promise; await Promise.resolve(); });

    expect(host.querySelector('.account-shop-confirmation')).toBeNull();
  });

  it('disables offer and equipment mutations while the server catalog gate is off', async () => {
    api = buildApi({ shopCatalog: vi.fn().mockResolvedValue({ ...catalog, enabled: false }) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });
    click('button.account-shop-item');

    expect(host.textContent).toContain('Purchases and equipment changes are temporarily disabled.');
    expect(host.querySelector('.account-shop-actions')).toBeNull();
  });

  it('shows a missing balance as unavailable and never formats it as zero', async () => {
    api = buildApi({ walletBalances: vi.fn().mockRejectedValue(new Error('offline')) });
    await act(async () => { render(); await Promise.resolve(); await Promise.resolve(); });

    expect(host.textContent).toContain('The account shop is unavailable. Balances are not shown as zero.');
    expect(host.textContent).not.toContain('0');
  });
});
