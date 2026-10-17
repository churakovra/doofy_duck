import type { RunState } from '@doofy-duck/game-sim';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
};

export type AccountSummary = {
  account_id: string;
  telegram_user_id: number;
  created_at: string;
};

export type AccountProgress = { bestScore: number };

export type AccountRunStatus = 'active' | 'completion_pending' | 'completed' | 'rejected' | 'abandoned';
export type AccountVerificationStatus = 'in_progress' | 'verified' | 'rejected';
export type AccountDeliveryStatus = 'not_ready' | 'pending' | 'delivered' | 'rejected';
export type AccountRunSnapshot = {
  runId: string;
  accountId: string;
  lifeIndex: number;
  seed: number;
  simulationVersion: string;
  generatorVersion: string;
  configId: string;
  state: RunState;
  status: AccountRunStatus;
  verificationStatus: AccountVerificationStatus;
  deliveryStatus: AccountDeliveryStatus;
  checkpointSequence: number;
  writerGeneration: number;
  activeTicks: number;
  activeTickLimit: number;
  submissionDeadline: string;
  completionReason?: 'death' | 'flight_cap';
  writerToken?: string;
};

export type AccountCheckpoint = {
  checkpointSequence: number;
  writerGeneration: number;
  writerToken: string;
  idempotencyKey: string;
  ticks: readonly (readonly { sequence: number; action: 'FLAP' }[])[];
};

type AccountApiOptions = {
  baseUrl?: string;
  fetcher?: FetchLike;
};

export class AccountApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = code, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'AccountApiError';
  }
}

const authCookieLockName = 'doofy-duck:auth-cookie-mutation';
const uncertainRefreshKey = 'doofy-duck:auth-refresh-outcome-uncertain';
const refreshTimeoutMs = 15_000;
const localRefreshQueues = new Map<string, Promise<void>>();

async function withAuthCookieLock<T>(operation: () => Promise<T>, requireBrowserLock = false): Promise<T> {
  const previous = localRefreshQueues.get(authCookieLockName) ?? Promise.resolve();
  let unlock!: () => void;
  const turn = new Promise<void>((resolve) => { unlock = resolve; });
  const queued = previous.then(() => turn);
  localRefreshQueues.set(authCookieLockName, queued);
  await previous;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(authCookieLockName, { mode: 'exclusive' }, operation);
    }
    if (requireBrowserLock) throw new AccountApiError(0, 'auth_refresh_coordination_unavailable');
    return await operation();
  } finally {
    unlock();
    if (localRefreshQueues.get(authCookieLockName) === queued) localRefreshQueues.delete(authCookieLockName);
  }
}

function errorFrom(response: Response, body: unknown): AccountApiError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const detail = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : record;
  const code = typeof detail.code === 'string' ? detail.code : typeof record.error === 'string' ? record.error : `http_${response.status}`;
  const message = typeof detail.message === 'string' ? detail.message : code;
  const retryAfter = response.headers.get('Retry-After');
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const until = Date.parse(retryAfter);
    const parsed = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(until) ? until - Date.now() : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) retryAfterMs = Math.min(parsed, 300_000);
  }
  return new AccountApiError(response.status, code, message, retryAfterMs);
}

function csrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const pair = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('dd_csrf='));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice('dd_csrf='.length)); }
  catch { return pair.slice('dd_csrf='.length); }
}

function validTokenResponse(value: unknown): value is TokenResponse {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<TokenResponse>;
  return typeof token.access_token === 'string' && token.access_token.length > 0
    && token.token_type === 'Bearer' && typeof token.expires_in === 'number'
    && Number.isInteger(token.expires_in) && token.expires_in > 0;
}

export class AccountApi {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  #accessToken: string | undefined;
  #refreshFlight: Promise<void> | undefined;
  #sessionGeneration = 0;

