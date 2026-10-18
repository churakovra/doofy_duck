// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountWallet } from './AccountWallet';
import { messages as messagesRu } from './messages.ru';

describe('AccountWallet', () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    vi.useRealTimers();
  });

  it('shows authoritative balances and keeps sync failures in its wallet popup until a successful retry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const api = { walletBalances: vi.fn()
      .mockResolvedValueOnce({ balances: [{ currency: 'FEATHER', balance: '42' }, { currency: 'GAME_STAR', balance: '0' }] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ balances: [{ currency: 'FEATHER', balance: '50' }, { currency: 'GAME_STAR', balance: '3' }] }) };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    const props = { api: api as never, accountId: 'wallet-account', sessionEpoch: 1, locale: 'ru' as const, messages: messagesRu,
      refreshKey: 0, suspended: false, settlement: null };
    await act(async () => { root.render(<AccountWallet {...props} />); });
    await vi.waitFor(() => expect(host.textContent).toContain('42'));
    expect(host.querySelector('.wallet-summary-button')?.textContent).not.toContain('Монеты');
    expect(host.querySelector('.wallet-summary-button')?.textContent).not.toContain('Игровые звёзды');
    expect(host.querySelector('.wallet-summary-button')?.getAttribute('aria-label')).toContain('Монеты: 42');
    expect(host.querySelector('.wallet-summary-button')?.getAttribute('aria-label')).toContain('Игровые звёзды: 0');
    expect(host.querySelector('svg.wallet-token.coin-token[aria-hidden="true"]')).not.toBeNull();

    await act(async () => { host.querySelector<HTMLButtonElement>('.wallet-summary-button')?.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.wallet-refresh-button')?.click(); });
    await vi.waitFor(() => expect(host.querySelector('[role="dialog"]')).not.toBeNull());
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('42');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(messagesRu.walletReadFailed);

    await act(async () => { host.querySelector<HTMLButtonElement>('.wallet-refresh-button')?.click(); });
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeNull());
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('50');
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('3');
  });

  it('shows an unavailable initial balance as unknown, then clears the stale marker after recovery', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const api = { walletBalances: vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ balances: [{ currency: 'FEATHER', balance: '0' }, { currency: 'GAME_STAR', balance: '0' }] }) };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(<AccountWallet api={api as never} accountId="first-read" sessionEpoch={1} locale="ru" messages={messagesRu} refreshKey={0} suspended={false} settlement={null} />); });
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('—');
    expect(host.querySelector('.wallet-summary-button')?.textContent).not.toContain('0');
    expect(host.querySelector('.wallet-popup-error')?.textContent).toContain(messagesRu.walletReadFailed);

    await act(async () => { host.querySelector<HTMLButtonElement>('.wallet-refresh-button')?.click(); });
    await vi.waitFor(() => expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('0'));
    expect(host.querySelector('.wallet-popup-error')).toBeNull();
    expect(host.querySelector('.wallet-summary-button')?.className).not.toContain('stale');
  });

  it('keeps the healthy wallet popup free of settlement progress and success copy', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const api = { walletBalances: vi.fn().mockResolvedValue({ balances: [{ currency: 'FEATHER', balance: '4' }, { currency: 'GAME_STAR', balance: '1' }] }) };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(<AccountWallet api={api as never} accountId="healthy" sessionEpoch={1} locale="ru" messages={messagesRu} refreshKey={0} suspended={false} settlement="committed" />); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.wallet-summary-button')?.click(); });
    const popup = host.querySelector('[role="dialog"]')!;
    expect(popup.textContent).toContain('Кошелёк');
    expect(popup.textContent).toContain('Обновить');
    expect(popup.textContent).not.toContain('Зачислено');
    expect(popup.querySelector('[role="status"]')).toBeNull();
  });

  it('clears old-account totals and ignores a late read from the previous account', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let finishOld!: (value: unknown) => void;
    const api = { walletBalances: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ balances: [{ currency: 'FEATHER', balance: '8' }, { currency: 'GAME_STAR', balance: '2' }] }) };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(<AccountWallet api={api as never} accountId="old" sessionEpoch={1} locale="ru" messages={messagesRu} refreshKey={0} suspended={false} settlement={null} />); });
    await act(async () => { root.render(<AccountWallet api={api as never} accountId="new" sessionEpoch={2} locale="ru" messages={messagesRu} refreshKey={0} suspended={false} settlement={null} />); });
    await vi.waitFor(() => expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('8'));
    await act(async () => { finishOld({ balances: [{ currency: 'FEATHER', balance: '999' }, { currency: 'GAME_STAR', balance: '999' }] }); });
    expect(host.querySelector('.wallet-summary-button')?.textContent).not.toContain('999');
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('8');
  });

  it('keeps a dismissed outage popup closed during backoff, closes after recovery, and reopens on a later failure', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    const api = { walletBalances: vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce({ balances: [{ currency: 'FEATHER', balance: '4' }, { currency: 'GAME_STAR', balance: '1' }] })
      .mockRejectedValueOnce(new Error('offline again')) };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    const props = { api: api as never, accountId: 'backoff-account', sessionEpoch: 1, locale: 'ru' as const, messages: messagesRu,
      refreshKey: 0, suspended: false, settlement: null };
    await act(async () => { root.render(<AccountWallet {...props} />); });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.wallet-summary-button'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(api.walletBalances).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(api.walletBalances).toHaveBeenCalledTimes(3);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('4');

    await act(async () => { root.render(<AccountWallet {...props} refreshKey={1} />); });
    expect(api.walletBalances).toHaveBeenCalledTimes(4);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
