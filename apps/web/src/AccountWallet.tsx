import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDecimalBalance, parseWalletBalances, type WalletBalances } from './account-shop';
import type { AccountApi } from './account-api';
import type { Locale } from './locale';
import type { MessageCatalog } from './messages.ru';

export type WalletSettlementStatus = 'pending' | 'ineligible' | 'actionable_failure' | 'unavailable' | 'committed' | null;
type Props = {
  api: Pick<AccountApi, 'walletBalances'>;
  accountId: string;
  sessionEpoch: number;
  locale: Locale;
  messages: MessageCatalog;
  refreshKey: number;
  suspended: boolean;
  settlement: WalletSettlementStatus;
  onRetrySettlement?(): void;
};

export function AccountWallet({ api, accountId, sessionEpoch, locale, messages, refreshKey, suspended, settlement, onRetrySettlement }: Props) {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [walletError, setWalletError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [retryTick, setRetryTick] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const openRef = useRef(false);
  const openOriginRef = useRef<'automatic' | 'user' | null>(null);
  const syncIssueRef = useRef(false);
  const scopeRef = useRef({ accountId, sessionEpoch });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, []);

  useLayoutEffect(() => {
    if (scopeRef.current.accountId === accountId && scopeRef.current.sessionEpoch === sessionEpoch) return;
    scopeRef.current = { accountId, sessionEpoch };
    requestRef.current += 1;
    setBalances(null);
    setWalletError(false);
    setLoading(false);
    setRetryCount(0);
    openRef.current = false;
    openOriginRef.current = null;
    setOpen(false);
  }, [accountId, sessionEpoch]);

  const refresh = useCallback(async () => {
    if (suspended) return;
    const requestedAccount = accountId;
    const requestedEpoch = sessionEpoch;
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const next = parseWalletBalances(await api.walletBalances());
      if (!mountedRef.current || requestId !== requestRef.current || scopeRef.current.accountId !== requestedAccount || scopeRef.current.sessionEpoch !== requestedEpoch) return;
      setBalances(next);
      setWalletError(false);
      setRetryCount(0);
    } catch {
      if (!mountedRef.current || requestId !== requestRef.current || scopeRef.current.accountId !== requestedAccount || scopeRef.current.sessionEpoch !== requestedEpoch) return;
      setWalletError(true);
      setRetryCount((current) => current + 1);
    } finally {
      if (mountedRef.current && requestId === requestRef.current && scopeRef.current.accountId === requestedAccount && scopeRef.current.sessionEpoch === requestedEpoch) setLoading(false);
    }
  }, [accountId, api, sessionEpoch, suspended]);

  useEffect(() => {
    if (suspended) return;
    void refresh();
  }, [refresh, refreshKey, retryTick]);

  useEffect(() => {
    if (walletError && !suspended) {
      const delay = Math.min(5_000 * (2 ** Math.min(retryCount - 1, 3)), 30_000);
      const timer = window.setTimeout(() => setRetryTick((tick) => tick + 1), delay);
      return () => window.clearTimeout(timer);
    }
  }, [retryCount, suspended, walletError]);

  const settlementIssue = settlement === 'unavailable' || settlement === 'actionable_failure';
  const syncIssue = walletError || settlementIssue;
  useEffect(() => {
    const hadIssue = syncIssueRef.current;
    if (syncIssue && !hadIssue && !openRef.current) {
      openRef.current = true;
      openOriginRef.current = 'automatic';
      setOpen(true);
    } else if (!syncIssue && hadIssue && openOriginRef.current === 'automatic') {
      openRef.current = false;
      openOriginRef.current = null;
      setOpen(false);
    }
    syncIssueRef.current = syncIssue;
  }, [syncIssue]);

  const closeFromOutside = () => {
    openRef.current = false;
    openOriginRef.current = null;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFromOutside();
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!popupRef.current?.parentElement?.contains(event.target as Node)) closeFromOutside();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  const toggleFromTrigger = () => {
    const next = !openRef.current;
    openRef.current = next;
    openOriginRef.current = next ? 'user' : null;
    setOpen(next);
  };

  const retry = () => {
    setRetryTick((tick) => tick + 1);
    onRetrySettlement?.();
  };
  const settlementFailureCopy = settlement === 'unavailable' ? messages.accountShopSettlementUnavailable
    : settlement === 'actionable_failure' ? messages.accountSettlementActionableFailure : '';
  const featherValue = balances ? formatDecimalBalance(balances.FEATHER, locale) : '—';
  const starValue = balances ? formatDecimalBalance(balances.GAME_STAR, locale) : '—';
  const accessibleSummary = `${messages.walletSummaryLabel}. ${messages.accountShopCurrencyFeather}: ${featherValue}; ${messages.accountShopCurrencyStar}: ${starValue}`;

  return <div className={`account-wallet${walletError || settlementIssue ? ' has-sync-issue' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
    <button ref={triggerRef} type="button" className="wallet-summary-button" aria-label={accessibleSummary} aria-haspopup="dialog" aria-expanded={open} aria-controls="account-wallet-popup" onClick={toggleFromTrigger}>
      <span className="wallet-total"><svg className="wallet-token coin-token" aria-hidden="true" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.2" fill="#f0bd45" stroke="#a96f16" strokeWidth="1.2" /><circle cx="10" cy="10" r="6.1" fill="none" stroke="#ffedaa" strokeWidth="0.8" /><path d="m10 6.1 2.2 3.9-2.2 3.9-2.2-3.9z" fill="#fff2bd" stroke="#b47b20" strokeWidth="0.7" /></svg><strong title={featherValue}>{featherValue}</strong></span>
      <span className="wallet-total"><span className="wallet-token star-token" aria-hidden="true">★</span><strong title={starValue}>{starValue}</strong></span>
      {(walletError || settlementIssue || settlement === 'pending') && <span className="wallet-sync-indicator" aria-hidden="true" />}
    </button>
    {open && <div ref={popupRef} id="account-wallet-popup" className="wallet-popup" role="dialog" aria-label={messages.walletPopupHeading}>
      <strong>{messages.walletPopupHeading}</strong>
      {walletError && <><p className="wallet-popup-error" role="alert">{messages.walletReadFailed}</p>{balances && <p>{messages.walletStale}</p>}</>}
      {settlementFailureCopy && <p className="wallet-popup-error" role="alert">{settlementFailureCopy}</p>}
      <button type="button" className="wallet-refresh-button" onClick={retry} disabled={loading}>{messages.walletRetry}</button>
    </div>}
  </div>;
}