  constructor(options: AccountApiOptions = {}) {
    this.baseUrl = (options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  get signedIn(): boolean { return this.#accessToken !== undefined; }

  async login(initData: string): Promise<AccountSummary> {
    if (!initData.trim()) throw new AccountApiError(400, 'telegram_init_data_missing');
    const generation = this.beginSessionChange();
    const token = await withAuthCookieLock(() => this.fetchToken('/api/v1/auth/telegram', {
      method: 'POST', body: JSON.stringify({ init_data: initData }),
    }));
    this.assertSessionGeneration(generation);
    clearUncertainRefresh();
    this.#accessToken = token.access_token;
    const account = await this.account();
    this.assertSessionGeneration(generation);
    return account;
  }

  async loginDev(telegramUserId: number): Promise<AccountSummary> {
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      throw new AccountApiError(400, 'telegram_user_id_invalid');
    }
    const generation = this.beginSessionChange();
    const token = await withAuthCookieLock(() => this.fetchToken('/api/v1/auth/dev', {
      method: 'POST', body: JSON.stringify({ telegram_user_id: telegramUserId }),
    }));
    this.assertSessionGeneration(generation);
    clearUncertainRefresh();
    this.#accessToken = token.access_token;
    const account = await this.account();
    this.assertSessionGeneration(generation);
    return account;
  }

  async restore(): Promise<AccountSummary> {
    const generation = this.#sessionGeneration;
    await this.refreshToken(generation);
    this.assertSessionGeneration(generation);
    const account = await this.account();
    this.assertSessionGeneration(generation);
    return account;
  }

  async account(): Promise<AccountSummary> {
    return await this.authorized('/api/v1/account') as AccountSummary;
  }

  async createRun(): Promise<AccountRunSnapshot> {
    return await this.authorized('/api/v1/runs', { method: 'POST' }) as AccountRunSnapshot;
  }

  async currentRun(): Promise<AccountRunSnapshot | undefined> {
    try { return await this.authorized('/api/v1/runs/current') as AccountRunSnapshot; }
    catch (error) {
      if (error instanceof AccountApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async latestRun(): Promise<AccountRunSnapshot | undefined> {
    try { return await this.authorized('/api/v1/runs/latest') as AccountRunSnapshot; }
    catch (error) {
      if (error instanceof AccountApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async progress(): Promise<AccountProgress> {
    const value = await this.authorized('/api/v1/runs/progress') as Partial<AccountProgress>;
    if (!Number.isSafeInteger(value.bestScore) || value.bestScore! < 0) {
      throw new AccountApiError(502, 'account_progress_invalid');
    }
    return { bestScore: value.bestScore! };
  }

  async getRun(runId: string): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}`) as AccountRunSnapshot;
  }

  async submitCheckpoint(runId: string, checkpoint: AccountCheckpoint): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}/checkpoints`, {
      method: 'POST', body: JSON.stringify(checkpoint),
    }) as AccountRunSnapshot;
  }

  async takeover(runId: string): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}/takeover`, { method: 'POST' }) as AccountRunSnapshot;
  }

  async abandon(runId: string, writerGeneration: number, writerToken: string): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}/abandon`, {
      method: 'POST', body: JSON.stringify({ writerGeneration, writerToken }),
    }) as AccountRunSnapshot;
  }

  async logout(): Promise<void> {
    const generation = this.beginSessionChange();
    await withAuthCookieLock(async () => {
      if (generation !== this.#sessionGeneration) return;
      const csrf = csrfCookie();
      const response = await this.fetcher(this.url('/api/v1/auth/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(this.#accessToken ? { Authorization: `Bearer ${this.#accessToken}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
      });
      if (response.ok) clearUncertainRefresh();
    });
  }

  async authorized(path: string, init: RequestInit = {}): Promise<unknown> {
    const generation = this.#sessionGeneration;
    if (!this.#accessToken) throw new AccountApiError(401, 'account_session_required');
    let response = await this.fetchAuthorized(path, init, generation);
    this.assertSessionGeneration(generation);
    if (response.status === 401) {
      await this.refreshToken(generation);
      this.assertSessionGeneration(generation);
      response = await this.fetchAuthorized(path, init, generation);
      this.assertSessionGeneration(generation);
    }
    const body = await this.readResponse(response);
    this.assertSessionGeneration(generation);
    return body;
  }

  private async fetchAuthorized(path: string, init: RequestInit, generation: number): Promise<Response> {
    this.assertSessionGeneration(generation);
    const token = this.#accessToken;
    if (!token) throw new AccountApiError(401, 'account_session_required');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return this.fetcher(this.url(path), { ...init, headers, credentials: 'include' });
  }

  private async refreshToken(generation: number): Promise<void> {
    this.assertSessionGeneration(generation);
    if (this.#refreshFlight) return this.#refreshFlight;
    const flight = withAuthCookieLock(async () => {
      this.assertSessionGeneration(generation);
      if (isRefreshUncertain()) throw new AccountApiError(401, 'auth_refresh_outcome_uncertain');
      const csrf = csrfCookie();
      if (!csrf) throw new AccountApiError(401, 'account_session_expired');
      markRefreshUncertain();
      const controller = new AbortController();
      let timeout: number | undefined;
      const request = this.fetchToken('/api/v1/auth/refresh', {
        method: 'POST', headers: { 'X-CSRF-Token': csrf }, signal: controller.signal,
      });
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          controller.abort();
          markRefreshUncertain();
          reject(new AccountApiError(0, 'auth_refresh_outcome_uncertain'));
        }, refreshTimeoutMs);
      });
      try {
        const token = await Promise.race([request, deadline]);
        if (generation === this.#sessionGeneration) this.#accessToken = token.access_token;
        clearUncertainRefresh();
      } catch (error) {
        if (error instanceof AccountApiError && (error.status === 401 || error.status === 403)) clearUncertainRefresh();
        throw error;
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
      }
    }, true).catch((error: unknown) => {
      if (generation === this.#sessionGeneration) this.#accessToken = undefined;
      throw error;
    });
    this.#refreshFlight = flight;
    try { await flight; }
    finally { if (this.#refreshFlight === flight) this.#refreshFlight = undefined; }
  }

  private async fetchToken(path: string, init: RequestInit): Promise<TokenResponse> {
    const response = await this.fetcher(this.url(path), {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const body = await this.readResponse(response);
    if (!validTokenResponse(body)) throw new AccountApiError(502, 'invalid_auth_response');
    return body;
  }

  private async readResponse(response: Response): Promise<unknown> {
    let body: unknown;
    try { body = await response.json(); }
    catch { body = undefined; }
    if (!response.ok) throw errorFrom(response, body);
    return body;
  }

  private url(path: string): string { return `${this.baseUrl}${path}`; }

  private beginSessionChange(): number {
    this.#sessionGeneration += 1;
    this.#accessToken = undefined;
    this.#refreshFlight = undefined;
    return this.#sessionGeneration;
  }

  private assertSessionGeneration(generation: number): void {
    if (generation !== this.#sessionGeneration) throw new AccountApiError(0, 'account_session_superseded');
  }
}

function isRefreshUncertain(): boolean {
  try { return localStorage.getItem(uncertainRefreshKey) === '1'; }
  catch { throw new AccountApiError(0, 'auth_refresh_coordination_unavailable'); }
}

function markRefreshUncertain(): void {
  try {
    localStorage.setItem(uncertainRefreshKey, '1');
    if (localStorage.getItem(uncertainRefreshKey) !== '1') throw new Error('Refresh uncertainty marker was not persisted');
  } catch {
    throw new AccountApiError(0, 'auth_refresh_coordination_unavailable');
  }
}

function clearUncertainRefresh(): void {
  try { localStorage.removeItem(uncertainRefreshKey); }
  catch { /* A new login still installs its fresh in-memory bearer token. */ }
}

