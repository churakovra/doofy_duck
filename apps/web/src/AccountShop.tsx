import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AccountApi, AccountApiError } from './account-api';
import { accountShopAppearance } from './account-shop-assets';
import { createPurchaseRecovery, formatDecimalBalance, isValidShopQuote, type PurchaseIntent, type ShopCatalog, type ShopCatalogItem, type ShopCurrency, type ShopItemType, type ShopQuote } from './account-shop';
import { GameButton } from './GameButton';
import { GameWardrobePreview } from './GameWardrobePreview';
import type { Locale } from './locale';
import type { MessageCatalog } from './messages.ru';
import type { Equipment } from './wardrobe';

type Props = {
  api: AccountApi; accountId: string; sessionEpoch: number; locale: Locale; messages: MessageCatalog;
  portalContainer: RefObject<HTMLElement | null>; open: boolean; onOpenChange(open: boolean): void;
  equipment: Equipment; onEquipment(equipment: Equipment): void;
};
type WalletBalances = Readonly<Record<ShopCurrency, string>>;
type InventoryPage = { items: readonly { item_type: ShopItemType; item_id: string }[]; next_cursor: string | null };
type EquipmentRow = { item_type: ShopItemType; item_id: string; revision: number };

function validDecimal(value: unknown): value is string { return typeof value === 'string' && /^(0|[1-9]\d{0,39})$/.test(value); }
function validType(value: unknown): value is ShopItemType { return value === 'skin' || value === 'background'; }
function parseWallet(value: unknown): WalletBalances {
  const rows = (value as { balances?: unknown } | null)?.balances;
  if (!Array.isArray(rows)) throw new Error('wallet_balance_invalid');
  const balances: Partial<Record<ShopCurrency, string>> = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as { currency?: unknown; balance?: unknown };
    if ((entry.currency === 'FEATHER' || entry.currency === 'GAME_STAR') && validDecimal(entry.balance)) balances[entry.currency] = entry.balance;
  }
  if (!balances.FEATHER || !balances.GAME_STAR) throw new Error('wallet_balance_invalid');
  return { FEATHER: balances.FEATHER, GAME_STAR: balances.GAME_STAR };
}
function parseCatalog(value: unknown): ShopCatalog {
  const catalog = value as Partial<ShopCatalog> | null;
  if (!catalog || typeof catalog.catalog_version !== 'string' || typeof catalog.enabled !== 'boolean' || !Array.isArray(catalog.items)) throw new Error('shop_catalog_invalid');
  const items = catalog.items.filter((item): item is ShopCatalogItem => Boolean(item && validType(item.item_type)
    && typeof item.item_id === 'string' && item.item_id.length > 0 && typeof item.asset_id === 'string'
    && typeof item.available === 'boolean' && typeof item.default === 'boolean' && item.display_name
    && typeof item.display_name.en === 'string' && typeof item.display_name.ru === 'string'
    && (item.price === null || (item.price && (item.price.currency === 'FEATHER' || item.price.currency === 'GAME_STAR') && validDecimal(item.price.amount)))));
  if (items.length !== catalog.items.length || items.length > 100) throw new Error('shop_catalog_invalid');
  return { catalog_version: catalog.catalog_version, enabled: catalog.enabled, items };
}
function parseEquipment(value: unknown): EquipmentRow[] {
  const rows = (value as { equipment?: unknown } | null)?.equipment;
  if (!Array.isArray(rows)) throw new Error('shop_equipment_invalid');
  return rows.filter((row): row is EquipmentRow => Boolean(row && typeof row === 'object' && validType(row.item_type)
    && typeof row.item_id === 'string' && Number.isSafeInteger(row.revision) && row.revision > 0));
}
function parseInventory(value: unknown): InventoryPage {
  const page = value as { items?: unknown; next_cursor?: unknown } | null;
  if (!Array.isArray(page?.items) || (page.next_cursor !== null && typeof page.next_cursor !== 'string')) throw new Error('shop_inventory_invalid');
  const items = page.items.filter((item): item is { item_type: ShopItemType; item_id: string } => Boolean(item && typeof item === 'object'
    && validType((item as { item_type?: unknown }).item_type) && typeof (item as { item_id?: unknown }).item_id === 'string'));
  if (items.length !== page.items.length) throw new Error('shop_inventory_invalid');
  return { items, next_cursor: page.next_cursor };
}
function errorCopy(error: unknown, messages: MessageCatalog): string {
  if (!(error instanceof AccountApiError)) return messages.accountShopUnavailable;
  if (error.code === 'insufficient_funds') return messages.accountShopInsufficient;
  if (error.code === 'expired_quote') return messages.accountShopExpired;
  if (error.code === 'stale_quote' || error.code === 'already_owned') return messages.accountShopStale;
  if (error.code === 'shop_disabled') return messages.accountShopDisabled;
  if (error.status === 401 || error.code === 'account_session_required' || error.code === 'account_session_expired') return messages.accountSessionExpired;
  return error.status >= 500 || error.status === 0 ? messages.accountShopUnavailable : messages.accountShopPurchaseFailed;
}
function isDefinitivePurchaseFailure(error: unknown): boolean {
  return error instanceof AccountApiError && ['insufficient_funds', 'expired_quote', 'stale_quote', 'already_owned'].includes(error.code);
}
function localStorageOrUndefined(): Storage | undefined { try { return window.localStorage; } catch { return undefined; } }

