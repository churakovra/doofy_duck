// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountApi, type FetchLike } from './account-api';

let restoreLocks = () => undefined;

function installSerializedWebLocks() {
  let tail = Promise.resolve();
  const request = vi.fn(async (_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<unknown>) => {
    const previous = tail;
    let unlock!: () => void;
    tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try { return await callback({ name: 'doofy-duck:auth-cookie-mutation', mode: 'exclusive' } as Lock); }
    finally { unlock(); }
  });
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  restoreLocks = () => {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else Reflect.deleteProperty(navigator, 'locks');
    restoreLocks = () => undefined;
  };
  return request;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('account API authentication', () => {
  afterEach(() => {
    restoreLocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.useRealTimers();
  });

  it('exchanges Telegram init data for an in-memory bearer token', async () => {
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'secret', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValue(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }));
    const api = new AccountApi({ baseUrl: 'https://game.example', fetcher });

    await api.login('signed-telegram-init-data');

    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://game.example/api/v1/auth/telegram', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ init_data: 'signed-telegram-init-data' }),
      credentials: 'include',
    }));
    const requestHeaders = fetcher.mock.calls[1]?.[1]?.headers as Headers;
    expect(requestHeaders.get('Authorization')).toBe('Bearer secret');
    expect(JSON.stringify(api)).not.toContain('secret');
  });

  it('refreshes an expired bearer once using the readable CSRF cookie and retries', async () => {
    installSerializedWebLocks();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'old', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }))
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response({ access_token: 'new', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }));
    const api = new AccountApi({ baseUrl: '', fetcher });
    await api.login('init');

    await api.account();

    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/v1/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
    }));
    const requestHeaders = fetcher.mock.calls[4]?.[1]?.headers as Headers;
    expect(requestHeaders.get('Authorization')).toBe('Bearer new');
  });

  it('surfaces actionable HTTP errors and does not persist a token', async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(response({ error: 'telegram_auth_invalid' }, 401));
    const api = new AccountApi({ baseUrl: '', fetcher });
    await expect(api.login('bad')).rejects.toMatchObject({ status: 401, code: 'telegram_auth_invalid' });
    expect(localStorage.length).toBe(0);
  });

  it('retains the server retry delay for rate-limited checkpoint retries', async () => {
    const fetcher = vi.fn<FetchLike>();
    const api = new AccountApi({ baseUrl: '', fetcher });
    fetcher.mockResolvedValueOnce(response({ access_token: 'secret', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'busy', message: 'busy' } }), {
        status: 429, headers: { 'content-type': 'application/json', 'Retry-After': '3' },
      }));
    await api.login('init');
    await expect(api.createRun()).rejects.toMatchObject({ status: 429, code: 'busy', retryAfterMs: 3000 });
  });

  it('loads the authenticated account latest run and maps an empty account to undefined', async () => {
    const latest = { runId: 'run-latest', status: 'completed' };
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'secret', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }))
      .mockResolvedValueOnce(response(latest))
      .mockResolvedValueOnce(response({ error: { code: 'not_found', message: 'no runs' } }, 404));
    const api = new AccountApi({ fetcher });
    await api.login('init');

    await expect(api.latestRun()).resolves.toEqual(latest);
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/v1/runs/latest', expect.objectContaining({ headers: expect.any(Headers) }));
    await expect(api.latestRun()).resolves.toBeUndefined();
  });

  it('loads the authenticated account progress from the server', async () => {
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'secret', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }))
      .mockResolvedValueOnce(response({ bestScore: 412 }));
    const api = new AccountApi({ fetcher });
    await api.login('init');

    await expect(api.progress()).resolves.toEqual({ bestScore: 412 });
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/runs/progress', expect.objectContaining({
      headers: expect.any(Headers),
    }));
  });

  it('single-flights concurrent expired requests within one API client', async () => {
    installSerializedWebLocks();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    let accountRequests = 0;
    let releaseUnauthorized!: () => void;
    const unauthorized = new Promise<void>((resolve) => { releaseUnauthorized = resolve; });
    const fetcher = vi.fn<FetchLike>(async (input, init) => {
      const path = String(input);
      if (path.endsWith('/auth/telegram')) return response({ access_token: 'old', token_type: 'Bearer', expires_in: 600 });
      if (path.endsWith('/auth/refresh')) return response({ access_token: 'new', token_type: 'Bearer', expires_in: 600 });
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer new') return response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' });
      accountRequests += 1;
      if (accountRequests === 1) return response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' });
      if (accountRequests === 3) releaseUnauthorized();
      await unauthorized;
      return response({ error: { code: 'expired' } }, 401);
    });
    const api = new AccountApi({ fetcher });
    await api.login('init');

    await Promise.all([api.account(), api.account()]);

    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('serializes refresh cookie rotation across API clients with the origin Web Lock', async () => {
    const locks = installSerializedWebLocks();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    let activeRefreshes = 0;
    let maxRefreshes = 0;
    const buildClient = (token: string) => {
      let accountRequests = 0;
      const fetcher = vi.fn<FetchLike>(async (input, init) => {
        const path = String(input);
        if (path.endsWith('/auth/telegram')) return response({ access_token: token, token_type: 'Bearer', expires_in: 600 });
        if (path.endsWith('/auth/refresh')) {
          activeRefreshes += 1;
          maxRefreshes = Math.max(maxRefreshes, activeRefreshes);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeRefreshes -= 1;
          return response({ access_token: `${token}-fresh`, token_type: 'Bearer', expires_in: 600 });
        }
        const authorization = new Headers(init?.headers).get('Authorization');
        if (authorization === `Bearer ${token}-fresh`) return response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' });
        accountRequests += 1;
        if (accountRequests === 1) return response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' });
        return response({ error: { code: 'expired' } }, 401);
      });
      return new AccountApi({ fetcher });
    };
    const first = buildClient('first');
    const second = buildClient('second');
    await Promise.all([first.login('init'), second.login('init')]);

    await Promise.all([first.account(), second.account()]);

    expect(locks).toHaveBeenCalledTimes(4);
    expect(maxRefreshes).toBe(1);
  });

  it('aborts a stalled refresh and blocks another attempt after its outcome becomes uncertain', async () => {
    installSerializedWebLocks();
    vi.useFakeTimers();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    let loginCount = 0;
    let accountCount = 0;
    let refreshCount = 0;
    let refreshSignal: AbortSignal | undefined;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    const fetcher = vi.fn<FetchLike>((input, init) => {
      const path = String(input);
      if (path.endsWith('/auth/telegram')) {
        loginCount += 1;
        return Promise.resolve(response({ access_token: `token-${loginCount}`, token_type: 'Bearer', expires_in: 600 }));
      }
      if (path.endsWith('/auth/refresh')) {
        refreshCount += 1;
        refreshSignal = init?.signal ?? undefined;
        markRefreshStarted();
        return new Promise((_resolve, reject) => {
          refreshSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      accountCount += 1;
      return Promise.resolve(accountCount <= 2
        ? response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' })
        : response({ error: { code: 'expired' } }, 401));
    });
    const first = new AccountApi({ fetcher });
    const second = new AccountApi({ fetcher });
    await Promise.all([first.login('init'), second.login('init')]);

    const firstRequest = first.account();
    const secondRequest = second.account();
    const firstFailure = expect(firstRequest).rejects.toMatchObject({ code: 'auth_refresh_outcome_uncertain' });
    const secondFailure = expect(secondRequest).rejects.toMatchObject({ code: 'auth_refresh_outcome_uncertain' });
    await refreshStarted;
    await vi.advanceTimersByTimeAsync(15_000);

    await firstFailure;
    await secondFailure;
    expect(refreshSignal?.aborted).toBe(true);
    expect(refreshCount).toBe(1);
  });

  it('fails closed without Web Locks instead of rotating a refresh cookie', async () => {
    restoreLocks();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'old', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }))
      .mockResolvedValueOnce(response({}, 401));
    const api = new AccountApi({ fetcher });
    await api.login('init');

    await expect(api.account()).rejects.toMatchObject({ code: 'auth_refresh_coordination_unavailable' });
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/refresh'))).toHaveLength(0);
  });

  it('keeps explicit login and logout usable without Web Locks', async () => {
    restoreLocks();
    const fetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'fresh', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new AccountApi({ fetcher });

    await expect(api.login('init')).resolves.toMatchObject({ account_id: 'a' });
    expect(api.signedIn).toBe(true);
    await api.logout();

    expect(api.signedIn).toBe(false);
    expect(fetcher.mock.calls.map(([path]) => String(path))).toEqual([
      '/api/v1/auth/telegram', '/api/v1/account', '/api/v1/auth/logout',
    ]);
  });

  it('refuses refresh before network I/O when the uncertainty marker cannot be persisted', async () => {
    installSerializedWebLocks();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    let accountRequests = 0;
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const path = String(input);
      if (path.endsWith('/auth/telegram')) return response({ access_token: 'old', token_type: 'Bearer', expires_in: 600 });
      if (path.endsWith('/auth/refresh')) return response({ access_token: 'new', token_type: 'Bearer', expires_in: 600 });
      accountRequests += 1;
      return accountRequests <= 2
        ? response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' })
        : response({}, 401);
    });
    const first = new AccountApi({ fetcher });
    const second = new AccountApi({ fetcher });
    await Promise.all([first.login('init'), second.login('init')]);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const failures = Promise.all([
      expect(first.account()).rejects.toMatchObject({ code: 'auth_refresh_coordination_unavailable' }),
      expect(second.account()).rejects.toMatchObject({ code: 'auth_refresh_coordination_unavailable' }),
    ]);
    await failures;

    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/refresh'))).toHaveLength(0);
    const freshFetcher = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response({ access_token: 'fresh', token_type: 'Bearer', expires_in: 600 }))
      .mockResolvedValueOnce(response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' }));
    const freshLogin = new AccountApi({ fetcher: freshFetcher });
    await expect(freshLogin.login('new-init-data')).resolves.toMatchObject({ account_id: 'a' });
    expect(freshLogin.signedIn).toBe(true);
    setItem.mockRestore();
  });

  it('waits for refresh rotation before logout reads the updated CSRF cookie', async () => {
    installSerializedWebLocks();
    let csrf = 'before-refresh';
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => `dd_csrf=${csrf}` });
    let finishRefresh!: (value: Response) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    let accountRequests = 0;
    const fetcher = vi.fn<FetchLike>((input) => {
      const path = String(input);
      if (path.endsWith('/auth/telegram')) return Promise.resolve(response({ access_token: 'old', token_type: 'Bearer', expires_in: 600 }));
      if (path.endsWith('/auth/refresh')) {
        markRefreshStarted();
        return new Promise((resolve) => { finishRefresh = resolve; });
      }
      if (path.endsWith('/auth/logout')) return Promise.resolve(new Response(null, { status: 204 }));
      accountRequests += 1;
      return Promise.resolve(accountRequests === 1
        ? response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' })
        : response({}, 401));
    });
    const api = new AccountApi({ fetcher });
    await api.login('init');
    const staleAccount = api.account();
    const staleFailure = expect(staleAccount).rejects.toMatchObject({ code: 'account_session_superseded' });
    await refreshStarted;
    const logout = api.logout();
    csrf = 'after-refresh';
    finishRefresh(response({ access_token: 'rotated', token_type: 'Bearer', expires_in: 600 }));

    await staleFailure;
    await logout;

    const logoutCall = fetcher.mock.calls.find(([path]) => String(path).endsWith('/auth/logout'));
    expect(new Headers(logoutCall?.[1]?.headers).get('X-CSRF-Token')).toBe('after-refresh');
    expect(api.signedIn).toBe(false);
  });

  it('prevents an older refresh from replacing a newer explicit login token', async () => {
    installSerializedWebLocks();
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'dd_csrf=csrf-token' });
    let finishRefresh!: (value: Response) => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    let accountRequests = 0;
    const fetcher = vi.fn<FetchLike>((input) => {
      const path = String(input);
      if (path.endsWith('/auth/telegram')) return Promise.resolve(response({ access_token: 'token-a', token_type: 'Bearer', expires_in: 600 }));
      if (path.endsWith('/auth/dev')) return Promise.resolve(response({ access_token: 'token-b', token_type: 'Bearer', expires_in: 600 }));
      if (path.endsWith('/auth/refresh')) {
        markRefreshStarted();
        return new Promise((resolve) => { finishRefresh = resolve; });
      }
      accountRequests += 1;
      return Promise.resolve(accountRequests === 1
        ? response({ account_id: 'a', telegram_user_id: 7, created_at: 'now' })
        : accountRequests === 2
          ? response({}, 401)
          : response({ account_id: 'b', telegram_user_id: 8, created_at: 'later' }));
    });
    const api = new AccountApi({ fetcher });
    await api.login('init-a');
    const staleAccount = api.account();
    const staleFailure = expect(staleAccount).rejects.toMatchObject({ code: 'account_session_superseded' });
    await refreshStarted;
    const newLogin = api.loginDev(8);
    finishRefresh(response({ access_token: 'late-token-a', token_type: 'Bearer', expires_in: 600 }));

    await staleFailure;
    await expect(newLogin).resolves.toMatchObject({ account_id: 'b' });

    const latestAccountCall = fetcher.mock.calls.filter(([path]) => String(path) === '/api/v1/account').at(-1);
    expect(new Headers(latestAccountCall?.[1]?.headers).get('Authorization')).toBe('Bearer token-b');
    expect(api.signedIn).toBe(true);
  });
});
