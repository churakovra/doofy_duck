// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, createRunDescriptor } from '@doofy-duck/game-sim';
import { AccountGame } from './AccountGame';
import { AccountApiError } from './account-api';
import { TelegramWebAppUnavailableError } from './telegram-web-app';
import { LocaleProvider } from './locale';
import { DEFAULT_APPEARANCE } from './appearance';
import { accountEquipmentAppearance } from './account-shop-assets';
import { messages as messagesEn } from './messages.en';
import { messages as messagesRu } from './messages.ru';

const harness = vi.hoisted(() => ({
  restore: vi.fn(), loadTelegramWebApp: vi.fn(), currentRun: vi.fn(), latestRun: vi.fn(), createRun: vi.fn(), getRun: vi.fn(), submitCheckpoint: vi.fn(),
  takeover: vi.fn(), abandon: vi.fn(), login: vi.fn(), loginDev: vi.fn(), logout: vi.fn(), progress: vi.fn(),
  shopEquipment: vi.fn(), walletBalances: vi.fn(), completion: vi.fn(),
  clearAccount: vi.fn(),
  gameAppearance: null as unknown,
  runCanPlay: null as null | (() => boolean), runRuntimeError: '', runScore: 0,
  traceRecords: new Map<string, unknown>(), save: vi.fn(), runPhase: 'READY', runOptions: null as null | { initialState?: { descriptor?: { simulationVersion: string; generatorVersion: string; configId: string }; config?: { wetland?: { catalogVersion?: number } } }; onTick(state: unknown, inputs: readonly unknown[]): void },
}));

vi.mock('./telegram-web-app', async () => {
  const actual = await vi.importActual<typeof import('./telegram-web-app')>('./telegram-web-app');
  return { ...actual, loadTelegramWebApp: harness.loadTelegramWebApp };
});

vi.mock('./account-api', () => ({
  AccountApi: class {
    cancelPendingRequests = vi.fn();
    restore = harness.restore;
    currentRun = harness.currentRun;
    latestRun = harness.latestRun;
    createRun = harness.createRun;
    getRun = harness.getRun;
    submitCheckpoint = harness.submitCheckpoint;
    takeover = harness.takeover;
    abandon = harness.abandon;
    login = harness.login;
    loginDev = harness.loginDev;
    logout = harness.logout;
    progress = harness.progress;
    shopEquipment = harness.shopEquipment;
    walletBalances = harness.walletBalances;
    completion = harness.completion;
  },
  AccountApiError: class AccountApiError extends Error {
    constructor(readonly status = 500, readonly code = 'unknown') { super(code); }
  },
}));

vi.mock('./account-trace', async () => {
  const actual = await vi.importActual<typeof import('./account-trace')>('./account-trace');
  return {
    ...actual,
    createAccountTraceStorage: () => ({
      persistent: true,
      load: async (accountId: string, runId: string) => harness.traceRecords.get(`${accountId}:${runId}`),
      save: harness.save.mockImplementation(async (trace: { accountId: string; runId: string }) => {
        harness.traceRecords.set(`${trace.accountId}:${trace.runId}`, trace);
      }),
      remove: async (accountId: string, runId: string) => { harness.traceRecords.delete(`${accountId}:${runId}`); },
      clearAccount: harness.clearAccount,
    }),
  };
});

vi.mock('./GameCanvas', () => ({ GameCanvas: (props: { appearance: unknown }) => { harness.gameAppearance = props.appearance; return <canvas />; } }));
vi.mock('./GameSettings', () => ({ GameSettings: (props: { open?: boolean; onOpenChange?(open: boolean): void; setLocale(locale: 'ru' | 'en'): void }) => <>
  <button aria-label="Меню" onClick={() => props.onOpenChange?.(!props.open)}>Menu</button>
  {props.open && <div role="dialog"><button data-testid="switch-locale" onClick={() => props.setLocale('en')}>English</button></div>}
</> }));
vi.mock('./AccountShop', () => ({ AccountShop: (props: { open?: boolean; onOpenChange?(open: boolean): void }) => <button className="account-shop-trigger" onClick={() => props.onOpenChange?.(!props.open)}>Shop</button> }));
vi.mock('./GameWardrobe', () => ({ GameWardrobe: () => null }));
vi.mock('./useGameAudio', () => ({ useGameAudio: () => ({
  unlockFromGesture: vi.fn(), flap: vi.fn(), pickup: vi.fn(), setPhase: vi.fn(),
  preferences: { sound: true, music: true }, toggle: vi.fn(),
}) }));
vi.mock('./useGameRun', () => ({ useGameRun: (canPlay: () => boolean, _callbacks: unknown, options: typeof harness.runOptions) => {
  harness.runCanPlay = canPlay;
  harness.runOptions = options;
  return {
    phase: harness.runPhase, score: harness.runScore, runtimeError: harness.runRuntimeError, rendererReady: true, flightCapReached: false,
    getState: () => ({ phase: harness.runPhase, tick: 1, totals: {} }), getFeedback: () => ({}),
    acceptRenderer: vi.fn(), start: vi.fn(), pause: vi.fn(), restart: vi.fn(),
    onFieldPointerDown: vi.fn(), onFieldPointerUp: vi.fn(),
  };
} }));

const account = { account_id: 'account-a', telegram_user_id: 7, created_at: 'now' };
const initialState = createRun(createRunDescriptor({ runId: '00000000-0000-4000-8000-000000000007', seed: 7 }));
const runSnapshot = (changes: Record<string, unknown> = {}) => ({
  runId: initialState.descriptor.runId, accountId: account.account_id, lifeIndex: 1,
  seed: 7, simulationVersion: initialState.descriptor.simulationVersion,
  generatorVersion: initialState.descriptor.generatorVersion, configId: initialState.descriptor.configId,
  state: initialState, status: 'active', verificationStatus: 'in_progress', deliveryStatus: 'not_ready', checkpointSequence: -1, writerGeneration: 1,
  activeTicks: 0, activeTickLimit: 216_000, submissionDeadline: '2099-01-01T00:00:00Z', writerToken: 'writer', ...changes,
});
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let restoreLocks = () => undefined;