export function AccountShop({ api, accountId, sessionEpoch, locale, messages, portalContainer, open, onOpenChange, equipment, onEquipment }: Props) {
  const [recovery] = useState(() => createPurchaseRecovery(localStorageOrUndefined()));
  const [catalog, setCatalog] = useState<ShopCatalog | null>(null);
  const [loadedAccount, setLoadedAccount] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletBalances | null>(null);
  const [owned, setOwned] = useState<ReadonlySet<string>>(new Set());
  const [revisions, setRevisions] = useState<Partial<Record<ShopItemType, number>>>({});
  const [tab, setTab] = useState<ShopItemType>('skin');
  const [selected, setSelected] = useState<ShopCatalogItem | null>(null);
  const [quote, setQuote] = useState<ShopQuote | null>(null);
  const [pending, setPending] = useState<PurchaseIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const scopeRef = useRef({ accountId, sessionEpoch, epoch: 0, mounted: true });
  const quoteRequestRef = useRef(0);
  const equipmentRef = useRef(equipment);
  equipmentRef.current = equipment;
  const lookupStartedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    scopeRef.current.mounted = true;
    return () => {
      scopeRef.current.mounted = false;
      scopeRef.current.epoch += 1;
      quoteRequestRef.current += 1;
    };
  }, []);
  useLayoutEffect(() => {
    if (scopeRef.current.accountId === accountId && scopeRef.current.sessionEpoch === sessionEpoch) return;
    scopeRef.current.accountId = accountId;
    scopeRef.current.sessionEpoch = sessionEpoch;
    scopeRef.current.epoch += 1;
    quoteRequestRef.current += 1;
  }, [accountId, sessionEpoch]);
  const isCurrentScope = useCallback((account: string, epoch: number) => scopeRef.current.mounted
    && scopeRef.current.accountId === account && scopeRef.current.epoch === epoch, []);

  const refresh = useCallback(async () => {
    const requestedAccount = accountId;
    const requestEpoch = scopeRef.current.epoch;
    setBusy(true); setError('');
    try {
      const [catalogValue, walletValue, equipmentValue] = await Promise.all([api.shopCatalog(), api.walletBalances(), api.shopEquipment()]);
      if (!isCurrentScope(requestedAccount, requestEpoch)) return;
      const parsedCatalog = parseCatalog(catalogValue);
      const balances = parseWallet(walletValue);
      const rows = parseEquipment(equipmentValue);
      const inventory = new Set<string>();
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        if (!isCurrentScope(requestedAccount, requestEpoch)) return;
        const page = parseInventory(await api.shopInventory(cursor));
        if (!isCurrentScope(requestedAccount, requestEpoch)) return;
        for (const item of page.items) inventory.add(`${item.item_type}:${item.item_id}`);
        if (!page.next_cursor) break;
        if (seen.has(page.next_cursor)) throw new Error('shop_inventory_cursor_invalid');
        seen.add(page.next_cursor); cursor = page.next_cursor;
        if (pageIndex === 9) throw new Error('shop_inventory_page_limit_exceeded');
      }
      if (!isCurrentScope(requestedAccount, requestEpoch)) return;
      const equippedRows = rows.reduce((result, row) => ({ ...result, [row.item_type]: row }), {} as Partial<Record<ShopItemType, EquipmentRow>>);
      const nextEquipment = {
        skinId: equippedRows.skin?.item_id ?? 'classic',
        backgroundId: equippedRows.background?.item_id ?? 'meadow',
      };
      setCatalog(parsedCatalog); setWallet(balances); setOwned(inventory);
      setLoadedAccount(requestedAccount);
      setRevisions({
        ...(equippedRows.skin ? { skin: equippedRows.skin.revision } : {}),
        ...(equippedRows.background ? { background: equippedRows.background.revision } : {}),
      });
      onEquipment(nextEquipment);
      setSelected((current) => current && parsedCatalog.items.find((item) => item.item_type === current.item_type && item.item_id === current.item_id) || parsedCatalog.items[0] || null);
      setPending(recovery.pending(requestedAccount) ?? null);
    } catch (reason) {
      if (isCurrentScope(requestedAccount, requestEpoch)) setError(errorCopy(reason, messages));
    } finally { if (isCurrentScope(requestedAccount, requestEpoch)) setBusy(false); }
  }, [accountId, api, isCurrentScope, messages, onEquipment, recovery]);

  useEffect(() => {
    setLoadedAccount(null); setCatalog(null); setWallet(null); setOwned(new Set()); setPending(recovery.pending(accountId) ?? null); setQuote(null); setError(''); setNotice(''); lookupStartedRef.current = null;
  }, [accountId, recovery, sessionEpoch]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh, sessionEpoch]);
  useEffect(() => {
    if (!open) return;
    const initial = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    initial?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onOpenChange(false); }
      if (event.key === 'Tab' && dialogRef.current) {
        const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        if (event.shiftKey && (document.activeElement === controls[0] || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && (document.activeElement === controls.at(-1) || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const items = useMemo(() => catalog?.items.filter((item) => item.item_type === tab) ?? [], [catalog, tab]);
  const skinItem = catalog?.items.find((item) => item.item_type === 'skin' && item.item_id === equipment.skinId);
  const backgroundItem = catalog?.items.find((item) => item.item_type === 'background' && item.item_id === equipment.backgroundId);
  const previewAppearance = selected
    ? selected.item_type === 'skin'
      ? { ...accountShopAppearance(selected), world: accountShopAppearance(backgroundItem ?? catalog?.items.find((item) => item.item_type === 'background') ?? selected).world }
      : { ...accountShopAppearance(selected), duck: accountShopAppearance(skinItem ?? catalog?.items.find((item) => item.item_type === 'skin') ?? selected).duck }
    : undefined;
  const keyFor = (item: ShopCatalogItem) => `${item.item_type}:${item.item_id}`;
  const isSelectedOwned = selected ? owned.has(keyFor(selected)) : false;

  const equip = async (item: ShopCatalogItem) => {
    if (!catalog?.enabled || !owned.has(keyFor(item))) return;
    const revision = revisions[item.item_type];
    if (!revision) { setError(messages.accountShopRefreshRequired); return; }
    setBusy(true); setError(''); setNotice('');
    const requestedAccount = accountId;
    const requestEpoch = scopeRef.current.epoch;
    try {
      const row = await api.setShopEquipment(item.item_type, item.item_id, revision);
      if (!isCurrentScope(requestedAccount, requestEpoch)) return;
      const next = { ...equipmentRef.current, [item.item_type === 'skin' ? 'skinId' : 'backgroundId']: row.item_id };
      setRevisions((current) => ({ ...current, [item.item_type]: row.revision })); onEquipment(next); setNotice(messages.accountShopEquipped);
    } catch (reason) {
      if (!isCurrentScope(requestedAccount, requestEpoch)) return;
      if (reason instanceof AccountApiError && reason.code === 'stale_equipment' && reason.current && typeof reason.current === 'object') {
        const current = reason.current as EquipmentRow;
        if (validType(current.item_type) && typeof current.item_id === 'string' && Number.isSafeInteger(current.revision)) {
          setRevisions((rows) => ({ ...rows, [current.item_type]: current.revision }));
          onEquipment({ ...equipmentRef.current, [current.item_type === 'skin' ? 'skinId' : 'backgroundId']: current.item_id });
        }
        setError(messages.accountShopEquipmentConflict);
      } else setError(errorCopy(reason, messages));
    } finally { if (isCurrentScope(requestedAccount, requestEpoch)) setBusy(false); }
  };

  const resolvePending = async (intent: PurchaseIntent, requestEpoch = scopeRef.current.epoch) => {
    if (intent.accountId !== accountId || !isCurrentScope(intent.accountId, requestEpoch)) return;
    lookupStartedRef.current = intent.idempotencyKey;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.shopPurchaseLookup(intent.idempotencyKey);
      if (!isCurrentScope(intent.accountId, requestEpoch)) return;
      recovery.resolve(intent.accountId); setPending(null); setQuote(null);
      const purchase = (result as { purchase?: { item_type?: ShopItemType; item_id?: string } }).purchase;
      if (purchase?.item_type && purchase.item_id) setOwned((current) => new Set([...current, `${purchase.item_type}:${purchase.item_id}`]));
      setNotice(messages.accountShopPurchaseResolved);
      void refresh();
    } catch (reason) {
      if (!isCurrentScope(intent.accountId, requestEpoch)) return;
      setPending(intent);
      if (reason instanceof AccountApiError && reason.status === 404) {
        setError(messages.accountShopPending);
      } else if (reason instanceof AccountApiError && (reason.status === 401 || reason.code === 'account_session_required' || reason.code === 'account_session_expired')) {
        setError(errorCopy(reason, messages));
      } else setError(messages.accountShopPending);
    } finally { if (isCurrentScope(intent.accountId, requestEpoch)) setBusy(false); }
  };
  useEffect(() => {
    if (!open || loadedAccount !== accountId || !pending || pending.accountId !== accountId || busy || lookupStartedRef.current === pending.idempotencyKey) return;
    lookupStartedRef.current = pending.idempotencyKey;
    void resolvePending(pending);
  }, [accountId, busy, loadedAccount, open, pending]);
  const submitPurchase = async (intent: PurchaseIntent, requestEpoch = scopeRef.current.epoch) => {
    if (intent.accountId !== accountId || !isCurrentScope(intent.accountId, requestEpoch)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.shopPurchase(intent.quote.quote_id, intent.idempotencyKey);
      if (!isCurrentScope(intent.accountId, requestEpoch)) return;
      recovery.resolve(intent.accountId); setPending(null); setQuote(null);
      const purchase = (result as { purchase?: { item_type?: ShopItemType; item_id?: string } }).purchase;
      if (purchase?.item_type && purchase.item_id) setOwned((current) => new Set([...current, `${purchase.item_type}:${purchase.item_id}`]));
      setNotice(messages.accountShopPurchaseResolved); void refresh();
    } catch (reason) {
      if (!isCurrentScope(intent.accountId, requestEpoch)) return;
      if (!isDefinitivePurchaseFailure(reason)) {
        setPending(intent); setError(messages.accountShopPending);
        await resolvePending(intent, requestEpoch);
      } else {
        recovery.resolve(intent.accountId); setPending(null); setQuote(null); setError(errorCopy(reason, messages));
      }
    } finally { if (isCurrentScope(intent.accountId, requestEpoch)) setBusy(false); }
  };
  const requestQuote = async (item: ShopCatalogItem) => {
    if (!catalog?.enabled || !item.available || recovery.pending(accountId)) return;
    setBusy(true); setError(''); setNotice('');
    const requestedAccount = accountId;
    const requestEpoch = scopeRef.current.epoch;
    const quoteRequest = ++quoteRequestRef.current;
    try {
      const serverQuote = await api.shopQuote(item.item_type, item.item_id);
      if (!isCurrentScope(requestedAccount, requestEpoch) || quoteRequest !== quoteRequestRef.current) return;
      if (!isValidShopQuote(serverQuote) || serverQuote.item_id !== item.item_id || serverQuote.item_type !== item.item_type) throw new Error('shop_quote_invalid');
      setQuote(serverQuote);
    } catch (reason) { if (isCurrentScope(requestedAccount, requestEpoch) && quoteRequest === quoteRequestRef.current) setError(errorCopy(reason, messages)); }
    finally { if (isCurrentScope(requestedAccount, requestEpoch)) setBusy(false); }
  };
  const confirmPurchase = () => {
    if (!quote || !selected || selected.item_type !== quote.item_type || selected.item_id !== quote.item_id || !recovery.canRetain) return;
    try {
      const intent = recovery.begin(accountId, quote);
      setPending(intent);
      void submitPurchase(intent);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === 'purchase_resolution_required' ? messages.accountShopPending : messages.accountShopStorageWarning);
    }
  };
  const currencyName = (currency: ShopCurrency) => currency === 'FEATHER' ? messages.accountShopCurrencyFeather : messages.accountShopCurrencyStar;
  const balance = (currency: ShopCurrency) => wallet ? formatDecimalBalance(wallet[currency], locale) : '—';
  const quotedItem = quote && catalog?.items.find((item) => item.item_type === quote.item_type && item.item_id === quote.item_id);

  return <>
    <GameButton variant="control" className="account-shop-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)}>{messages.accountShopLabel}</GameButton>
    {open && portalContainer.current && createPortal(<div className="settings-backdrop account-shop-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <section ref={dialogRef} className="settings-dialog account-shop-dialog" role="dialog" aria-modal="true" aria-labelledby="account-shop-heading" tabIndex={-1}>
        <header className="settings-dialog-header"><h2 id="account-shop-heading">{messages.accountShopHeading}</h2><GameButton variant="control" className="settings-close" aria-label={messages.wardrobeCloseLabel} onClick={() => onOpenChange(false)}>×</GameButton></header>
        <div className="account-shop-wallet" aria-label={messages.accountShopWallet}>
          <h3>{messages.accountShopWallet}</h3>
          <p><span>{messages.accountShopCurrencyFeather}</span><strong>{wallet ? balance('FEATHER') : '—'}</strong></p>
          <p><span>{messages.accountShopCurrencyStar}</span><strong>{wallet ? balance('GAME_STAR') : '—'}</strong></p>
          <small>{messages.accountShopStarNote}</small>
        </div>
        {recovery.canRetain ? <p className="account-shop-recovery-note">{messages.accountShopStorageWarningSaved}</p> : <p className="wallet-access-error" role="alert">{messages.accountShopStorageWarning}</p>}
        {loadedAccount === accountId && catalog && !catalog.enabled && <p className="wallet-access-error" role="status">{messages.accountShopDisabled}</p>}
        {busy && loadedAccount !== accountId && <p role="status">{messages.accountShopLoading}</p>}
        {previewAppearance && selected && <>
          <GameWardrobePreview appearance={previewAppearance} label={messages.accountShopHeading} />
          <p className="account-shop-selected"><strong>{selected.display_name[locale]}</strong><span>{messages.accountShopTestVisual}</span></p>
        </>}
        <div className="account-shop-tabs" role="tablist" aria-label={messages.accountShopHeading}>
          <button type="button" role="tab" aria-selected={tab === 'skin'} data-dialog-initial-focus onClick={() => { quoteRequestRef.current += 1; setQuote(null); setTab('skin'); setSelected(catalog?.items.find((item) => item.item_type === 'skin') ?? null); }}>{messages.accountShopSkins}</button>
          <button type="button" role="tab" aria-selected={tab === 'background'} onClick={() => { quoteRequestRef.current += 1; setQuote(null); setTab('background'); setSelected(catalog?.items.find((item) => item.item_type === 'background') ?? null); }}>{messages.accountShopWorlds}</button>
        </div>
        <div className="account-shop-items" role="tabpanel">
          {loadedAccount === accountId && items.map((item) => {
            const isOwned = owned.has(keyFor(item));
            const isEquipped = item.item_type === 'skin' ? equipment.skinId === item.item_id : equipment.backgroundId === item.item_id;
            const isSelected = selected?.item_id === item.item_id && selected.item_type === item.item_type;
            const price = item.price ? `${formatDecimalBalance(item.price.amount, locale)} ${currencyName(item.price.currency)}` : messages.accountShopOwned;
            return <button key={`${item.item_type}:${item.item_id}`} type="button" className={`account-shop-item${isSelected ? ' selected' : ''}`} aria-pressed={isSelected} onClick={() => { quoteRequestRef.current += 1; setSelected(item); setQuote(null); }}>
              <span className="account-shop-item-title">{item.display_name[locale]}</span>
              <span className="account-shop-item-price">{isEquipped ? messages.accountShopEquipped : isOwned ? messages.accountShopOwned : price}</span>
            </button>;
          })}
          {!items.length && catalog && <p>{messages.accountShopUnavailable}</p>}
        </div>
        {loadedAccount === accountId && selected && <div className="account-shop-actions">
          {isSelectedOwned
            ? <GameButton variant={selected && ((selected.item_type === 'skin' && equipment.skinId === selected.item_id) || (selected.item_type === 'background' && equipment.backgroundId === selected.item_id)) ? 'control' : 'primary'} onClick={() => void equip(selected)} disabled={busy || !catalog?.enabled || (selected.item_type === 'skin' ? equipment.skinId === selected.item_id : equipment.backgroundId === selected.item_id)}>{messages.accountShopEquip}</GameButton>
            : <GameButton variant="primary" onClick={() => void requestQuote(selected)} disabled={busy || !catalog?.enabled || !selected.available || !selected.price || !recovery.canRetain || Boolean(pending)}>{messages.accountShopBuy}</GameButton>}
        </div>}
        {quote && <section className="account-shop-confirmation" aria-label={messages.accountShopQuote}>
          <p><strong>{quotedItem?.display_name[locale] ?? quote.item_id}</strong></p>
          <p><strong>{messages.accountShopQuote}:</strong> {formatDecimalBalance(quote.amount, locale)} {currencyName(quote.currency)}</p>
          <p>{messages.accountShopExpires}: <time dateTime={quote.expires_at}>{new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(quote.expires_at))}</time></p>
          <GameButton variant="primary" onClick={confirmPurchase} disabled={busy || !recovery.canRetain}>{messages.accountShopConfirm}</GameButton>
          <GameButton variant="control" onClick={() => setQuote(null)} disabled={busy}>{messages.accountShopCancel}</GameButton>
        </section>}
        {loadedAccount === accountId && pending?.accountId === accountId && <section className="account-shop-pending" role="status"><p>{messages.accountShopPending}</p><GameButton variant="control" onClick={() => void resolvePending(pending)} disabled={busy}>{messages.accountShopResolve}</GameButton><GameButton variant="control" onClick={() => void submitPurchase(pending)} disabled={busy}>{messages.accountShopRetry}</GameButton></section>}
        {error && <p className="wallet-access-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <GameButton variant="control" onClick={() => void refresh()} disabled={busy}>{messages.accountShopRefresh}</GameButton>
      </section>
    </div>, portalContainer.current)}
  </>;
}
