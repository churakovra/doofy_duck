// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, createRunDescriptor } from '@doofy-duck/game-sim';
import { AccountGame } from './AccountGame';
import { TelegramWebAppUnavailableError } from './telegram-web-app';
import { LocaleProvider } from './locale';
import { DEFAULT_APPEARANCE } from './appearance';
import { messages as messagesEn } from './messages.en';

const harness = vi.hoisted(() => ({
  restore: vi.fn(), loadTelegramWebApp: vi.fn(), currentRun: vi.fn(), latestRun: vi.fn(), createRun: vi.fn(), getRun: vi.fn(), submitCheckpoint: vi.fn(),
  takeover: vi.fn(), abandon: vi.fn(), login: vi.fn(), loginDev: vi.fn(), logout: vi.fn(), progress: vi.fn(),
  shopEquipment: vi.fn(), completion: vi.fn(),
  gameAppearance: null as unknown,
  traceRecords: new Map<string, unknown>(), save: vi.fn(), runPhase: 'READY', runOptions: null as null | { onTick(state: unknown, inputs: readonly unknown[]): void },
}));

vi.mock('./telegram-web-app', async () => {
  const actual = await vi.importActual<typeof import('./telegram-web-app')>('./telegram-web-app');
  return { ...actual, loadTelegramWebApp: harness.loadTelegramWebApp };
});

vi.mock('./account-api', () => ({
  AccountApi: class {
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
      clearAccount: async () => { harness.traceRecords.clear(); },
    }),
  };
});

vi.mock('./GameCanvas', () => ({ GameCanvas: (props: { appearance: unknown }) => { harness.gameAppearance = props.appearance; return <canvas />; } }));
vi.mock('./GameSettings', () => ({ GameSettings: () => null }));
vi.mock('./GameWardrobe', () => ({ GameWardrobe: () => null }));
vi.mock('./useGameAudio', () => ({ useGameAudio: () => ({
  unlockFromGesture: vi.fn(), flap: vi.fn(), pickup: vi.fn(), setPhase: vi.fn(),
  preferences: { sound: true, music: true }, toggle: vi.fn(),
}) }));
vi.mock('./useGameRun', () => ({ useGameRun: (_canPlay: unknown, _callbacks: unknown, options: typeof harness.runOptions) => {
  harness.runOptions = options;
  return {
    phase: harness.runPhase, score: 0, runtimeError: '', rendererReady: true, flightCapReached: false,
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

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.traceRecords.clear(); harness.runPhase = 'READY'; harness.runOptions = null;
  harness.restore.mockResolvedValue(account);
  harness.loadTelegramWebApp.mockResolvedValue({ initData: '', ready: vi.fn() });
  harness.progress.mockResolvedValue({ bestScore: 0 });
  harness.shopEquipment.mockResolvedValue({ equipment: [{ item_type: 'skin', item_id: 'classic', revision: 1 }, { item_type: 'background', item_id: 'meadow', revision: 1 }] });
  harness.completion.mockResolvedValue({ status: 'pending', reason: 'settlement_disabled', credited: { FEATHER: '0', GAME_STAR: '0' } });
  harness.currentRun.mockResolvedValue(undefined);
  harness.latestRun.mockResolvedValue(undefined);
  harness.createRun.mockResolvedValue(runSnapshot());
  harness.submitCheckpoint.mockReset();
  harness.getRun.mockResolvedValue(runSnapshot());
  harness.save.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<LocaleProvider><AccountGame onBack={vi.fn()} /></LocaleProvider>); });
});

afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks();
  vi.useRealTimers();
});