beforeEach(async () => {
  vi.stubEnv('VITE_DD_DEV_AUTH_ENABLED', 'true');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  harness.traceRecords.clear(); harness.runPhase = 'READY'; harness.runOptions = null; harness.runCanPlay = null; harness.runScore = 0; harness.runRuntimeError = '';
  harness.restore.mockResolvedValue(account);
  harness.restore.mockClear(); harness.login.mockClear(); harness.loginDev.mockClear(); harness.logout.mockClear(); harness.loadTelegramWebApp.mockClear();
  harness.loginDev.mockResolvedValue(account);
  harness.loadTelegramWebApp.mockResolvedValue({ initData: '', ready: vi.fn() });
  harness.progress.mockResolvedValue({ bestScore: 0 });
  harness.shopEquipment.mockResolvedValue({ equipment: [{ item_type: 'skin', item_id: 'classic', revision: 1 }, { item_type: 'background', item_id: 'meadow', revision: 1 }] });
  harness.walletBalances.mockReset().mockResolvedValue({ balances: [{ currency: 'FEATHER', balance: '0' }, { currency: 'GAME_STAR', balance: '0' }] });
  harness.completion.mockResolvedValue({ status: 'pending', reason: 'settlement_disabled', credited: { FEATHER: '0', GAME_STAR: '0' } });
  harness.clearAccount.mockImplementation(async (accountId: string) => {
    for (const key of harness.traceRecords.keys()) if (key.startsWith(`${accountId}:`)) harness.traceRecords.delete(key);
  });
  harness.logout.mockResolvedValue(undefined);
  harness.currentRun.mockResolvedValue(undefined);
  harness.latestRun.mockResolvedValue(undefined);
  harness.createRun.mockResolvedValue(runSnapshot());
  harness.submitCheckpoint.mockReset();
  harness.getRun.mockResolvedValue(runSnapshot());
  harness.save.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<LocaleProvider><AccountGame /></LocaleProvider>); });
  await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
});

afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks();
  restoreLocks(); restoreLocks = () => undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('account run transport', () => {
  it('starts and checkpoints the varied-base descriptor supplied by Core', async () => {
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(harness.createRun).toHaveBeenCalled());

    expect(harness.runOptions?.initialState).toMatchObject({
      descriptor: { simulationVersion: '3.1.0', generatorVersion: '3.1.0', configId: 'dd-v3-varied-base-v1' },
      config: { wetland: { catalogVersion: 12 } },
    });
  });

  it('orders the compact top row as wallet, record, shop, then menu', () => {
    const header = host.querySelector<HTMLElement>('.account-hud')!;
    expect(header.querySelector('.brand')).toBeNull();
    expect([...header.children].map((child) => child.classList.contains('account-wallet') ? 'wallet'
      : child.classList.contains('score-group') ? 'record'
        : child.classList.contains('hud-actions') ? 'actions' : 'other')).toEqual(['wallet', 'record', 'actions']);
    const actions = header.querySelector('.hud-actions')!;
    expect([...actions.querySelectorAll('button')].map((button) => button.classList.contains('account-shop-trigger') ? 'shop' : 'menu')).toEqual(['shop', 'menu']);
    expect(header.querySelector('.score-group')?.textContent).toContain(messagesRu.bestScoreLabel);
  });

  it('applies account equipment in a compact branded idle lobby', async () => {
    const equipment = { skinId: 'royal', backgroundId: 'winter' };
    harness.shopEquipment.mockResolvedValue({ equipment: [
      { item_type: 'skin', item_id: equipment.skinId, revision: 2 },
      { item_type: 'background', item_id: equipment.backgroundId, revision: 3 },
    ] });
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="equipped-idle" /></LocaleProvider>); });
    await vi.waitFor(() => expect(harness.gameAppearance).toEqual(accountEquipmentAppearance(equipment)));
    expect(host.querySelectorAll('.account-panel h1')).toHaveLength(1);
    expect(host.querySelector('.account-panel h1')?.textContent).toContain('Утёнок');
    expect(host.querySelector('.account-panel .instruction')).toBeNull();
    expect(host.querySelector('.wallet-status-strip')).toBeNull();
    expect(host.querySelector('.account-id')).toBeNull();
  });

  it('passes the same equipped appearance into the active flight canvas', async () => {
    const equipment = { skinId: 'rose', backgroundId: 'dusk' };
    harness.shopEquipment.mockResolvedValue({ equipment: [
      { item_type: 'skin', item_id: equipment.skinId, revision: 2 },
      { item_type: 'background', item_id: equipment.backgroundId, revision: 3 },
    ] });
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="equipped-flight" /></LocaleProvider>); });
    await vi.waitFor(() => expect(harness.gameAppearance).toEqual(accountEquipmentAppearance(equipment)));
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
        .find((button) => button.textContent?.includes('Играть'))?.click();
    });
    await vi.waitFor(() => expect(harness.createRun).toHaveBeenCalled());
    expect(harness.gameAppearance).toEqual(accountEquipmentAppearance(equipment));
    harness.runPhase = 'DEAD';
    await act(async () => { root.render(<LocaleProvider><AccountGame key="equipped-flight" /></LocaleProvider>); });
    expect(host.querySelector('.account-panel h1')?.textContent).toContain(messagesRu.completedHeading);
    expect(host.querySelector('.game-frame.result-screen')).not.toBeNull();
    expect(host.querySelector('.account-hud .account-shop-trigger')).toBeTruthy();
    expect(host.querySelector('.account-panel .wallet-disclaimer')).toBeNull();
    expect(host.querySelector('.earnings-summary span')?.textContent).toBe('Находки');
    expect(host.querySelector('.account-panel')?.textContent).not.toContain('ожидает проверки');
    expect(harness.gameAppearance).toEqual(accountEquipmentAppearance(equipment));
  });

  it('wires the account HUD, settings and shop gates through a translated live flight', async () => {
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
        .find((button) => button.textContent?.includes('Играть'))?.click();
    });
    await vi.waitFor(() => expect(harness.createRun).toHaveBeenCalled());
    harness.runPhase = 'RUNNING';
    await act(async () => { root.render(<LocaleProvider><AccountGame /></LocaleProvider>); });

    const canvas = host.querySelector('canvas');
    expect(host.querySelector('.hud.account-hud')).not.toBeNull();
    expect(host.querySelector('.running-score')?.tagName).toBe('OUTPUT');
    expect(host.querySelector('.running-score')?.textContent).toBe('0');
    expect(host.querySelector('.wallet-strip, .practice-mode, .mode-selector')).toBeNull();
    expect(harness.runCanPlay?.()).toBe(true);

    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Меню"]')?.click(); });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(harness.runCanPlay?.()).toBe(false);
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="switch-locale"]')?.click(); });
    expect(document.documentElement.lang).toBe('en');
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(harness.runCanPlay?.()).toBe(false);
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Меню"]')?.click(); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.runCanPlay?.()).toBe(true);
  });

  it('gates ready-flight input while the account shop is open and translates runtime errors', async () => {
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
        .find((button) => button.textContent?.includes('Играть'))?.click();
    });
    await vi.waitFor(() => expect(harness.createRun).toHaveBeenCalled());
    await act(async () => { root.render(<LocaleProvider><AccountGame /></LocaleProvider>); });
    expect(harness.runCanPlay?.()).toBe(true);
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-trigger')?.click(); });
    expect(harness.runCanPlay?.()).toBe(false);
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-trigger')?.click(); });
    expect(harness.runCanPlay?.()).toBe(true);

    harness.runRuntimeError = 'graphicsStartupError';
    await act(async () => { root.render(<LocaleProvider><AccountGame /></LocaleProvider>); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(messagesRu.graphicsStartupError);
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Меню"]')?.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="switch-locale"]')?.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(messagesEn.graphicsStartupError);
  });

  it('refreshes authoritative wallet totals when the shop closes', async () => {
    const readsBeforeShop = harness.walletBalances.mock.calls.length;
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-trigger')?.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-shop-trigger')?.click(); });
    await vi.waitFor(() => expect(harness.walletBalances.mock.calls.length).toBeGreaterThan(readsBeforeShop));
  });

  it('automatically uses only the configured development identity and exposes no account controls', async () => {
    const foreignAccount = { account_id: 'foreign-cookie-account', telegram_user_id: 88, created_at: 'now' };
    harness.restore.mockResolvedValue(foreignAccount);
    harness.loginDev.mockResolvedValueOnce(account);
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="configured-launch-identity" /></LocaleProvider>); });

    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    expect(harness.restore).not.toHaveBeenCalled();
    expect(harness.loginDev).toHaveBeenCalledWith(100000001);
    expect(host.querySelector('input')).toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => /sign in|войти|выйти|telegram/i.test(button.textContent ?? ''))).toBe(false);
  });

  it('blocks a production launch without Telegram init data even when a cookie session exists', async () => {
    await act(async () => { root.unmount(); });
    vi.stubEnv('VITE_DD_DEV_AUTH_ENABLED', 'false');
    harness.restore.mockResolvedValue(account);
    harness.loadTelegramWebApp.mockResolvedValue({ initData: '', ready: vi.fn() });
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="production-no-launch-data" /></LocaleProvider>); });

    await vi.waitFor(() => expect(host.textContent).toContain('Открой игру из Telegram'));
    expect(host.querySelector('.account-shop-trigger')).toBeNull();
    expect(harness.restore).not.toHaveBeenCalled();
    expect([...host.querySelectorAll('button')].some((button) => /войти|telegram/i.test(button.textContent ?? ''))).toBe(false);
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.includes('Повторить подключение'))).toBe(true);
  });

  it('retries with the same frozen Telegram launch data after an authentication failure', async () => {
    await act(async () => { root.unmount(); });
    harness.loadTelegramWebApp.mockResolvedValue({ initData: 'first-launch-identity', ready: vi.fn() });
    harness.login.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503, code: 'unavailable' }));
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="frozen-launch-identity" /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.textContent).toContain('Повторить подключение'));

    harness.loadTelegramWebApp.mockResolvedValue({ initData: 'changed-launch-identity', ready: vi.fn() });
    harness.login.mockResolvedValueOnce(account);
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Повторить подключение'))?.click();
    });
    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    expect(harness.login).toHaveBeenNthCalledWith(1, 'first-launch-identity');
    expect(harness.login).toHaveBeenNthCalledWith(2, 'first-launch-identity');
  });

  it('shows a retry after local authentication cannot reach the backend', async () => {
    harness.restore.mockRejectedValueOnce(new Error('no saved session'));
    harness.loginDev.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503, code: 'unavailable' }));
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="local-login-retry" /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.querySelector('.account-panel')?.textContent).toContain('Повторить подключение'));
    harness.loginDev.mockResolvedValueOnce(account);
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Повторить подключение'))?.click();
    });
    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
  });

  it('uses Telegram init data before a restored development session', async () => {
    await act(async () => { root.unmount(); });
    harness.restore.mockClear().mockResolvedValue(account);
    harness.login.mockClear().mockResolvedValue(account);
    harness.loadTelegramWebApp.mockResolvedValue({ initData: 'signed-telegram-init-data', ready: vi.fn() });
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="telegram-priority" /></LocaleProvider>); });
    await vi.waitFor(() => expect(harness.login).toHaveBeenCalledWith('signed-telegram-init-data'));
    expect(harness.restore).not.toHaveBeenCalled();
  });

  it('uses default equipment after a fresh Telegram launch when the new account wardrobe read fails', async () => {
    const nextAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    await act(async () => { root.unmount(); });
    harness.gameAppearance = null;
    harness.loadTelegramWebApp.mockResolvedValueOnce({ initData: 'account-a-launch', ready: vi.fn() });
    harness.login.mockResolvedValueOnce(account);
    harness.shopEquipment.mockReset()
      .mockResolvedValueOnce({ equipment: [{ item_type: 'skin', item_id: 'royal', revision: 1 }, { item_type: 'background', item_id: 'meadow', revision: 1 }] })
      .mockRejectedValueOnce(new Error('shop unavailable'));
    root = createRoot(host);
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="equipment-account-a" /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    expect(harness.shopEquipment).toHaveBeenCalledTimes(1);

    harness.loadTelegramWebApp.mockResolvedValueOnce({ initData: 'account-b-launch', ready: vi.fn() });
    harness.login.mockResolvedValueOnce(nextAccount);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="equipment-account-b" /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    harness.createRun.mockResolvedValueOnce(runSnapshot({ accountId: nextAccount.account_id, runId: 'default-flight' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${nextAccount.account_id}:default-flight`)).toBe(true));

    expect((harness.gameAppearance as { duck: unknown }).duck).toEqual(DEFAULT_APPEARANCE.duck);
  });

  it('shows a verified delivery-pending result and allows the next flight', async () => {
    harness.latestRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending' }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="verified-delivery-pending" /></LocaleProvider>);
    });

    expect(host.textContent).toContain(messagesRu.accountPendingVerification);
    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'next-flight', writerToken: 'next-writer' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });

    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:next-flight`)).toBe(true));
  });

  it('refreshes the receipt message when a pending delivery succeeds', async () => {
    vi.useFakeTimers();
    const pending = runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending' });
    const delivered = runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' });
    harness.currentRun.mockResolvedValue(pending);
    harness.getRun.mockResolvedValueOnce(delivered);
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="delivery-poll-delivered" /></LocaleProvider>);
    });
    expect(host.textContent).toContain(messagesRu.accountPendingVerification);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(host.textContent).not.toContain('Проверено');
    expect(host.textContent).not.toContain(messagesRu.accountPendingVerification);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(harness.getRun).toHaveBeenCalledTimes(1);
  });

  it('refreshes the receipt message when a pending delivery is rejected', async () => {
    vi.useFakeTimers();
    const pending = runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending' });
    const rejected = runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'rejected' });
    harness.currentRun.mockResolvedValue(pending);
    harness.getRun.mockResolvedValueOnce(rejected);
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="delivery-poll-rejected" /></LocaleProvider>);
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(host.textContent).toContain(messagesRu.accountDeliveryRejected);
    expect(host.textContent).not.toContain('подтвердить');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(harness.getRun).toHaveBeenCalledTimes(1);
  });

  it('shows delivery rejection separately from gameplay and still allows another flight', async () => {
    harness.latestRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'rejected' }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="verified-delivery-rejected" /></LocaleProvider>);
    });

    expect(host.textContent).toContain(messagesRu.accountDeliveryRejected);
    expect(host.textContent).not.toContain('Сервер не смог подтвердить этот полёт.');
    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'flight-after-delivery-rejection', writerToken: 'next-writer' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });

    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:flight-after-delivery-rejection`)).toBe(true));
  });

  it('waits for Telegram SDK readiness before trying automatic Telegram login', async () => {
    let resolveTelegram!: (value: { initData: string; ready: () => void }) => void;
    harness.login.mockResolvedValue(account);
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((resolve) => { resolveTelegram = resolve; }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="delayed-telegram-sdk" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    expect(harness.login).not.toHaveBeenCalled();

    await act(async () => { resolveTelegram({ initData: 'signed-init-data', ready: vi.fn() }); });

    expect(harness.login).toHaveBeenCalledWith('signed-init-data');
  });

  it('keeps Telegram launch identity authoritative while SDK startup is delayed', async () => {
    let resolveTelegram!: (value: { initData: string; ready: () => void }) => void;
    harness.loginDev.mockClear(); harness.login.mockClear();
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((resolve) => { resolveTelegram = resolve; }));
    harness.login.mockResolvedValue(account);

    await act(async () => {
      root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="delayed-telegram-authority" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    expect(harness.loginDev).not.toHaveBeenCalled();
    expect(harness.login).not.toHaveBeenCalled();

    await act(async () => { resolveTelegram({ initData: 'delayed-authoritative-launch', ready: vi.fn() }); });

    expect(harness.login).toHaveBeenCalledWith('delayed-authoritative-launch');
    expect(harness.loginDev).not.toHaveBeenCalled();
    expect(host.querySelector('.account-shop-trigger')).toBeTruthy();
  });

  it('does not submit delayed Telegram bootstrap credentials after the account screen unmounts', async () => {
    let resolveInitial!: (value: { initData: string; ready: () => void }) => void;
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    harness.login.mockResolvedValue(account);

    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="delayed-explicit-login" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    await act(async () => { root.render(<div />); });

    await act(async () => { resolveInitial({ initData: 'stale-initial-init-data', ready: vi.fn() }); });

    expect(harness.login).not.toHaveBeenCalled();
  });

  it('reauthenticates with the same launch identity and preserves its pending trace', async () => {
    await act(async () => { root.unmount(); });
    harness.loadTelegramWebApp.mockResolvedValue({ initData: 'same-launch-identity', ready: vi.fn() });
    harness.login.mockResolvedValue(account);
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="same-identity-recovery" /></LocaleProvider>); });
    harness.submitCheckpoint.mockRejectedValueOnce(new AccountApiError(409, 'account_session_identity_mismatch'));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await act(async () => { for (let tick = 1; tick <= 120; tick++) harness.runOptions!.onTick({ phase: 'RUNNING', tick } as never, []); });
    await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(host.textContent).toContain('Повторить подключение'));

    const reauthenticateButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Повторить подключение'));
    expect(reauthenticateButton).toBeDefined();
    await act(async () => { reauthenticateButton!.click(); });

    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    expect(harness.login).toHaveBeenNthCalledWith(2, 'same-launch-identity');
    expect(harness.traceRecords.has(`${account.account_id}:${initialState.descriptor.runId}`)).toBe(true);
    const start = host.querySelector<HTMLButtonElement>('.account-panel .primary-button');
    expect(start?.disabled).toBe(false);
  });

  it('ignores a delayed Telegram SDK rejection after unmount', async () => {
    let rejectTelegram!: (reason: unknown) => void;
    harness.loginDev.mockClear(); harness.login.mockClear();
    vi.stubEnv('VITE_DD_DEV_AUTH_ENABLED', 'false');
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectTelegram = reject; }));

    await act(async () => {
      root.unmount(); root = createRoot(host); root.render(<LocaleProvider><AccountGame key="unmount-before-sdk-reject" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    await act(async () => { root.render(<div />); });

    await act(async () => { rejectTelegram(new TelegramWebAppUnavailableError()); });

    expect(host.querySelector('.wallet-access-error')).toBeNull();
    expect(harness.login).not.toHaveBeenCalled();
  });

  it('shows a retry after local sign-in fails and clears the error on retry', async () => {
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.loadTelegramWebApp.mockRejectedValueOnce(new TelegramWebAppUnavailableError());
    harness.loginDev.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503, code: 'unavailable' }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="telegram-unavailable" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Проверьте соединение и повторите попытку'));
    expect(harness.login).not.toHaveBeenCalled();

    harness.loginDev.mockResolvedValueOnce(account);
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel button')?.click(); });

    expect(host.textContent).not.toContain('Проверьте соединение и повторите попытку');
    expect(host.textContent).toContain('Играть');
  });

  it('keeps the verified result compact and shows authoritative wallet totals outside the result card', async () => {
    const state = { ...initialState, score: 23, totals: { FEATHER: 4, GAME_STAR: 2 } };
    harness.currentRun.mockResolvedValue(undefined);
    harness.latestRun.mockResolvedValue(runSnapshot({ state, status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' }));
    harness.completion.mockResolvedValueOnce({ status: 'committed', reason: 'credited', credited: { FEATHER: '40', GAME_STAR: '5' } });
    harness.walletBalances.mockResolvedValue({ balances: [{ currency: 'FEATHER', balance: '40' }, { currency: 'GAME_STAR', balance: '5' }] });
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="restored-result" /></LocaleProvider>);
    });

    expect(host.querySelector('.game-frame.result-screen')).not.toBeNull();

    expect(harness.currentRun.mock.invocationCallOrder[0]).toBeLessThan(harness.latestRun.mock.invocationCallOrder[0]!);
    expect(host.querySelector('.result-score')?.textContent).toContain('23');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('4');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('2');
    await vi.waitFor(() => expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('40'));
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('5');
    expect(host.querySelector('.account-panel .account-shop-trigger')).toBeNull();
    expect(host.querySelector('.account-panel .account-settlement-details')).toBeNull();
    expect(host.querySelector('.account-panel .wallet-disclaimer, .account-panel .account-reward-note')).toBeNull();
    expect(host.querySelector('.earnings-summary span')?.textContent).toBe('Находки');
    expect(host.querySelector('.account-panel')?.textContent).not.toContain('Проверено');
    expect(host.querySelector('.account-panel')?.textContent).not.toContain('ожидает проверки');
    expect(host.querySelector('.account-wallet')).not.toBeNull();
    expect(host.querySelector('.account-hud .account-shop-trigger')).toBeTruthy();
    expect(host.textContent).toContain('РЕКОРД');
    expect(host.textContent).toContain('Ещё раз');
  });

  it('routes settlement failures to the wallet popup outside the centered result card', async () => {
    harness.currentRun.mockResolvedValue(undefined);
    harness.latestRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' }));
    harness.completion.mockRejectedValueOnce(new Error('wallet unavailable'));
    await act(async () => { root.render(<LocaleProvider><AccountGame key="wallet-settlement-failure" /></LocaleProvider>); });

    await vi.waitFor(() => expect(host.querySelector('.wallet-popup [role="alert"]')).not.toBeNull());
    expect(host.querySelector('.wallet-popup')?.textContent).toContain(messagesRu.accountShopSettlementUnavailable);
    expect(host.querySelector('.result-screen .account-panel')?.textContent).not.toContain('кошелёк');
    expect(host.querySelector('.account-panel .account-shop-trigger')).toBeNull();
    expect(host.querySelector('.account-hud .account-shop-trigger')).toBeTruthy();
  });

  it('refreshes pending settlement after delivery completes', async () => {
    vi.useFakeTimers();
    harness.currentRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending' }));
    let delivered = false;
    harness.completion.mockImplementation(async () => delivered
      ? { status: 'committed', reason: 'credited', credited: { FEATHER: '40', GAME_STAR: '5' } }
      : { status: 'pending', reason: 'awaiting_delivery', credited: { FEATHER: '0', GAME_STAR: '0' } });
    harness.getRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' }));
    await act(async () => { root.render(<LocaleProvider><AccountGame key="settlement-after-delivery" /></LocaleProvider>); });
    await vi.waitFor(() => expect(harness.completion).toHaveBeenCalledTimes(1));
    const readsBeforeCommit = harness.walletBalances.mock.calls.length;
    harness.walletBalances.mockResolvedValue({ balances: [{ currency: 'FEATHER', balance: '40' }, { currency: 'GAME_STAR', balance: '5' }] });
    delivered = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await vi.waitFor(() => expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('40'));
    expect(host.querySelector('.wallet-summary-button')?.textContent).toContain('5');
    expect(harness.walletBalances.mock.calls.length).toBeGreaterThan(readsBeforeCommit);
    expect(harness.completion.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('never renders account logout or identity selection controls', async () => {
    expect(host.querySelector('input')).toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => /sign in|войти|выйти|telegram/i.test(button.textContent ?? ''))).toBe(false);
    expect(harness.logout).not.toHaveBeenCalled();
  });

  it('does not apply a latest result from an earlier Telegram launch', async () => {
    const otherAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    let resolveOldLatest!: (value: ReturnType<typeof runSnapshot>) => void;
    await act(async () => { root.unmount(); });
    harness.loadTelegramWebApp.mockResolvedValueOnce({ initData: 'old-launch', ready: vi.fn() });
    harness.login.mockResolvedValueOnce(account);
    harness.latestRun.mockImplementationOnce(() => new Promise((resolve) => { resolveOldLatest = resolve; }));
    root = createRoot(host);
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="restore-pending-result-old-launch" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.latestRun).toHaveBeenCalled());

    harness.loadTelegramWebApp.mockResolvedValueOnce({ initData: 'new-launch', ready: vi.fn() });
    harness.login.mockResolvedValueOnce(otherAccount);
    harness.latestRun.mockResolvedValue(undefined);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="restore-pending-result-new-launch" /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    await act(async () => {
      resolveOldLatest(runSnapshot({ state: { ...initialState, score: 99 }, status: 'completed', verificationStatus: 'verified' }));
    });

    expect(host.querySelector('.result-score')).toBeNull();
    expect(host.textContent).not.toContain('99');
    expect(host.querySelector('.account-shop-trigger')).toBeTruthy();
  });

  it('shows the account best score from the server across new runs', async () => {
    localStorage.setItem('doofy-duck:best:v1', JSON.stringify({ version: 1, best: 99999 }));
    harness.progress.mockResolvedValue({ bestScore: 987 });
    harness.currentRun.mockResolvedValue(undefined);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="server-best-score" /></LocaleProvider>); });
    await vi.waitFor(() => expect(harness.progress).toHaveBeenCalled());
    await vi.waitFor(() => expect(host.textContent).toContain('987'));
    expect(host.textContent).toContain('РЕКОРД');

    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(host.textContent).toContain('987'));
    expect(host.textContent).toContain('РЕКОРД');
  });

  it('reconciles an expired submission to a definitive rejection and enables a new flight', async () => {
    vi.stubGlobal('confirm', () => true);
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    harness.submitCheckpoint.mockRejectedValueOnce({ status: 410, code: 'submission_expired' });
    harness.getRun.mockResolvedValueOnce(runSnapshot({ status: 'rejected', verificationStatus: 'rejected', deliveryStatus: 'not_ready' }));

    await act(async () => {
      harness.runOptions!.onTick({ phase: 'DEAD', tick: 1 } as never, []);
      await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalled());
      await vi.waitFor(() => expect(harness.getRun).toHaveBeenCalled());
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(host.textContent).toContain(messagesRu.accountGameplayRejected);
    const startButton = [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
      .find((button) => button.textContent?.includes('Играть'));
    expect(startButton).toBeTruthy();
    await act(async () => { startButton?.click(); });
    expect(harness.createRun).toHaveBeenCalledTimes(2);
  });

  it('merges an ACK with ticks recorded while the checkpoint request was pending', async () => {
    let finishRequest!: (snapshot: ReturnType<typeof runSnapshot>) => void;
    harness.submitCheckpoint.mockImplementationOnce(() => new Promise((resolve) => { finishRequest = resolve; }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    const onTick = harness.runOptions!.onTick;
    for (let tick = 1; tick <= 120; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    for (let tick = 121; tick <= 127; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => { finishRequest(runSnapshot({ checkpointSequence: 0, activeTicks: 120 })); });
    expect(harness.runOptions?.initialState).toMatchObject({
      descriptor: { simulationVersion: '3.1.0', generatorVersion: '3.1.0', configId: 'dd-v3-varied-base-v1' },
      config: { wetland: { catalogVersion: 12 } },
    });
    await vi.waitFor(() => {
      const trace = harness.traceRecords.get(`${account.account_id}:${initialState.descriptor.runId}`) as { activeTicks: number; unsentTicks: unknown[]; pending: unknown[] };
      expect(trace).toMatchObject({ activeTicks: 127, pending: [] });
      expect(trace.unsentTicks).toHaveLength(7);
    });
  });

  it('flushes the final partial checkpoint when the active tick cap is reached', async () => {
    harness.submitCheckpoint.mockResolvedValue(runSnapshot({ checkpointSequence: 0, activeTicks: 216_000, status: 'completion_pending', verificationStatus: 'verified', deliveryStatus: 'pending' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    act(() => harness.runOptions!.onTick({ phase: 'RUNNING', tick: 216_000 } as never, []));
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    expect(harness.submitCheckpoint.mock.calls[0]?.[1]).toMatchObject({ checkpointSequence: 0, ticks: [[]] });
  });

  it('keeps recording the active flight while checkpoint transport is unavailable', async () => {
    harness.submitCheckpoint.mockRejectedValueOnce({ status: 503, code: 'temporarily_unavailable' });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    for (let tick = 1; tick <= 120; tick++) act(() => harness.runOptions!.onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    for (let tick = 121; tick <= 127; tick++) act(() => harness.runOptions!.onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => {
      await vi.waitFor(() => {
        const trace = harness.traceRecords.get(`${account.account_id}:${initialState.descriptor.runId}`) as { activeTicks: number; unsentTicks: unknown[]; pending: unknown[] };
        expect(trace).toMatchObject({ activeTicks: 127 });
        expect(trace.pending).toHaveLength(1);
        expect(trace.unsentTicks).toHaveLength(7);
      });
    });
    expect(host.textContent).toContain('недоступен');
  });

  it('retries a timed-out checkpoint with the same idempotency key after retaining later ticks', async () => {
    vi.useFakeTimers();
    const keys: string[] = [];
    harness.submitCheckpoint.mockImplementationOnce((_runId, input) => {
      keys.push((input as { idempotencyKey: string }).idempotencyKey);
      return new Promise((_resolve, reject) => window.setTimeout(() => reject(Object.assign(new Error('timeout'), { status: 0, code: 'request_timeout' })), 30_000));
    }).mockImplementationOnce(async (_runId, input) => {
      keys.push((input as { idempotencyKey: string }).idempotencyKey);
      return runSnapshot({ checkpointSequence: 0, activeTicks: 128 });
    });
    harness.runPhase = 'RUNNING';
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    const onTick = harness.runOptions!.onTick;
    for (let tick = 1; tick <= 120; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    for (let tick = 121; tick <= 127; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    harness.runPhase = 'DEAD';
    act(() => onTick({ phase: 'DEAD', tick: 128 } as never, []));

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(harness.submitCheckpoint.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('honors Retry-After for later ticks and terminal flushes', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    harness.submitCheckpoint.mockRejectedValueOnce({ status: 429, code: 'busy', retryAfterMs: 60_000 })
      .mockImplementation(async (_runId, input) => {
        const checkpoint = input as { checkpointSequence: number };
        return runSnapshot({ checkpointSequence: checkpoint.checkpointSequence, activeTicks: checkpoint.checkpointSequence === 0 ? 120 : 128 });
      });
    harness.runPhase = 'RUNNING';
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    const onTick = harness.runOptions!.onTick;
    for (let tick = 1; tick <= 120; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    for (let tick = 121; tick <= 127; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    harness.runPhase = 'DEAD';
    act(() => onTick({ phase: 'DEAD', tick: 128 } as never, []));
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(3));
  });

  it('retains a locally completed flight through an outage and replays ordered checkpoints after recovery', async () => {
    vi.useFakeTimers();
    let networkAvailable = false;
    const attempts: Array<{ checkpointSequence: number; idempotencyKey: string; ticks: unknown[] }> = [];
    harness.submitCheckpoint.mockImplementation(async (_runId, input) => {
      const checkpoint = input as { checkpointSequence: number; idempotencyKey: string; ticks: unknown[] };
      attempts.push({ checkpointSequence: checkpoint.checkpointSequence, idempotencyKey: checkpoint.idempotencyKey, ticks: checkpoint.ticks.map((tick) => tick) });
      if (!networkAvailable) throw Object.assign(new Error('temporarily_unavailable'), { status: 503, code: 'temporarily_unavailable' });
      if (checkpoint.checkpointSequence === 0) {
        return runSnapshot({ checkpointSequence: 0, activeTicks: 120 });
      }
      return runSnapshot({ checkpointSequence: 1, activeTicks: 128, status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' });
    });
    harness.runPhase = 'RUNNING';
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });

    const onTick = harness.runOptions!.onTick;
    for (let tick = 1; tick <= 120; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    for (let tick = 121; tick <= 127; tick++) act(() => onTick({ phase: 'RUNNING', tick } as never, []));
    harness.runPhase = 'DEAD';
    act(() => onTick({ phase: 'DEAD', tick: 128 } as never, []));
    expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    const trace = harness.traceRecords.get(`${account.account_id}:${initialState.descriptor.runId}`) as {
      accountId: string; activeTicks: number; unsentTicks: unknown[];
      pending: Array<{ sequence: number; ticks: unknown[] }>;
    };
    expect(trace).toMatchObject({ accountId: account.account_id, activeTicks: 128, unsentTicks: [], pending: [{ sequence: 0 }, { sequence: 1 }] });
    expect(trace.pending.map((checkpoint) => checkpoint.ticks.length)).toEqual([120, 8]);
    expect(host.textContent).toContain(messagesRu.accountServiceUnavailable);
    expect(host.querySelector('[role="alert"], [role="status"]')?.textContent).toContain(messagesRu.accountServiceUnavailable);
    expect(host.querySelector('.account-panel .primary-button')?.textContent).not.toContain('Играть');
    expect(harness.createRun).toHaveBeenCalledTimes(1);

    networkAvailable = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

    const retries = attempts.filter((request) => request.checkpointSequence === 0);
    expect(retries.length).toBeGreaterThan(1);
    expect(retries.length).toBeLessThanOrEqual(3);
    expect(attempts.at(-1)?.checkpointSequence).toBe(1);
    expect(attempts.slice(0, -1).every((request) => request.checkpointSequence === 0)).toBe(true);
    expect(retries.map((request) => request.ticks)).toEqual(retries.map(() => trace.pending[0]?.ticks));
    expect(new Set(retries.map((request) => request.idempotencyKey)).size).toBe(1);
    expect(attempts.at(-1)?.ticks).toEqual(trace.pending[1]?.ticks);
    expect(host.textContent).not.toContain('Проверено');
    const nextStart = [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
      .find((button) => button.textContent?.includes('Ещё раз'));
    expect(nextStart).toBeTruthy();

    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'next-flight', writerToken: 'next-writer' }));
    await act(async () => { nextStart?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:next-flight`)).toBe(true));
    expect(harness.traceRecords.get(`${account.account_id}:next-flight`)).toMatchObject({ accountId: account.account_id });
  });

  it('preserves a valid saved tail during explicit takeover when Web Locks are unavailable', async () => {
    vi.stubGlobal('confirm', () => true);
    const saved = {
      accountId: account.account_id, runId: initialState.descriptor.runId, writerGeneration: 1, writerToken: 'old-writer',
      nextCheckpointSequence: 0, activeTicks: 1, unsentTicks: [[{ sequence: 0, action: 'FLAP' as const }]], pending: [],
    };
    harness.traceRecords.set(`${account.account_id}:${initialState.descriptor.runId}`, saved);
    harness.currentRun.mockResolvedValue(runSnapshot({ writerToken: undefined }));
    harness.takeover.mockResolvedValue(runSnapshot({ writerGeneration: 2, writerToken: 'new-writer' }));
    harness.submitCheckpoint.mockResolvedValue(runSnapshot({ checkpointSequence: 0, activeTicks: 1, writerGeneration: 2 }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="restored-account-flight" /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('явное подтверждение'));

    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });

    expect(harness.submitCheckpoint).toHaveBeenCalledWith(initialState.descriptor.runId, expect.objectContaining({
      checkpointSequence: 0, writerGeneration: 2, writerToken: 'new-writer', ticks: [[{ sequence: 0, action: 'FLAP' }]],
    }));
  });

  it('applies Retry-After to checkpoints sent while reconciling a saved trace', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await act(async () => { root.unmount(); });
    harness.currentRun.mockResolvedValue(runSnapshot());
    const saved = {
      accountId: account.account_id, runId: initialState.descriptor.runId, writerGeneration: 1, writerToken: 'writer',
      nextCheckpointSequence: 1, activeTicks: 1, unsentTicks: [],
      pending: [{ sequence: 0, idempotencyKey: 'recovery-checkpoint-key', ticks: [[{ sequence: 0, action: 'FLAP' as const }]] }],
    };
    harness.traceRecords.set(`${account.account_id}:${initialState.descriptor.runId}`, saved);
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    restoreLocks = () => {
      if (locks) Object.defineProperty(navigator, 'locks', locks);
      else Reflect.deleteProperty(navigator, 'locks');
    };
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
        void callback({ name: 'test-lock', mode: 'exclusive' } as Lock);
        return Promise.resolve(undefined);
      },
    } });
    let rejectedAt = 0;
    harness.submitCheckpoint.mockImplementationOnce(async () => {
      rejectedAt = Date.now();
      throw { status: 429, code: 'busy', retryAfterMs: 60_000 };
    })
      .mockResolvedValueOnce(runSnapshot({ checkpointSequence: 0, activeTicks: 1 }));
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="retry-reconcile-deadline" /></LocaleProvider>); });
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1)); });
    const checkpointKey = (harness.submitCheckpoint.mock.calls[0]?.[1] as { idempotencyKey: string }).idempotencyKey;
    expect(checkpointKey).toBe('recovery-checkpoint-key');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain(messagesRu.accountConnectionRestoring);

    const retryButton = () => [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
      .find((button) => button.textContent?.toLowerCase().includes('снова'))!;
    await act(async () => { retryButton().click(); retryButton().click(); });
    expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1);
    const remainingBeforeDeadline = Math.max(0, 59_000 - (Date.now() - rejectedAt));
    await act(async () => { await vi.advanceTimersByTimeAsync(remainingBeforeDeadline); });
    expect(Date.now() - rejectedAt).toBeLessThan(60_000);
    expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1);
    await act(async () => { retryButton().click(); });
    expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1);

    const remainingAfterDeadline = Math.max(1, 60_001 - (Date.now() - rejectedAt));
    await act(async () => { await vi.advanceTimersByTimeAsync(remainingAfterDeadline); retryButton().click(); });
    await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(2));
    expect((harness.submitCheckpoint.mock.calls[1]?.[1] as { idempotencyKey: string }).idempotencyKey).toBe(checkpointKey);
  });

  it('ignores a completion poll that resolves after a new Telegram launch starts another account run', async () => {
    vi.useFakeTimers();
    const nextAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    harness.currentRun.mockResolvedValue(runSnapshot({ status: 'completion_pending', verificationStatus: 'verified', deliveryStatus: 'pending' }));
    let finishPoll!: (snapshot: ReturnType<typeof runSnapshot>) => void;
    harness.getRun.mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="completion-pending-flight" /></LocaleProvider>);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(harness.getRun).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    harness.loadTelegramWebApp.mockResolvedValueOnce({ initData: 'second-account-launch', ready: vi.fn() });
    harness.login.mockResolvedValueOnce(nextAccount);
    harness.currentRun.mockResolvedValue(undefined);
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame key="different-launch-account" /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.querySelector('.account-shop-trigger')).toBeTruthy());
    harness.createRun.mockResolvedValue(runSnapshot({ runId: 'run-b', accountId: nextAccount.account_id, writerToken: 'writer-b' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${nextAccount.account_id}:run-b`)).toBe(true));

    await act(async () => { finishPoll(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' })); });

    expect(harness.traceRecords.has(`${nextAccount.account_id}:run-b`)).toBe(true);
  });

  it('ignores an older completion poll after a new run starts for the same account', async () => {
    vi.useFakeTimers();
    const runA = runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending' });
    const completedA = runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' });
    harness.currentRun.mockResolvedValue(runA);
    let finishOlderPoll!: (snapshot: ReturnType<typeof runSnapshot>) => void;
    harness.getRun.mockReset();
    harness.getRun.mockImplementationOnce(() => new Promise((resolve) => { finishOlderPoll = resolve; }));
    harness.getRun.mockResolvedValueOnce(completedA);
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="same-account-completion-poll" /></LocaleProvider>);
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(host.textContent).toContain('Ещё раз');

    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'run-b', writerToken: 'writer-b' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:run-b`)).toBe(true));
    expect(host.textContent).toContain('Играть');

    await act(async () => { finishOlderPoll(runA); });

    expect(harness.traceRecords.has(`${account.account_id}:run-b`)).toBe(true);
    expect(host.textContent).toContain('Играть');
    expect(harness.createRun).toHaveBeenCalledTimes(1);
  });
});
