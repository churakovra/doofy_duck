import type { Locale } from './locale';

export type ShopItemType = 'skin' | 'background';
export type ShopCurrency = 'FEATHER' | 'GAME_STAR';
export type ShopPrice = Readonly<{ currency: ShopCurrency; amount: string }>;
export type ShopCatalogItem = Readonly<{
  item_type: ShopItemType;
  item_id: string;
  display_name: Readonly<{ en: string; ru: string }>;
  asset_id: string;
  default: boolean;
  available: boolean;
  price: ShopPrice | null;
}>;
export type ShopCatalog = Readonly<{ catalog_version: string; enabled: boolean; items: readonly ShopCatalogItem[] }>;
export type ShopQuote = Readonly<{
  quote_id: string; catalog_version: string; eligibility_version: string;
  item_type: ShopItemType; item_id: string; currency: ShopCurrency; amount: string;
  created_at: string; expires_at: string;
}>;
export type PurchaseIntent = Readonly<{ accountId: string; quote: ShopQuote; idempotencyKey: string }>;

const recoveryKey = 'doofy-duck:account-shop-pending:v1';
const probeKey = `${recoveryKey}:probe`;
const maxAccounts = 8;
const maxBytes = 32_768;

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isShopType(value: unknown): value is ShopItemType { return value === 'skin' || value === 'background'; }
function isCurrency(value: unknown): value is ShopCurrency { return value === 'FEATHER' || value === 'GAME_STAR'; }
function isDecimal(value: unknown): value is string { return typeof value === 'string' && /^(0|[1-9]\d{0,39})$/.test(value); }
export function isValidShopQuote(value: unknown): value is ShopQuote {
  if (!value || typeof value !== 'object') return false;
  const quote = value as Partial<ShopQuote>;
  return typeof quote.quote_id === 'string' && quote.quote_id.length > 0
    && typeof quote.catalog_version === 'string' && typeof quote.eligibility_version === 'string'
    && isShopType(quote.item_type) && typeof quote.item_id === 'string' && quote.item_id.length > 0
    && isCurrency(quote.currency) && isDecimal(quote.amount)
    && typeof quote.created_at === 'string' && Number.isFinite(Date.parse(quote.created_at))
    && typeof quote.expires_at === 'string' && Number.isFinite(Date.parse(quote.expires_at))
    && Date.parse(quote.expires_at) > Date.parse(quote.created_at);
}
function validIntent(value: unknown): value is PurchaseIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<PurchaseIntent>;
  return typeof intent.accountId === 'string' && intent.accountId.length > 0
    && isValidShopQuote(intent.quote) && typeof intent.idempotencyKey === 'string'
    && intent.idempotencyKey.trim() === intent.idempotencyKey && intent.idempotencyKey.length > 0 && intent.idempotencyKey.length <= 128;
}
function readRecords(storage: RecoveryStorage): Record<string, PurchaseIntent> {
  try {
    const raw = storage.getItem(recoveryKey);
    if (!raw || raw.length > maxBytes) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([key, record]) => key.length <= 128 && validIntent(record) && record.accountId === key).slice(0, maxAccounts));
  } catch { return {}; }
}

export function createPurchaseRecovery(storage: RecoveryStorage | undefined, keyFactory: () => string = () => crypto.randomUUID()) {
  let canRetain = false;
  if (storage) {
    try { storage.setItem(probeKey, '1'); storage.removeItem(probeKey); canRetain = true; }
    catch { canRetain = false; }
  }
  const write = (records: Record<string, PurchaseIntent>) => {
    if (!storage || !canRetain) throw new Error('purchase_recovery_storage_unavailable');
    const raw = JSON.stringify(records);
    if (raw.length > maxBytes) throw new Error('purchase_recovery_storage_full');
    storage.setItem(recoveryKey, raw);
  };
  return {
    get canRetain() { return canRetain; },
    pending(accountId: string): PurchaseIntent | undefined { return readRecords(storage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })[accountId]; },
    begin(accountId: string, quote: ShopQuote): PurchaseIntent {
      const records = readRecords(storage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
      const pending = records[accountId];
      if (pending) {
        if (pending.quote.quote_id === quote.quote_id) return pending;
        throw new Error('purchase_resolution_required');
      }
      if (!canRetain) throw new Error('purchase_recovery_storage_unavailable');
      if (Object.keys(records).length >= maxAccounts) throw new Error('purchase_recovery_storage_full');
      const intent: PurchaseIntent = { accountId, quote, idempotencyKey: keyFactory() };
      if (intent.idempotencyKey.trim() !== intent.idempotencyKey || intent.idempotencyKey.length < 1 || intent.idempotencyKey.length > 128) {
        throw new Error('purchase_idempotency_key_invalid');
      }
      records[accountId] = intent;
      write(records);
      return intent;
    },
    retain(intent: PurchaseIntent): void {
      if (!validIntent(intent)) throw new Error('purchase_intent_invalid');
      const records = readRecords(storage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
      if (records[intent.accountId] && records[intent.accountId]?.idempotencyKey !== intent.idempotencyKey) throw new Error('purchase_resolution_required');
      records[intent.accountId] = intent;
      write(records);
    },
    resolve(accountId: string): void {
      const records = readRecords(storage ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
      delete records[accountId];
      if (!storage || !canRetain) return;
      if (Object.keys(records).length) write(records);
      else storage.removeItem(recoveryKey);
    },
  };
}

export function formatDecimalBalance(value: string, locale: Locale): string {
  if (!isDecimal(value)) throw new Error('wallet_balance_invalid');
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 }).format(BigInt(value));
}