describe('account run transport', () => {
  it('uses default account equipment after logout when the next account equipment read fails', async () => {
    const nextAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    await act(async () => { root.unmount(); });
    harness.gameAppearance = null;
    harness.restore.mockResolvedValue(account);
    harness.shopEquipment.mockReset()
      .mockResolvedValueOnce({ equipment: [{ item_type: 'skin', item_id: 'royal', revision: 1 }, { item_type: 'background', item_id: 'meadow', revision: 1 }] })
      .mockRejectedValueOnce(new Error('shop unavailable'));
    root = createRoot(host);
    await act(async () => { root.render(<LocaleProvider><AccountGame onBack={vi.fn()} /></LocaleProvider>); });
    await vi.waitFor(() => expect(host.textContent).toContain('7'));
    expect(harness.shopEquipment).toHaveBeenCalledTimes(1);

    await act(async () => { host.querySelector<HTMLButtonElement>('.account-mode-button')?.click(); });
    await vi.waitFor(() => expect(host.querySelector('.account-dev-label input')).not.toBeNull());
    harness.loginDev.mockResolvedValueOnce(nextAccount);
    const input = host.querySelector<HTMLInputElement>('.account-dev-label input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '8'); input.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(host.textContent).toContain('8'));
    harness.createRun.mockResolvedValueOnce(runSnapshot({ accountId: nextAccount.account_id, runId: 'default-flight' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${nextAccount.account_id}:default-flight`)).toBe(true));

    expect((harness.gameAppearance as { duck: unknown }).duck).toEqual(DEFAULT_APPEARANCE.duck);
  });

  it('shows a verified delivery-pending result and allows the next flight', async () => {
    harness.latestRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'pending' }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="verified-delivery-pending" onBack={vi.fn()} /></LocaleProvider>);
    });

    expect(host.textContent).toContain('Полёт проверен. Запись в аккаунт ожидает подтверждения.');
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
      root.render(<LocaleProvider><AccountGame key="delivery-poll-delivered" onBack={vi.fn()} /></LocaleProvider>);
    });
    expect(host.textContent).toContain('Полёт проверен. Запись в аккаунт ожидает подтверждения.');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(host.textContent).toContain('Полёт проверен и записан в аккаунт.');
    expect(host.textContent).not.toContain('Запись в аккаунт ожидает подтверждения.');
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
      root.render(<LocaleProvider><AccountGame key="delivery-poll-rejected" onBack={vi.fn()} /></LocaleProvider>);
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(host.textContent).toContain('Полёт проверен, но запись в аккаунт отклонена. Награда не начислена.');
    expect(host.textContent).not.toContain('Сервер не смог подтвердить этот полёт.');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(harness.getRun).toHaveBeenCalledTimes(1);
  });

  it('shows delivery rejection separately from gameplay and still allows another flight', async () => {
    harness.latestRun.mockResolvedValue(runSnapshot({ status: 'completed', verificationStatus: 'verified', deliveryStatus: 'rejected' }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="verified-delivery-rejected" onBack={vi.fn()} /></LocaleProvider>);
    });

    expect(host.textContent).toContain('Полёт проверен, но запись в аккаунт отклонена. Награда не начислена.');
    expect(host.textContent).not.toContain('Сервер не смог подтвердить этот полёт.');
    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'flight-after-delivery-rejection', writerToken: 'next-writer' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });

    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:flight-after-delivery-rejection`)).toBe(true));
  });

  it('waits for Telegram SDK readiness before trying automatic Telegram login', async () => {
    let resolveTelegram!: (value: { initData: string; ready: () => void }) => void;
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.login.mockResolvedValue(account);
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((resolve) => { resolveTelegram = resolve; }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="delayed-telegram-sdk" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    expect(harness.login).not.toHaveBeenCalled();

    await act(async () => { resolveTelegram({ initData: 'signed-init-data', ready: vi.fn() }); });

    expect(harness.login).toHaveBeenCalledWith('signed-init-data');
  });

  it('does not let delayed Telegram bootstrap replace a manual development login', async () => {
    const manualAccount = { account_id: 'account-manual', telegram_user_id: 88, created_at: 'manual' };
    let resolveTelegram!: (value: { initData: string; ready: () => void }) => void;
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((resolve) => { resolveTelegram = resolve; }));
    harness.loginDev.mockResolvedValue(manualAccount);
    harness.login.mockResolvedValue(account);

    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="manual-login-before-sdk" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    const input = host.querySelector<HTMLInputElement>('.account-dev-label input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '88');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(host.textContent).toContain('88'));

    await act(async () => { resolveTelegram({ initData: 'old-telegram-init-data', ready: vi.fn() }); });

    expect(harness.login).not.toHaveBeenCalled();
    expect(host.textContent).toContain('88');
    expect(host.textContent).not.toContain('7');
  });

  it('does not submit delayed explicit Telegram credentials after the account screen unmounts', async () => {
    let resolveAutomatic!: (value: { initData: string; ready: () => void }) => void;
    let resolveExplicit!: (value: { initData: string; ready: () => void }) => void;
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.loadTelegramWebApp
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAutomatic = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveExplicit = resolve; }));
    harness.login.mockResolvedValue(account);

    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="delayed-explicit-login" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalledTimes(2));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-mode-button')?.click(); });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalledTimes(3));
    await act(async () => { root.render(<div />); });

    await act(async () => { resolveExplicit({ initData: 'stale-explicit-init-data', ready: vi.fn() }); });
    await act(async () => { resolveAutomatic({ initData: 'stale-bootstrap-init-data', ready: vi.fn() }); });

    expect(harness.login).not.toHaveBeenCalled();
  });

  it('does not leave cross-account reauthentication busy after loading the new account', async () => {
    const nextAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    harness.submitCheckpoint.mockRejectedValueOnce({ status: 401, code: 'account_session_expired' });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await act(async () => { for (let tick = 1; tick <= 120; tick++) harness.runOptions!.onTick({ phase: 'RUNNING', tick } as never, []); });
    await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(host.textContent).toContain('Войти через Telegram'));

    harness.loadTelegramWebApp.mockResolvedValue({ initData: 'account-b-init-data', ready: vi.fn() });
    harness.login.mockResolvedValue(nextAccount);
    const reauthenticateButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Войти через Telegram'));
    expect(reauthenticateButton).toBeDefined();
    await act(async () => { reauthenticateButton!.click(); });

    await vi.waitFor(() => expect(host.textContent).toContain('8'));
    const start = host.querySelector<HTMLButtonElement>('.account-panel .primary-button');
    expect(start?.disabled).toBe(false);
  });

  it('ignores a delayed Telegram SDK rejection after manual login and logout', async () => {
    const manualAccount = { account_id: 'account-manual', telegram_user_id: 88, created_at: 'manual' };
    let rejectTelegram!: (reason: unknown) => void;
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.loadTelegramWebApp.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectTelegram = reject; }));
    harness.loginDev.mockResolvedValue(manualAccount);

    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="logout-before-sdk-reject" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.loadTelegramWebApp).toHaveBeenCalled());
    const input = host.querySelector<HTMLInputElement>('.account-dev-label input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '88');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(host.textContent).toContain('88'));
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Выйти'))?.click();
    });
    await vi.waitFor(() => expect(host.querySelector('.account-dev-label input')).toBeTruthy());

    await act(async () => { rejectTelegram(new TelegramWebAppUnavailableError()); });

    expect(host.querySelector('.wallet-access-error')).toBeNull();
    expect(host.textContent).not.toContain('Проверьте соединение и попробуйте ещё раз');
  });

  it('shows an unavailable message after SDK failure and clears it on a sign-in retry', async () => {
    harness.restore.mockRejectedValue(new Error('no saved session'));
    harness.loadTelegramWebApp.mockRejectedValueOnce(new TelegramWebAppUnavailableError());
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="telegram-unavailable" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('Проверьте соединение и попробуйте ещё раз'));
    expect(harness.login).not.toHaveBeenCalled();

    harness.loadTelegramWebApp.mockResolvedValueOnce({ initData: '', ready: vi.fn() });
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .account-mode-button')?.click(); });

    expect(host.textContent).not.toContain('Проверьте соединение и попробуйте ещё раз');
    expect(host.textContent).toContain('Открой игру в Telegram');
  });

  it('restores the last verified result when a signed-in account has no current run', async () => {
    const state = { ...initialState, score: 23, totals: { FEATHER: 4, GAME_STAR: 2 } };
    harness.currentRun.mockResolvedValue(undefined);
    harness.latestRun.mockResolvedValue(runSnapshot({ state, status: 'completed', verificationStatus: 'verified', deliveryStatus: 'delivered' }));
    harness.completion.mockResolvedValueOnce({ status: 'committed', reason: 'credited', credited: { FEATHER: '40', GAME_STAR: '5' } });
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="restored-result" onBack={vi.fn()} /></LocaleProvider>);
    });

    expect(harness.currentRun.mock.invocationCallOrder[0]).toBeLessThan(harness.latestRun.mock.invocationCallOrder[0]!);
    expect(host.querySelector('.result-score')?.textContent).toContain('23');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('4');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('2');
    await vi.waitFor(() => expect(host.querySelector('.account-settlement')?.textContent).toContain('40'));
    expect(host.querySelector('.account-settlement')?.textContent).toContain('5');
    expect(host.textContent).toContain('можно тратить только после проверки и зачисления на баланс аккаунта');
    expect(messagesEn.accountDescription).toContain('verification and account credit');
    expect(messagesEn.accountRewardsNotSpendable).toBe('Only credited account-wallet balances can be spent.');
    expect(host.textContent).toContain('РЕКОРД');
    expect(host.textContent).toContain('зачисленные на баланс аккаунта');
    expect(host.textContent).toContain('Начать полёт с аккаунтом');
  });

  it('does not apply a latest result after the account changes while it is loading', async () => {
    const otherAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    const logout = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Выйти'))!;
    const enterDevId = (id: string) => {
      const input = host.querySelector<HTMLInputElement>('.account-dev-label input')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, id);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let resolveOldLatest!: (value: ReturnType<typeof runSnapshot>) => void;
    await act(async () => { logout().click(); });
    await vi.waitFor(() => expect(host.querySelector('.account-dev-label input')).toBeTruthy());
    harness.latestRun.mockImplementationOnce(() => new Promise((resolve) => { resolveOldLatest = resolve; }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="restore-pending-result" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(harness.latestRun).toHaveBeenCalled());

    await act(async () => { logout().click(); });
    await vi.waitFor(() => expect(host.querySelector('.account-dev-label input')).toBeTruthy());
    harness.loginDev.mockResolvedValue(otherAccount);
    harness.latestRun.mockResolvedValue(undefined);
    await act(async () => { enterDevId('8'); host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(host.textContent).toContain('8'));
    await act(async () => {
      resolveOldLatest(runSnapshot({ state: { ...initialState, score: 99 }, status: 'completed', verificationStatus: 'verified' }));
    });

    expect(host.querySelector('.result-score')).toBeNull();
    expect(host.textContent).not.toContain('99');
    expect(host.textContent).toContain('8');
  });

  it('shows the account best score from the server across new runs', async () => {
    localStorage.setItem('doofy-duck:best:v1', JSON.stringify({ version: 1, best: 99999 }));
    const logoutButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Выйти'))!;
    await act(async () => { logoutButton.click(); });
    harness.progress.mockResolvedValue({ bestScore: 987 });
    harness.loginDev.mockResolvedValue(account);
    harness.currentRun.mockResolvedValue(undefined);
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('.account-dev-label input')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click();
    });
    await vi.waitFor(() => expect(harness.progress).toHaveBeenCalledTimes(2));
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

    expect(host.textContent).toContain('Сервер не смог подтвердить');
    const startButton = [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
      .find((button) => button.textContent?.includes('Начать полёт'));
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

  it('retains a locally completed flight through an outage and replays ordered checkpoints after recovery', async () => {
    vi.useFakeTimers();
    let networkAvailable = false;
    const attempts: Array<{ checkpointSequence: number; ticks: unknown[] }> = [];
    harness.submitCheckpoint.mockImplementation(async (_runId, input) => {
      const checkpoint = input as { checkpointSequence: number; ticks: unknown[] };
      attempts.push({ checkpointSequence: checkpoint.checkpointSequence, ticks: checkpoint.ticks.map((tick) => tick) });
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
    await act(async () => { await vi.waitFor(() => expect(harness.submitCheckpoint).toHaveBeenCalledTimes(2)); });

    const trace = harness.traceRecords.get(`${account.account_id}:${initialState.descriptor.runId}`) as {
      accountId: string; activeTicks: number; unsentTicks: unknown[];
      pending: Array<{ sequence: number; ticks: unknown[] }>;
    };
    expect(trace).toMatchObject({ accountId: account.account_id, activeTicks: 128, unsentTicks: [], pending: [{ sequence: 0 }, { sequence: 1 }] });
    expect(trace.pending.map((checkpoint) => checkpoint.ticks.length)).toEqual([120, 8]);
    expect(host.textContent).toContain('ожидает проверки');
    expect(host.textContent).toContain('отправка повторится');
    expect(host.querySelector('.account-panel .primary-button')?.textContent).not.toContain('Начать полёт с аккаунтом');
    expect(harness.createRun).toHaveBeenCalledTimes(1);

    networkAvailable = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });

    expect(attempts.map((request) => request.checkpointSequence)).toEqual([0, 0, 0, 1]);
    expect(attempts[0]?.ticks).toEqual(trace.pending[0]?.ticks);
    expect(attempts[1]?.ticks).toEqual(attempts[0]?.ticks);
    expect(attempts[2]?.ticks).toEqual(attempts[0]?.ticks);
    expect(attempts[3]?.ticks).toEqual(trace.pending[1]?.ticks);
    expect(host.textContent).toContain('Полёт проверен и записан в аккаунт.');
    const nextStart = [...host.querySelectorAll<HTMLButtonElement>('.account-panel button')]
      .find((button) => button.textContent?.includes('Начать полёт с аккаунтом'));
    expect(nextStart).toBeTruthy();

    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'next-flight', writerToken: 'next-writer' }));
    await act(async () => { nextStart?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:next-flight`)).toBe(true));
    expect(harness.traceRecords.get(`${account.account_id}:next-flight`)).toMatchObject({ accountId: account.account_id });
    expect(harness.loginDev).not.toHaveBeenCalled();
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
      root.render(<LocaleProvider><AccountGame key="restored-account-flight" onBack={vi.fn()} /></LocaleProvider>);
    });
    await vi.waitFor(() => expect(host.textContent).toContain('явное подтверждение'));

    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });

    expect(harness.submitCheckpoint).toHaveBeenCalledWith(initialState.descriptor.runId, expect.objectContaining({
      checkpointSequence: 0, writerGeneration: 2, writerToken: 'new-writer', ticks: [[{ sequence: 0, action: 'FLAP' }]],
    }));
  });

  it('ignores a completion poll that resolves after logout and a different account starts a run', async () => {
    vi.useFakeTimers();
    const nextAccount = { account_id: 'account-b', telegram_user_id: 8, created_at: 'later' };
    harness.currentRun.mockResolvedValue(runSnapshot({ status: 'completion_pending', verificationStatus: 'verified', deliveryStatus: 'pending' }));
    let finishPoll!: (snapshot: ReturnType<typeof runSnapshot>) => void;
    harness.getRun.mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve; }));
    await act(async () => {
      root.render(<LocaleProvider><AccountGame key="completion-pending-flight" onBack={vi.fn()} /></LocaleProvider>);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(harness.getRun).toHaveBeenCalledTimes(1);

    const logoutButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Выйти'))!;
    await act(async () => { logoutButton.click(); });
    harness.loginDev.mockResolvedValue(nextAccount);
    harness.currentRun.mockResolvedValue(undefined);
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('.account-dev-label input')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click();
    });
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
      root.render(<LocaleProvider><AccountGame key="same-account-completion-poll" onBack={vi.fn()} /></LocaleProvider>);
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(host.textContent).toContain('Начать полёт с аккаунтом');

    harness.createRun.mockResolvedValueOnce(runSnapshot({ runId: 'run-b', writerToken: 'writer-b' }));
    await act(async () => { host.querySelector<HTMLButtonElement>('.account-panel .primary-button')?.click(); });
    await vi.waitFor(() => expect(harness.traceRecords.has(`${account.account_id}:run-b`)).toBe(true));
    expect(host.textContent).toContain('Начать полёт');

    await act(async () => { finishOlderPoll(runA); });

    expect(harness.traceRecords.has(`${account.account_id}:run-b`)).toBe(true);
    expect(host.textContent).toContain('Начать полёт');
    expect(host.textContent).not.toContain('Начать полёт с аккаунтом');
  });
});
