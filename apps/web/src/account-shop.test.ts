import { describe, expect, it, vi } from 'vitest';
import { createPurchaseRecovery, formatDecimalBalance, parseWalletBalances, type PurchaseIntent } from './account-shop';

const intent: PurchaseIntent = {
  accountId: 'account-a',
  quote: {
    quote_id: 'quote-1', catalog_version: 'cosmetics-v1', eligibility_version: 'telegram-account-v1',
    item_type: 'skin', item_id: 'mint', currency: 'FEATHER', amount: '20',
    created_at: '2026-10-17T12:00:00Z', expires_at: '2026-10-17T12:05:00Z',
  },
  idempotencyKey: 'purchase-key-1',
};
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('account shop purchase recovery', () => {
  it('keeps one account-scoped purchase identity across reloads until resolved', () => {
    const storage = memoryStorage();
    const first = createPurchaseRecovery(storage, () => 'generated-key');
    first.retain(intent);

    const reloaded = createPurchaseRecovery(storage, () => 'another-key');

    expect(reloaded.pending('account-a')).toEqual(intent);
    expect(reloaded.pending('account-b')).toBeUndefined();
    expect(reloaded.begin('account-a', intent.quote)).toEqual(intent);
  });

  it('does not replace an uncertain purchase with another key', () => {
    const recovery = createPurchaseRecovery(memoryStorage(), () => 'generated-key');
    recovery.retain(intent);

    expect(() => recovery.begin('account-a', { ...intent.quote, quote_id: 'quote-2' })).toThrow('purchase_resolution_required');
  });

  it('clears the retained identity only after resolving the purchase', () => {
    const recovery = createPurchaseRecovery(memoryStorage(), () => 'generated-key');
    recovery.retain(intent);
    recovery.resolve('account-a');

    expect(recovery.pending('account-a')).toBeUndefined();
  });

  it('disables purchases when operation identity cannot be retained', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: vi.fn() };
    const recovery = createPurchaseRecovery(storage, () => 'generated-key');

    expect(recovery.canRetain).toBe(false);
    expect(() => recovery.begin('account-a', intent.quote)).toThrow('purchase_recovery_storage_unavailable');
  });
});

describe('account wallet values', () => {
  it('accepts only successful authoritative reads containing both exact currency balances', () => {
    expect(parseWalletBalances({ balances: [{ currency: 'FEATHER', balance: '0' }, { currency: 'GAME_STAR', balance: '900719925474099312345' }] }))
      .toEqual({ FEATHER: '0', GAME_STAR: '900719925474099312345' });
    expect(() => parseWalletBalances({ balances: [] })).toThrow('wallet_balance_invalid');
    expect(() => parseWalletBalances(undefined)).toThrow('wallet_balance_invalid');
  });

  it('formats decimal balances with BigInt and keeps huge values exact', () => {
    expect(formatDecimalBalance('900719925474099312345', 'en')).toBe('900,719,925,474,099,312,345');
    expect(formatDecimalBalance('42', 'ru')).toBe('42');
  });

  it('rejects malformed balances rather than rendering them as zero', () => {
    expect(() => formatDecimalBalance('4.2', 'en')).toThrow('wallet_balance_invalid');
  });
});
